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
