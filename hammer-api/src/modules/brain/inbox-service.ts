import { Prisma, type BrainDecisionSeverity, type BrainDecisionStatus } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { severityRank } from "@/modules/brain/scoring";
import {
  getDecisionCatalogEntry, getActionTypesForArea, getCategoriesForArea, formatEvidence,
  AREA_BY_CATEGORY, AREA_LABELS, type DecisionArea,
} from "@/modules/brain/decision-catalog";

/**
 * Parte A 1.1 — "red de seguridad": una decisión sin `proposedActionType`
 * (cámaras, anulaciones de caja cerrada... o lo que sea que un módulo
 * futuro olvide catalogar) ya NO se descarta de la bandeja. Se agrupa por
 * su categoría REAL (columna, no catálogo) bajo esta clave sintética.
 */
const UNKNOWN_GROUP_PREFIX = "__CAT_";

export function groupKeyFor(proposedActionType: string | null, category: string): string {
  return proposedActionType ?? `${UNKNOWN_GROUP_PREFIX}${category}`;
}

export function isUnknownGroupKey(key: string): boolean {
  return key.startsWith(UNKNOWN_GROUP_PREFIX);
}

export function categoryFromUnknownGroupKey(key: string): string {
  return key.slice(UNKNOWN_GROUP_PREFIX.length);
}

/**
 * prompt-brain-centro-decisiones.md Fase 2 — la bandeja agrupada. "área" no
 * es una columna de la base (es del catálogo, por tipo) — se filtra
 * traduciendo el área pedida a la lista de proposedActionType que caen ahí
 * (getActionTypesForArea) ANTES de consultar, nunca post-filtrando en JS
 * sobre todas las filas.
 *
 * Por qué NO `_max: { severity: true }` en el groupBy: Postgres ordena un
 * enum por el orden de declaración en el CREATE TYPE, no alfabético —
 * BrainDecisionSeverity se declaró CRITICAL primero, así que MAX() de
 * Postgres devolvería INFO (el último declarado), no CRITICAL. Agrupar
 * también por `severity` (una fila por tipo×severidad) y decidir "la más
 * grave" en JS con severityRank evita ese error sin tener que reordenar el
 * enum (que rompería el `orderBy: severity` que ya usa listBrainDecisions).
 */

type Db = Prisma.TransactionClient | typeof prisma;

export type InboxStatusView = "PENDING" | "SNOOZED" | "RESOLVED" | "DISMISSED";

const STATUS_VIEWS: Record<InboxStatusView, BrainDecisionStatus[]> = {
  PENDING: ["OPEN", "APPROVED", "MANUAL_REVIEW", "FAILED"],
  SNOOZED: ["SNOOZED"],
  RESOLVED: ["RESOLVED", "EXECUTED"],
  DISMISSED: ["DISMISSED"],
};

const RESOLVED_WINDOW_DAYS = 30;

export type InboxFilters = {
  branchId?: string;
  area?: DecisionArea;
  status?: InboxStatusView;
  q?: string;
  minSeverity?: BrainDecisionSeverity;
};

function severitiesAtOrAbove(min: BrainDecisionSeverity): BrainDecisionSeverity[] {
  const all: BrainDecisionSeverity[] = ["CRITICAL", "HIGH", "MEDIUM", "LOW", "INFO"];
  const minRank = severityRank(min);
  return all.filter((s) => severityRank(s) >= minRank);
}

function buildWhere(filters: InboxFilters): Prisma.BrainDecisionWhereInput {
  const view = filters.status ?? "PENDING";
  const andClauses: Prisma.BrainDecisionWhereInput[] = [];

  // Parte A 1.3 — antes esto excluía de un filtro por área TODO lo sin
  // proposedActionType catalogado, aunque su categoría caiga en esa área
  // (ahora que 1.1 ya no las descarta de la bandeja, el conteo del panel y
  // lo que aparece al hacer clic volverían a no coincidir si esto se
  // quedara como estaba). OR: catalogado en esa área, O sin tipo pero con
  // la categoría real de esa área. Va en su propio AND (no un `where.OR`
  // directo) para no pisar el OR de la búsqueda `q` de abajo.
  if (filters.area) {
    andClauses.push({
      OR: [
        { proposedActionType: { in: getActionTypesForArea(filters.area) } },
        { proposedActionType: null, category: { in: getCategoriesForArea(filters.area) as never[] } },
      ],
    });
  }

  const q = filters.q?.trim();
  if (q) {
    andClauses.push({
      OR: [
        { title: { contains: q, mode: "insensitive" } },
        { description: { contains: q, mode: "insensitive" } },
        { proposedActionType: { contains: q, mode: "insensitive" } },
        { product: { is: { sku: { contains: q, mode: "insensitive" } } } },
        { product: { is: { name: { contains: q, mode: "insensitive" } } } },
        { branch: { is: { code: { contains: q, mode: "insensitive" } } } },
        { branch: { is: { name: { contains: q, mode: "insensitive" } } } },
      ],
    });
  }

  return {
    status: { in: STATUS_VIEWS[view] },
    ...(filters.branchId ? { branchId: filters.branchId } : {}),
    ...(filters.minSeverity ? { severity: { in: severitiesAtOrAbove(filters.minSeverity) } } : {}),
    ...(view === "RESOLVED" ? { resolvedAt: { gte: new Date(Date.now() - RESOLVED_WINDOW_DAYS * 24 * 60 * 60 * 1000) } } : {}),
    ...(andClauses.length > 0 ? { AND: andClauses } : {}),
  };
}

export type InboxGroup = {
  type: string;
  typeLabel: string;
  area: DecisionArea;
  cta: string;
  groupHref: string | null;
  severity: BrainDecisionSeverity;
  count: number;
  branches: Array<{ code: string; name: string }>;
  impactAmount: number;
  oldestDetectedAt: Date;
  hasReappeared: boolean;
};

export async function getBrainInbox(filters: InboxFilters, db: Db = prisma): Promise<{ groups: InboxGroup[]; areas: Array<{ area: DecisionArea; count: number; criticalCount: number }> }> {
  const where = buildWhere(filters);

  const [bySeverity, branchRows, reappearedRows] = await Promise.all([
    db.brainDecision.groupBy({
      by: ["proposedActionType", "category", "severity"],
      where,
      _count: { _all: true },
      _sum: { impactAmount: true },
      _min: { createdAt: true },
    }),
    db.brainDecision.findMany({
      where,
      distinct: ["proposedActionType", "category", "branchId"],
      select: { proposedActionType: true, category: true, branch: { select: { id: true, code: true, name: true } } },
    }),
    db.brainDecisionActionLog.findMany({
      where: { action: "REDETECTED", decision: where },
      distinct: ["decisionId"],
      select: { decision: { select: { proposedActionType: true, category: true } } },
    }),
  ]);

  const reappearedKeys = new Set(reappearedRows.map((r) => groupKeyFor(r.decision.proposedActionType, r.decision.category)));
  const branchesByKey = new Map<string, Map<string, { id: string; code: string; name: string }>>();
  for (const row of branchRows) {
    const key = groupKeyFor(row.proposedActionType, row.category);
    if (!row.branch) continue;
    const map = branchesByKey.get(key) ?? new Map();
    map.set(row.branch.code, row.branch);
    branchesByKey.set(key, map);
  }

  // Parte A 1.1 — "red de seguridad": ya no se descarta nada. Una decisión
  // sin proposedActionType se agrupa por su categoría REAL (antes
  // acc.category quedaba SIEMPRE null — ni el groupBy la traía — así que
  // el fallback de getDecisionCatalogEntry para un tipo no catalogado
  // reportaba área SYSTEM aunque la categoría real fuera otra).
  type Acc = { key: string; count: number; impactAmount: number; oldestDetectedAt: Date; bestSeverity: BrainDecisionSeverity; proposedActionType: string | null; category: string };
  const byKey = new Map<string, Acc>();
  for (const row of bySeverity) {
    const key = groupKeyFor(row.proposedActionType, row.category);
    const existing = byKey.get(key);
    const createdAt = row._min.createdAt ?? new Date();
    const impact = row._sum.impactAmount != null ? Number(row._sum.impactAmount) : 0;
    if (!existing) {
      byKey.set(key, { key, count: row._count._all, impactAmount: impact, oldestDetectedAt: createdAt, bestSeverity: row.severity, proposedActionType: row.proposedActionType, category: row.category });
    } else {
      existing.count += row._count._all;
      existing.impactAmount += impact;
      if (createdAt < existing.oldestDetectedAt) existing.oldestDetectedAt = createdAt;
      if (severityRank(row.severity) > severityRank(existing.bestSeverity)) existing.bestSeverity = row.severity;
    }
  }

  const groups: InboxGroup[] = [...byKey.values()]
    .map((acc) => {
      const branches = [...(branchesByKey.get(acc.key)?.values() ?? [])];
      const isUnknown = isUnknownGroupKey(acc.key);
      const catalogEntry = isUnknown
        ? { label: `Otros avisos de ${AREA_LABELS[AREA_BY_CATEGORY[acc.category] ?? "SYSTEM"]}`, area: AREA_BY_CATEGORY[acc.category] ?? "SYSTEM" as DecisionArea, resolution: "ACKNOWLEDGE" as const, cta: "Ya lo revisé", href: () => null }
        : getDecisionCatalogEntry(acc.proposedActionType, acc.category);
      return {
        type: acc.key,
        typeLabel: catalogEntry.label,
        area: catalogEntry.area,
        cta: catalogEntry.cta,
        // Parte A 1.3 — antes mandaba el CÓDIGO de la sucursal (branches[0].code)
        // a un parámetro que las pantallas destino leen como id (?branchId=RVS
        // en vez de un cuid real) — la query de arriba ahora sí trae `id`.
        groupHref: isUnknown ? null : catalogEntry.href({ branchId: filters.branchId ?? branches[0]?.id ?? null, productId: null, evidence: {}, action: {} }),
        severity: acc.bestSeverity,
        count: acc.count,
        branches: branches.map((b) => ({ code: b.code, name: b.name })),
        impactAmount: acc.impactAmount,
        oldestDetectedAt: acc.oldestDetectedAt,
        hasReappeared: reappearedKeys.has(acc.key),
      };
    })
    .sort((a, b) => severityRank(b.severity) - severityRank(a.severity) || b.impactAmount - a.impactAmount || b.count - a.count);

  const areaTotals = new Map<DecisionArea, { count: number; criticalCount: number }>();
  for (const group of groups) {
    const current = areaTotals.get(group.area) ?? { count: 0, criticalCount: 0 };
    current.count += group.count;
    if (group.severity === "CRITICAL") current.criticalCount += group.count;
    areaTotals.set(group.area, current);
  }

  return {
    groups,
    areas: [...areaTotals.entries()].map(([area, totals]) => ({ area, ...totals })),
  };
}

export type InboxItem = {
  id: string;
  entityLabel: string;
  branchLabel: string | null;
  description: string;
  metrics: Array<{ label: string; value: unknown }>;
  href: string | null;
  detectedAgo: Date;
  status: BrainDecisionStatus;
  resolution: ReturnType<typeof getDecisionCatalogEntry>["resolution"];
  hasReappeared: boolean;
};

function str(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value : null;
}

/** Parte A 1.3 — de dónde puede venir el id de caja/orden: evidenceJson (la mayoría de los detectores) o sourceJson (sale-cancellation-followup, que no trae evidenceJson). */
export function extractReferenceIds(decision: { evidenceJson: unknown; sourceJson: unknown }): { cashSessionId: string | null; saleOrderId: string | null } {
  const evidence = formatEvidence(decision.evidenceJson);
  const source = decision.sourceJson && typeof decision.sourceJson === "object" && !Array.isArray(decision.sourceJson)
    ? decision.sourceJson as Record<string, unknown>
    : {};
  const cashSessionId = str(evidence.find((e) => e.key === "cashSessionId")?.value) ?? str(source.cashSessionId);
  const saleOrderId = str(evidence.find((e) => e.key === "saleOrderId")?.value) ?? str(source.orderId) ?? str(source.saleOrderId);
  return { cashSessionId, saleOrderId };
}

const MANAGUA_DATETIME = new Intl.DateTimeFormat("es-NI", { timeZone: "America/Managua", day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit" });

/** Parte A 1.3 — "Caja <cuid>"/"Orden <cuid>" no decían nada; con el lote resuelto (cashLabels/orderLabels) se muestra el registro de la caja + fecha, o el número de orden real. */
export function entityLabelFor(
  decision: { product: { sku: string; name: string } | null; evidenceJson: unknown; sourceJson: unknown },
  cashLabels: Map<string, string>,
  orderLabels: Map<string, string>,
): string {
  if (decision.product) return `${decision.product.sku} · ${decision.product.name}`;
  const { cashSessionId, saleOrderId } = extractReferenceIds(decision);
  if (cashSessionId && cashLabels.has(cashSessionId)) return cashLabels.get(cashSessionId)!;
  if (saleOrderId && orderLabels.has(saleOrderId)) return orderLabels.get(saleOrderId)!;
  if (cashSessionId) return `Caja ${cashSessionId}`;
  if (saleOrderId) return `Orden ${saleOrderId}`;
  return "Sin entidad puntual";
}

export async function getBrainInboxItems(type: string, filters: InboxFilters, pagination: { cursor?: string; limit: number }) {
  // Parte A 1.1 — `type` puede ser el grupo sintético de la red de
  // seguridad (__CAT_CASH): filtra por categoría real + sin tipo, no por
  // un proposedActionType que nunca existió.
  const typeWhere: Prisma.BrainDecisionWhereInput = isUnknownGroupKey(type)
    ? { proposedActionType: null, category: categoryFromUnknownGroupKey(type) as never }
    : { proposedActionType: type };
  const where: Prisma.BrainDecisionWhereInput = { ...buildWhere(filters), ...typeWhere };

  const [reappearedIds, decisions] = await Promise.all([
    prisma.brainDecisionActionLog.findMany({ where: { action: "REDETECTED", decision: where }, distinct: ["decisionId"], select: { decisionId: true } }),
    prisma.brainDecision.findMany({
      where,
      select: {
        id: true,
        status: true,
        category: true,
        proposedActionType: true,
        title: true,
        description: true,
        branchId: true,
        productId: true,
        evidenceJson: true,
        sourceJson: true,
        proposedActionJson: true,
        createdAt: true,
        branch: { select: { code: true, name: true } },
        product: { select: { sku: true, name: true } },
      },
      orderBy: { createdAt: "desc" },
      take: pagination.limit + 1,
      ...(pagination.cursor ? { cursor: { id: pagination.cursor }, skip: 1 } : {}),
    }),
  ]);

  const reappearedSet = new Set(reappearedIds.map((r) => r.decisionId));
  const hasMore = decisions.length > pagination.limit;
  const page = hasMore ? decisions.slice(0, pagination.limit) : decisions;

  // Parte A 1.3 — "Resolverlo con un findMany por lote de ids, no uno por
  // fila": un solo findMany de cada tipo para TODA la página, no N+1.
  const referenceIds = page.map((d) => extractReferenceIds(d));
  const cashSessionIds = [...new Set(referenceIds.map((r) => r.cashSessionId).filter((id): id is string => id !== null))];
  const saleOrderIds = [...new Set(referenceIds.map((r) => r.saleOrderId).filter((id): id is string => id !== null))];

  const [cashSessions, saleOrders] = await Promise.all([
    cashSessionIds.length > 0
      ? prisma.cashSession.findMany({ where: { id: { in: cashSessionIds } }, select: { id: true, openedAt: true, physicalCashBox: { select: { code: true } } } })
      : Promise.resolve([]),
    saleOrderIds.length > 0
      ? prisma.saleOrder.findMany({ where: { id: { in: saleOrderIds } }, select: { id: true, orderNumber: true } })
      : Promise.resolve([]),
  ]);
  const cashLabels = new Map(cashSessions.map((s) => [s.id, `Caja ${s.physicalCashBox.code} · abierta ${MANAGUA_DATETIME.format(s.openedAt)}`]));
  const orderLabels = new Map(saleOrders.map((o) => [o.id, `Orden ${o.orderNumber}`]));

  const items: InboxItem[] = page.map((decision) => {
    const catalogEntry = getDecisionCatalogEntry(decision.proposedActionType, decision.category);
    return {
      id: decision.id,
      entityLabel: entityLabelFor(decision, cashLabels, orderLabels),
      branchLabel: decision.branch ? `${decision.branch.code} · ${decision.branch.name}` : null,
      // Parte A 1.3 — antes era catalogEntry.label (el mismo texto del
      // GRUPO, repetido en cada fila); ahora es el detalle propio de la
      // decisión, que los detectores ya escriben con números concretos.
      description: decision.description || decision.title || catalogEntry.label,
      metrics: formatEvidence(decision.evidenceJson).slice(0, 2).map((e) => ({ label: e.label, value: e.value })),
      href: catalogEntry.href({ branchId: decision.branchId, productId: decision.productId, evidence: formatEvidence(decision.evidenceJson).reduce((acc, e) => ({ ...acc, [e.key]: e.value }), {}), action: (decision.proposedActionJson as Record<string, unknown>) ?? {} }),
      detectedAgo: decision.createdAt,
      status: decision.status,
      resolution: catalogEntry.resolution,
      hasReappeared: reappearedSet.has(decision.id),
    };
  });

  return { items, nextCursor: hasMore ? page.at(-1)?.id ?? null : null };
}

const PENDING_STATUSES: BrainDecisionStatus[] = ["OPEN", "APPROVED", "MANUAL_REVIEW", "FAILED"];
const SUMMARY_RESOLVED_WINDOW_DAYS = 7;
const SUMMARY_STALE_PENDING_DAYS = 7;

/**
 * Fase 2.4 — reemplaza buildExecutiveSummary (frases por palabra clave,
 * borrado en Fase 1). Solo números reales, nada de texto armado buscando
 * "cz"/"transfer"/"politica" en el título.
 */
export async function getBrainInboxSummary(filters: { branchId?: string }, db: Db = prisma) {
  const where: Prisma.BrainDecisionWhereInput = filters.branchId ? { branchId: filters.branchId } : {};
  const resolvedSince = new Date(Date.now() - SUMMARY_RESOLVED_WINDOW_DAYS * 24 * 60 * 60 * 1000);
  const staleSince = new Date(Date.now() - SUMMARY_STALE_PENDING_DAYS * 24 * 60 * 60 * 1000);

  const [criticalPending, totalPending, impact, resolvedBySource, pendingOverAWeek] = await Promise.all([
    db.brainDecision.count({ where: { ...where, status: { in: PENDING_STATUSES }, severity: "CRITICAL" } }),
    db.brainDecision.count({ where: { ...where, status: { in: PENDING_STATUSES } } }),
    db.brainDecision.aggregate({ where: { ...where, status: { in: PENDING_STATUSES } }, _sum: { impactAmount: true } }),
    db.brainDecision.groupBy({ by: ["resolutionSource"], where: { ...where, status: { in: ["RESOLVED", "EXECUTED"] }, resolvedAt: { gte: resolvedSince } }, _count: { _all: true } }),
    db.brainDecision.count({ where: { ...where, status: { in: PENDING_STATUSES }, createdAt: { lt: staleSince } } }),
  ]);

  const bySource = Object.fromEntries(resolvedBySource.map((r) => [r.resolutionSource ?? "UNKNOWN", r._count._all]));

  return {
    criticalPending,
    totalPending,
    estimatedImpactPending: impact._sum.impactAmount != null ? Number(impact._sum.impactAmount) : 0,
    resolvedLast7Days: {
      user: bySource.USER ?? 0,
      auto: bySource.AUTO ?? 0,
      execution: bySource.EXECUTION ?? 0,
    },
    pendingOverSevenDays: pendingOverAWeek,
  };
}
