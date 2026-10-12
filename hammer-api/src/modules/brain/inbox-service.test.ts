import assert from "node:assert/strict";
import test from "node:test";
import { Prisma } from "@prisma/client";
import { getBrainInbox, getBrainInboxSummary, groupKeyFor, isUnknownGroupKey, categoryFromUnknownGroupKey, extractReferenceIds, entityLabelFor } from "@/modules/brain/inbox-service";

/**
 * prompt-brain-centro-decisiones.md Fase 2 — tests requeridos: agrupación y
 * orden, `areas` cuenta bien con filtro de sucursal, summary separa la
 * resolución por fuente. (La evidencia-nunca-cruda ya se probó en Fase 1,
 * decision-catalog.test.ts::formatEvidence — getBrainInbox/Items la reusan
 * sin lógica propia.)
 *
 * El fake de `groupBy` solo entiende el subconjunto de `where` que
 * buildWhere() realmente produce (status.in, branchId, severity.in,
 * proposedActionType.in) — alcanza para lo que este archivo prueba; la
 * búsqueda por texto (`q`, con OR) queda fuera de este fake a propósito.
 */

type FakeDecision = {
  id: string;
  proposedActionType: string | null;
  category: string;
  severity: string;
  status: string;
  branchId: string | null;
  branch: { code: string; name: string } | null;
  impactAmount: number | null;
  createdAt: Date;
  resolutionSource: string | null;
  resolvedAt: Date | null;
};

/** Recursivo a propósito: buildWhere() ahora compone `AND: [{OR:[...]}, {OR:[...]}]` (área + búsqueda `q`) en vez de un solo `where.OR` plano. */
function matchesWhere(d: FakeDecision, where: Record<string, unknown>): boolean {
  if (where.AND) {
    for (const clause of where.AND as Record<string, unknown>[]) {
      if (!matchesWhere(d, clause)) return false;
    }
  }
  if (where.OR) {
    const or = where.OR as Record<string, unknown>[];
    if (!or.some((clause) => matchesWhere(d, clause))) return false;
  }
  if (where.status && typeof where.status === "object" && "in" in where.status) {
    if (!(where.status as { in: string[] }).in.includes(d.status)) return false;
  }
  if (where.branchId !== undefined && d.branchId !== where.branchId) return false;
  if (where.severity && typeof where.severity === "object" && "in" in where.severity) {
    if (!(where.severity as { in: string[] }).in.includes(d.severity)) return false;
  }
  if (where.proposedActionType === null && d.proposedActionType !== null) return false;
  if (where.proposedActionType && typeof where.proposedActionType === "object" && "in" in where.proposedActionType) {
    if (d.proposedActionType === null || !(where.proposedActionType as { in: string[] }).in.includes(d.proposedActionType)) return false;
  }
  if (typeof where.proposedActionType === "string" && d.proposedActionType !== where.proposedActionType) return false;
  if (where.category && typeof where.category === "object" && "in" in where.category) {
    if (!(where.category as { in: string[] }).in.includes(d.category)) return false;
  }
  if (typeof where.category === "string" && d.category !== where.category) return false;
  if (where.resolvedAt && typeof where.resolvedAt === "object" && "gte" in where.resolvedAt) {
    const gte = (where.resolvedAt as { gte: Date }).gte;
    if (!d.resolvedAt || d.resolvedAt < gte) return false;
  }
  return true;
}

function createFakeDb(decisions: FakeDecision[]) {
  const db = {
    brainDecision: {
      groupBy: async ({ by, where, _count, _sum, _min }: { by: string[]; where: Record<string, unknown>; _count?: unknown; _sum?: { impactAmount?: boolean }; _min?: { createdAt?: boolean } }) => {
        const matching = decisions.filter((d) => matchesWhere(d, where));
        const groups = new Map<string, FakeDecision[]>();
        for (const d of matching) {
          const key = by.map((field) => (d as unknown as Record<string, unknown>)[field]).join("||");
          const arr = groups.get(key) ?? [];
          arr.push(d);
          groups.set(key, arr);
        }
        return [...groups.values()].map((rows) => {
          const row: Record<string, unknown> = {};
          for (const field of by) row[field] = (rows[0] as unknown as Record<string, unknown>)[field];
          if (_count) row._count = { _all: rows.length };
          if (_sum?.impactAmount) row._sum = { impactAmount: rows.reduce((sum, r) => sum + (r.impactAmount ?? 0), 0) };
          if (_min?.createdAt) row._min = { createdAt: rows.reduce((min, r) => (r.createdAt < min ? r.createdAt : min), rows[0].createdAt) };
          return row;
        });
      },
      findMany: async ({ where }: { where: Record<string, unknown> }) => {
        const matching = decisions.filter((d) => matchesWhere(d, where));
        const seen = new Set<string>();
        const result: FakeDecision[] = [];
        for (const d of matching) {
          const key = `${d.proposedActionType}||${d.category}||${d.branchId}`;
          if (seen.has(key)) continue;
          seen.add(key);
          result.push(d);
        }
        return result;
      },
      count: async ({ where }: { where: Record<string, unknown> }) => decisions.filter((d) => matchesWhere(d, where)).length,
      aggregate: async ({ where }: { where: Record<string, unknown> }) => {
        const matching = decisions.filter((d) => matchesWhere(d, where));
        return { _sum: { impactAmount: matching.length ? new Prisma.Decimal(matching.reduce((s, d) => s + (d.impactAmount ?? 0), 0)) : null } };
      },
    },
    brainDecisionActionLog: {
      findMany: async () => [], // ninguno de estos tests ejercita "volvió a aparecer"
    },
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
  } as any;
  return db;
}

function fakeDecision(overrides: Partial<FakeDecision> & { id: string }): FakeDecision {
  return {
    proposedActionType: null,
    category: "SYSTEM",
    severity: "MEDIUM",
    status: "OPEN",
    branchId: null,
    branch: null,
    impactAmount: null,
    createdAt: new Date("2026-01-01"),
    resolutionSource: null,
    resolvedAt: null,
    ...overrides,
  };
}

test("LA QUE IMPORTA — agrupa por tipo y ordena por severidad máxima, después impacto, después cantidad", async () => {
  const db = createFakeDb([
    fakeDecision({ id: "d1", proposedActionType: "REVIEW_PURCHASE_ORDER", severity: "LOW", impactAmount: 1000, branchId: "b1", branch: { code: "B1", name: "Rivas" } }),
    fakeDecision({ id: "d2", proposedActionType: "REVIEW_PRICE_BELOW_COST", severity: "CRITICAL", impactAmount: 100, branchId: "b1", branch: { code: "B1", name: "Rivas" } }),
    fakeDecision({ id: "d3", proposedActionType: "REVIEW_PRICE_BELOW_COST", severity: "HIGH", impactAmount: 50, branchId: "b2", branch: { code: "B2", name: "Masaya" } }),
  ]);

  const result = await getBrainInbox({}, db);

  assert.equal(result.groups.length, 2, "dos tipos distintos — una fila por tipo, no por decisión");
  assert.equal(result.groups[0].type, "REVIEW_PRICE_BELOW_COST", "CRITICAL gana aunque REVIEW_PURCHASE_ORDER tenga más impacto");
  assert.equal(result.groups[0].severity, "CRITICAL", "la severidad del grupo es la MÁS grave de sus líneas (CRITICAL, no HIGH)");
  assert.equal(result.groups[0].count, 2, "suma las 2 líneas (CRITICAL + HIGH) del mismo tipo");
  assert.equal(result.groups[0].impactAmount, 150, "suma el impacto de ambas severidades del mismo tipo");
  assert.equal(result.groups[1].type, "REVIEW_PURCHASE_ORDER");
});

test("LA QUE IMPORTA — areas cuenta bien cuando se filtra por sucursal (no mezcla otra sucursal)", async () => {
  const db = createFakeDb([
    fakeDecision({ id: "d1", proposedActionType: "REVIEW_PRICE_BELOW_COST", severity: "CRITICAL", branchId: "b1", branch: { code: "B1", name: "Rivas" } }),
    fakeDecision({ id: "d2", proposedActionType: "REVIEW_PRICE_BELOW_COST", severity: "CRITICAL", branchId: "b2", branch: { code: "B2", name: "Masaya" } }),
    fakeDecision({ id: "d3", proposedActionType: "REVIEW_PURCHASE_ORDER", severity: "MEDIUM", branchId: "b1", branch: { code: "B1", name: "Rivas" } }),
  ]);

  const result = await getBrainInbox({ branchId: "b1" }, db);

  const pricingArea = result.areas.find((a) => a.area === "PRICING");
  const purchasingArea = result.areas.find((a) => a.area === "PURCHASING");
  assert.equal(pricingArea?.count, 1, "solo la de b1, no la de b2");
  assert.equal(pricingArea?.criticalCount, 1);
  assert.equal(purchasingArea?.count, 1);
});

test("un tipo sin entrada en el catálogo (detector nuevo) no revienta la agrupación — cae al fallback 'Revisar', nunca el código crudo", async () => {
  const db = createFakeDb([
    fakeDecision({ id: "d1", proposedActionType: "UN_TIPO_INEXISTENTE", severity: "LOW" }),
    fakeDecision({ id: "d2", proposedActionType: "REVIEW_PURCHASE_ORDER", severity: "LOW" }),
  ]);
  const result = await getBrainInbox({}, db);
  assert.equal(result.groups.length, 2);
  const unknownGroup = result.groups.find((g) => g.type === "UN_TIPO_INEXISTENTE");
  assert.equal(unknownGroup?.typeLabel, "Revisar", "fallback legible, no el código crudo");
  assert.equal(unknownGroup?.groupHref, null, "sin catálogo no hay a dónde enlazar");
});

test("LA QUE IMPORTA — getBrainInboxSummary separa lo resuelto en 7 días por fuente (USER/AUTO/EXECUTION)", async () => {
  const recentResolved = new Date();
  const db = createFakeDb([
    fakeDecision({ id: "d1", proposedActionType: "REVIEW_PRICE_BELOW_COST", status: "RESOLVED", resolutionSource: "USER", resolvedAt: recentResolved }),
    fakeDecision({ id: "d2", proposedActionType: "REVIEW_PRICE_BELOW_COST", status: "RESOLVED", resolutionSource: "AUTO", resolvedAt: recentResolved }),
    fakeDecision({ id: "d3", proposedActionType: "REVIEW_PRICE_BELOW_COST", status: "RESOLVED", resolutionSource: "AUTO", resolvedAt: recentResolved }),
    fakeDecision({ id: "d4", proposedActionType: "REVIEW_PURCHASE_ORDER", status: "OPEN", severity: "CRITICAL" }),
  ]);

  const summary = await getBrainInboxSummary({}, db);

  assert.equal(summary.resolvedLast7Days.user, 1);
  assert.equal(summary.resolvedLast7Days.auto, 2);
  assert.equal(summary.resolvedLast7Days.execution, 0);
  assert.equal(summary.criticalPending, 1);
  assert.equal(summary.totalPending, 1);
});

/* ── Parte A 1.1 — red de seguridad: una decisión sin proposedActionType ya no se descarta ── */

test("Parte A 1.1 — groupKeyFor/isUnknownGroupKey/categoryFromUnknownGroupKey, ida y vuelta", () => {
  assert.equal(groupKeyFor("REVIEW_PRICE_BELOW_COST", "PRICING"), "REVIEW_PRICE_BELOW_COST");
  const key = groupKeyFor(null, "SECURITY");
  assert.equal(isUnknownGroupKey(key), true);
  assert.equal(categoryFromUnknownGroupKey(key), "SECURITY");
  assert.equal(isUnknownGroupKey("REVIEW_PRICE_BELOW_COST"), false);
});

test("LA QUE IMPORTA — una decisión con proposedActionType null YA NO se descarta: aparece agrupada por categoría como 'Otros avisos de <área>'", async () => {
  const db = createFakeDb([
    fakeDecision({ id: "d1", proposedActionType: null, category: "SECURITY", severity: "HIGH", branchId: "b1", branch: { code: "B1", name: "Rivas" } }),
    fakeDecision({ id: "d2", proposedActionType: "REVIEW_PURCHASE_ORDER", category: "PURCHASING", severity: "LOW" }),
  ]);

  const result = await getBrainInbox({}, db);

  assert.equal(result.groups.length, 2, "antes esta decisión sin tipo se descartaba del todo — ahora cuenta como un grupo más");
  const unknownGroup = result.groups.find((g) => isUnknownGroupKey(g.type));
  assert.ok(unknownGroup, "debe existir el grupo sintético __CAT_SECURITY");
  assert.equal(unknownGroup!.typeLabel, "Otros avisos de seguridad");
  assert.equal(unknownGroup!.area, "SECURITY");
  assert.equal(unknownGroup!.cta, "Ya lo revisé");
  assert.equal(unknownGroup!.groupHref, null);
  assert.equal(unknownGroup!.count, 1);
});

test("LA QUE IMPORTA — filtrar por área SECURITY sí incluye una decisión sin proposedActionType cuya categoría es SECURITY (antes el conteo de áreas y lo que se veía al hacer clic no coincidían)", async () => {
  const db = createFakeDb([
    fakeDecision({ id: "d1", proposedActionType: null, category: "SECURITY", severity: "HIGH" }),
    fakeDecision({ id: "d2", proposedActionType: "REVIEW_PURCHASE_ORDER", category: "PURCHASING", severity: "LOW" }),
  ]);

  const all = await getBrainInbox({}, db);
  const filtered = await getBrainInbox({ area: "SECURITY" }, db);

  const securityAreaCount = all.areas.find((a) => a.area === "SECURITY")?.count ?? 0;
  const securityFilteredCount = filtered.groups.reduce((sum, g) => sum + g.count, 0);
  assert.equal(securityAreaCount, 1);
  assert.equal(securityFilteredCount, 1, "el filtro por área debe traer la misma cantidad que el conteo de esa área");
});

test("Parte A 1.3 — groupHref usa el id REAL de la sucursal, no su código", async () => {
  const db = createFakeDb([
    fakeDecision({ id: "d1", proposedActionType: "REVIEW_PRICE_BELOW_COST", category: "PRICING", branchId: "branch-cuid-1", branch: { id: "branch-cuid-1", code: "RVS", name: "Rivas" } as never }),
  ]);
  const result = await getBrainInbox({}, db);
  assert.equal(result.groups[0].groupHref, "/app/master/pricing?tab=tray&branchId=branch-cuid-1", "antes mandaba el CÓDIGO (RVS) a un parámetro que la pantalla de Precios lee como id");
});

/* ── Parte A 1.3 — entidad legible (batch, no N+1) ── */

test("extractReferenceIds — lee cashSessionId de evidenceJson o, si no está, de sourceJson (sale-cancellation-followup no usa evidenceJson)", () => {
  assert.deepEqual(extractReferenceIds({ evidenceJson: { cashSessionId: "cs-1" }, sourceJson: null }), { cashSessionId: "cs-1", saleOrderId: null });
  assert.deepEqual(extractReferenceIds({ evidenceJson: null, sourceJson: { cashSessionId: "cs-2", orderId: "order-1" } }), { cashSessionId: "cs-2", saleOrderId: "order-1" });
});

test("entityLabelFor — con el lote resuelto, muestra el registro de caja o el número de orden real, no el cuid crudo", () => {
  const cashLabels = new Map([["cs-1", "Caja C1 · abierta 05 oct, 08:00"]]);
  const orderLabels = new Map([["order-1", "Orden V-000123"]]);

  assert.equal(
    entityLabelFor({ product: null, evidenceJson: { cashSessionId: "cs-1" }, sourceJson: null }, cashLabels, orderLabels),
    "Caja C1 · abierta 05 oct, 08:00",
  );
  assert.equal(
    entityLabelFor({ product: null, evidenceJson: { saleOrderId: "order-1" }, sourceJson: null }, cashLabels, orderLabels),
    "Orden V-000123",
  );
  assert.equal(
    entityLabelFor({ product: { sku: "FER-1", name: "Tornillo" }, evidenceJson: {}, sourceJson: null }, cashLabels, orderLabels),
    "FER-1 · Tornillo",
    "un producto siempre gana sobre caja/orden",
  );
  assert.equal(
    entityLabelFor({ product: null, evidenceJson: {}, sourceJson: null }, cashLabels, orderLabels),
    "Sin entidad puntual",
  );
});
