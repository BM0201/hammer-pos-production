import assert from "node:assert/strict";
import test from "node:test";
import { getPricingTray } from "@/modules/pricing/tray-service";

/**
 * Parte A (prompt-zona-precios-consolidacion.md) — ESTE ES EL TEST QUE
 * IMPORTA: con filtros que no matchean nada, el encabezado de la bandeja
 * decía "Nada necesita revisión ahora mismo" aunque hubiera decisiones
 * abiertas en otra sucursal/categoría. `totals` es del alcance filtrado;
 * `unfilteredTotals` (nuevo) es de TODAS las decisiones abiertas, sin los
 * filtros del usuario — son números distintos que significan cosas
 * distintas.
 *
 * getPricingTray recibe `db` inyectable (mismo patrón que
 * getExpenseSummaryByBranch en pricing/service.ts) — acá se lo damos un
 * fake en memoria que filtra un array fijo de BrainDecision, sin tocar
 * base de datos real.
 */

type FakeDecision = {
  id: string;
  category: string;
  status: string;
  proposedActionType: string;
  severity: string;
  branchId: string | null;
  productId: string | null;
  impactAmount: number;
  priorityScore: number;
  evidenceJson: Record<string, unknown> | null;
  proposedActionJson: Record<string, unknown> | null;
  branch: { id: string; name: string } | null;
  product: { id: string; sku: string; name: string; categoryId: string } | null;
};

function makeFakeDb(decisions: FakeDecision[]) {
  function matches(d: FakeDecision, where: Record<string, unknown>): boolean {
    if (where.category !== undefined && d.category !== where.category) return false;
    if (where.status !== undefined && d.status !== where.status) return false;
    const typeIn = (where.proposedActionType as { in?: string[] } | undefined)?.in;
    if (typeIn && !typeIn.includes(d.proposedActionType)) return false;
    if (where.branchId !== undefined && d.branchId !== where.branchId) return false;
    if (where.severity !== undefined && d.severity !== where.severity) return false;
    const productWhere = where.product as { categoryId?: string } | undefined;
    if (productWhere?.categoryId !== undefined && d.product?.categoryId !== productWhere.categoryId) return false;
    return true;
  }

  return {
    brainDecision: {
      findMany: async ({ where, select }: { where: Record<string, unknown>; select?: Record<string, boolean> }) => {
        const rows = decisions.filter((d) => matches(d, where));
        if (!select) return rows.map((d) => ({ ...d }));
        return rows.map((d) => {
          const out: Record<string, unknown> = {};
          for (const key of Object.keys(select)) out[key] = (d as unknown as Record<string, unknown>)[key];
          return out;
        });
      },
    },
    branchProductSetting: {
      findMany: async () => [],
    },
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
  } as any;
}

const MASAYA = { id: "branch-masaya", name: "Masaya" };
const LEON = { id: "branch-leon", name: "León" };
const CAT_ARENA = "cat-arena";
const CAT_CEMENTO = "cat-cemento";

function fixtureDecisions(): FakeDecision[] {
  return [
    // Masaya + Cemento + MARGIN_POLICY — no matchea el filtro del test 1 (categoría Arena).
    {
      id: "d1", category: "PRICING", status: "OPEN", proposedActionType: "REVIEW_PRICE_MARGIN_POLICY",
      severity: "HIGH", branchId: MASAYA.id, productId: "product-1", impactAmount: 100, priorityScore: 10,
      evidenceJson: { costLooksWrong: false }, proposedActionJson: { productId: "product-1", branchId: MASAYA.id, suggestedPrice: 120 },
      branch: MASAYA, product: { id: "product-1", sku: "SKU-1", name: "Cemento gris", categoryId: CAT_CEMENTO },
    },
    // León + Arena + BELOW_COST — no matchea el filtro del test 1 (sucursal Masaya).
    {
      id: "d2", category: "PRICING", status: "OPEN", proposedActionType: "REVIEW_PRICE_BELOW_COST",
      severity: "CRITICAL", branchId: LEON.id, productId: "product-2", impactAmount: 200, priorityScore: 20,
      evidenceJson: { costLooksWrong: false }, proposedActionJson: { productId: "product-2", branchId: LEON.id, suggestedPrice: 300 },
      branch: LEON, product: { id: "product-2", sku: "SKU-2", name: "Arena fina", categoryId: CAT_ARENA },
    },
    // Masaya + Arena + COST_STALE — no matchea el filtro del test 1 (motivo Margen bajo la política).
    {
      id: "d3", category: "PRICING", status: "OPEN", proposedActionType: "COST_CHANGED_PRICE_STALE",
      severity: "MEDIUM", branchId: MASAYA.id, productId: "product-3", impactAmount: 50, priorityScore: 5,
      evidenceJson: { costLooksWrong: false }, proposedActionJson: { productId: "product-3", branchId: MASAYA.id, suggestedPrice: 80 },
      branch: MASAYA, product: { id: "product-3", sku: "SKU-3", name: "Arena gruesa", categoryId: CAT_ARENA },
    },
    // León + Cemento + BELOW_COST, costo dudoso — impactAmount inflado, se excluye del impactTotal.
    {
      id: "d4", category: "PRICING", status: "OPEN", proposedActionType: "REVIEW_BRANCH_COST_PRICE",
      severity: "HIGH", branchId: LEON.id, productId: "product-4", impactAmount: 999, priorityScore: 15,
      evidenceJson: { costLooksWrong: true, referenceCost: 90 }, proposedActionJson: { productId: "product-4", branchId: LEON.id, suggestedPrice: 5000 },
      branch: LEON, product: { id: "product-4", sku: "SKU-4", name: "Cemento blanco", categoryId: CAT_CEMENTO },
    },
  ];
}

test("Test 1 (LA QUE IMPORTA) — con filtros que no matchean nada, totals.count es 0 pero unfilteredTotals.count es el total real", async () => {
  const db = makeFakeDb(fixtureDecisions());
  const result = await getPricingTray({ branchId: MASAYA.id, categoryId: CAT_ARENA, reason: "MARGIN_POLICY" }, db);

  assert.equal(result.totals.count, 0, "ningún producto matchea Masaya + Arena + Margen bajo la política");
  assert.equal(result.unfilteredTotals.count, 4, "las 4 decisiones abiertas siguen ahí, sin filtrar");
  assert.equal(result.unfilteredTotals.impactTotal, 100 + 200 + 50, "excluye el impactAmount de d4 (costo dudoso)");
});

test("Test 2 — sin filtros, totals y unfilteredTotals coinciden en count e impacto", async () => {
  const db = makeFakeDb(fixtureDecisions());
  const result = await getPricingTray({}, db);

  assert.equal(result.totals.count, result.unfilteredTotals.count);
  assert.equal(result.totals.impactTotal, result.unfilteredTotals.impactTotal);
  assert.equal(result.totals.count, 4);
});

test("Test 3 — unfilteredTotals.byReason suma igual que la cantidad de decisiones abiertas por tipo", async () => {
  const db = makeFakeDb(fixtureDecisions());
  const result = await getPricingTray({ branchId: MASAYA.id, categoryId: CAT_ARENA, reason: "MARGIN_POLICY" }, db);

  const { byReason } = result.unfilteredTotals;
  assert.equal(byReason.MARGIN_POLICY, 1, "d1");
  assert.equal(byReason.BELOW_COST, 2, "d2 y d4 (REVIEW_PRICE_BELOW_COST y REVIEW_BRANCH_COST_PRICE son el mismo motivo)");
  assert.equal(byReason.COST_STALE, 1, "d3");
  assert.equal(byReason.MARGIN_POLICY + byReason.BELOW_COST + byReason.COST_STALE, result.unfilteredTotals.count);
});

test("Test 4 — costDoubtfulCount sin filtrar cuenta las decisiones con evidenceJson.costLooksWrong true", async () => {
  const db = makeFakeDb(fixtureDecisions());
  const result = await getPricingTray({ branchId: MASAYA.id, categoryId: CAT_ARENA, reason: "MARGIN_POLICY" }, db);

  assert.equal(result.unfilteredTotals.costDoubtfulCount, 1, "solo d4 tiene costLooksWrong true");
});

test("totals (filtrado) sigue reflejando solo lo que matchea — no cambió con este prompt", async () => {
  const db = makeFakeDb(fixtureDecisions());
  const result = await getPricingTray({ branchId: LEON.id }, db);

  assert.equal(result.totals.count, 2, "d2 y d4 son de León");
  assert.equal(result.rows.every((r) => r.branchId === LEON.id), true);
});

/**
 * docs/AUDITORIA-MOTOR-PRECIOS-COSTOS.md, hallazgo #2 — REVIEW_FUSION_UNSELLABLE
 * (checkStockGroupPricingHealth vía pricing-detector.ts) antes quedaba
 * invisible en la Bandeja: APPLICABLE_TYPES no lo incluía. Fixture propia
 * (no la compartida de arriba) para no tener que reajustar los conteos de
 * las pruebas 1-4, que ya fijan un total de 4 decisiones como referencia.
 */
const GRANZA = { id: "branch-granza", name: "Granza" };

function fixtureWithFusionDecision(): FakeDecision[] {
  return [
    {
      id: "d5", category: "PRICING", status: "OPEN", proposedActionType: "REVIEW_FUSION_UNSELLABLE",
      severity: "HIGH", branchId: GRANZA.id, productId: "product-hierro", impactAmount: 0, priorityScore: 8,
      // checkStockGroupPricingHealth nunca calcula un suggestedPrice — por
      // eso proposedActionJson es null, y la fila debe salir applicable:false.
      evidenceJson: { effectivePrice: 1650, effectiveCost: 2234.89, stockGroupId: "group-hierro", stockGroupCode: "HIERRO-1-4" },
      proposedActionJson: null,
      branch: GRANZA, product: { id: "product-hierro", sku: "SKU-HIERRO", name: "Hierro de 1/4 5.5mm", categoryId: CAT_ARENA },
    },
  ];
}

test("Finding #2 — REVIEW_FUSION_UNSELLABLE aparece en la Bandeja (antes: invisible, fuera de APPLICABLE_TYPES)", async () => {
  const db = makeFakeDb(fixtureWithFusionDecision());
  const result = await getPricingTray({}, db);

  assert.equal(result.rows.length, 1, "antes de este fix, APPLICABLE_TYPES no incluía REVIEW_FUSION_UNSELLABLE y esta fila no aparecía");
  const row = result.rows[0];
  assert.equal(row.reason, "BELOW_COST", "mismo síntoma que REVIEW_PRICE_BELOW_COST — precio efectivo bajo el costo efectivo");
  assert.equal(row.currentPrice, 1650, "lee evidence.effectivePrice como fallback de currentPrice");
  assert.equal(row.effectiveCost, 2234.89);
  assert.equal(row.applicable, false, "checkStockGroupPricingHealth no calcula un precio sugerido — se ve pero no se aplica con un clic");
  assert.equal(row.costLooksWrong, false, "no es el mismo síntoma que costLooksWrong — no confundir los dos íconos de advertencia");
});

test("Finding #2 — filtrar por reason: BELOW_COST incluye REVIEW_FUSION_UNSELLABLE junto con los otros dos tipos", async () => {
  const db = makeFakeDb(fixtureWithFusionDecision());
  const result = await getPricingTray({ reason: "BELOW_COST" }, db);
  assert.equal(result.rows.length, 1);
});

test("Finding #2 — filtrar por reason: MARGIN_POLICY o COST_STALE NO incluye REVIEW_FUSION_UNSELLABLE", async () => {
  const db = makeFakeDb(fixtureWithFusionDecision());
  const marginResult = await getPricingTray({ reason: "MARGIN_POLICY" }, db);
  const staleResult = await getPricingTray({ reason: "COST_STALE" }, db);
  assert.equal(marginResult.rows.length, 0);
  assert.equal(staleResult.rows.length, 0);
});

/**
 * prompt-precios-vigilancia-movimiento.md — "cuando... no tenga costo, me
 * aparezca": REVIEW_PRODUCT_NO_COST (pricing-detector.ts) es una sección
 * propia (NO_COST), distinta de BELOW_COST — ahí SÍ hay un costo, y es
 * mayor al precio; acá directamente no hay costo con qué comparar.
 */
function fixtureWithNoCostDecision(): FakeDecision[] {
  return [
    {
      id: "d6", category: "PRICING", status: "OPEN", proposedActionType: "REVIEW_PRODUCT_NO_COST",
      severity: "CRITICAL", branchId: MASAYA.id, productId: "product-sin-costo", impactAmount: 1500, priorityScore: 30,
      // Sin costo con qué comparar, no hay precio sugerido que calcular —
      // proposedActionJson queda null, igual que REVIEW_FUSION_UNSELLABLE.
      evidenceJson: { effectivePrice: 150, effectiveCost: null, abcClass: "A", stockAtRisk: 10 },
      proposedActionJson: null,
      branch: MASAYA, product: { id: "product-sin-costo", sku: "SKU-SIN-COSTO", name: "Producto sin costo", categoryId: CAT_CEMENTO },
    },
  ];
}

test("prompt-precios-vigilancia-movimiento.md — REVIEW_PRODUCT_NO_COST aparece en la Bandeja como reason NO_COST", async () => {
  const db = makeFakeDb(fixtureWithNoCostDecision());
  const result = await getPricingTray({}, db);

  assert.equal(result.rows.length, 1);
  const row = result.rows[0];
  assert.equal(row.reason, "NO_COST");
  assert.equal(row.effectiveCost, null);
  assert.equal(row.currentPrice, 150);
  assert.equal(row.applicable, false, "sin costo no hay precio sugerido que aplicar con un clic — solo informativa");
});

test("prompt-precios-vigilancia-movimiento.md — filtrar por reason: NO_COST solo trae REVIEW_PRODUCT_NO_COST", async () => {
  const db = makeFakeDb([...fixtureWithNoCostDecision(), ...fixtureDecisions()]);
  const result = await getPricingTray({ reason: "NO_COST" }, db);
  assert.equal(result.rows.length, 1);
  assert.equal(result.rows[0].productId, "product-sin-costo");
});

test("prompt-precios-vigilancia-movimiento.md — unfilteredTotals.byReason.NO_COST cuenta la decisión sin costo", async () => {
  const db = makeFakeDb([...fixtureWithNoCostDecision(), ...fixtureDecisions()]);
  const result = await getPricingTray({}, db);
  assert.equal(result.unfilteredTotals.byReason.NO_COST, 1);
});
