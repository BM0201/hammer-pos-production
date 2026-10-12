import assert from "node:assert/strict";
import test from "node:test";
import { Prisma } from "@prisma/client";
import {
  computeRealizedMarginBatch,
  computeUnits90dBatch,
  computeOtherBranchPricesBatch,
  resolvePriorCost,
  buildSuggestedBreakdownFromDecision,
} from "@/modules/pricing/tray-context-service";

/**
 * Parte C.2 (prompt-completo-pendientes-2026-10.md) — fake db en memoria
 * con solo los métodos que estas funciones realmente llaman.
 */
function d(n: number): Prisma.Decimal {
  return new Prisma.Decimal(n);
}

const BRANCH = "branch-1";
const PRODUCT = "product-1";

type FakeLine = {
  productId: string;
  quantity: Prisma.Decimal;
  unitPrice: Prisma.Decimal;
  discountAmount: Prisma.Decimal;
  costSnapshot: Prisma.Decimal | null;
  saleOrder: { branchId: string; createdAt: Date };
};

function buildFakeDb(lines: FakeLine[], settings: Array<{ branchId: string; productId: string; branchPrice: Prisma.Decimal | null }> = []) {
  const db = {
    saleOrderLine: {
      findMany: async ({ where }: { where: any }) => {
        const since: Date | undefined = where.saleOrder?.createdAt?.gte;
        const branchIds: string[] | undefined = where.saleOrder?.branchId?.in;
        const requireCostSnapshot = where.costSnapshot?.not === null;
        return lines.filter((l) =>
          (!since || l.saleOrder.createdAt >= since)
          && (!branchIds || branchIds.includes(l.saleOrder.branchId))
          && (!requireCostSnapshot || l.costSnapshot !== null),
        );
      },
      findFirst: async ({ where }: { where: any }) => {
        const before: Date | undefined = where.saleOrder?.createdAt?.lt;
        const candidates = lines
          .filter((l) => l.productId === where.productId && l.costSnapshot !== null && l.saleOrder.branchId === where.saleOrder.branchId && (!before || l.saleOrder.createdAt < before))
          .sort((a, b) => b.saleOrder.createdAt.getTime() - a.saleOrder.createdAt.getTime());
        return candidates[0] ? { costSnapshot: candidates[0].costSnapshot } : null;
      },
    },
    branchProductSetting: {
      findMany: async ({ where }: { where: any }) => settings.filter((s) => (where.productId?.in ?? []).includes(s.productId) && s.branchPrice !== null),
    },
  };
  return db as unknown as typeof import("@/lib/prisma").prisma;
}

function line(opts: Partial<FakeLine> & { daysAgo: number }): FakeLine {
  const createdAt = new Date();
  createdAt.setDate(createdAt.getDate() - opts.daysAgo);
  return {
    productId: PRODUCT,
    quantity: d(1),
    unitPrice: d(100),
    discountAmount: d(0),
    costSnapshot: d(70),
    saleOrder: { branchId: BRANCH, createdAt },
    ...opts,
  };
}

test("LA QUE IMPORTA — REALIZED_MARGIN: líneas sin costSnapshot se excluyen (no inventan margen con 0)", async () => {
  const lines = [
    line({ daysAgo: 1, quantity: d(10), unitPrice: d(100), costSnapshot: d(70) }), // margen 30%
    line({ daysAgo: 2, quantity: d(10), unitPrice: d(100), costSnapshot: null }), // SIN costSnapshot — se excluye
    line({ daysAgo: 3, quantity: d(10), unitPrice: d(100), costSnapshot: d(70) }), // margen 30%
  ];
  const db = buildFakeDb(lines);
  const result = await computeRealizedMarginBatch(db, [{ branchId: BRANCH, productId: PRODUCT }]);
  const r = result.get(`${BRANCH}:${PRODUCT}`)!;
  assert.equal(r.lineCount, 2, "solo las 2 líneas con costSnapshot cuentan");
  assert.equal(r.marginPct, 30);
});

test("LA QUE IMPORTA — REALIZED_MARGIN con descuentos: el margen se calcula sobre el precio NETO (descuento por unidad)", async () => {
  // unitPrice 100, descuento total de línea 20 en cantidad 10 -> descuento por unidad 2 -> neto 98. costo 70. margen = (98-70)/98 = 28.57%
  const lines = [line({ daysAgo: 1, quantity: d(10), unitPrice: d(100), discountAmount: d(20), costSnapshot: d(70) })];
  const db = buildFakeDb(lines);
  const result = await computeRealizedMarginBatch(db, [{ branchId: BRANCH, productId: PRODUCT }]);
  const r = result.get(`${BRANCH}:${PRODUCT}`)!;
  assert.equal(r.marginPct, 28.57);
});

test("REALIZED_MARGIN está ponderado por CANTIDAD, no es un promedio simple de líneas", async () => {
  // línea A: 90 unidades al 10% margen; línea B: 10 unidades al 50% margen.
  // promedio simple sería 30%; ponderado por cantidad: (90*10 + 10*50)/100 = 14%.
  const lines = [
    line({ daysAgo: 1, quantity: d(90), unitPrice: d(100), costSnapshot: d(90) }), // margen 10%
    line({ daysAgo: 1, quantity: d(10), unitPrice: d(100), costSnapshot: d(50) }), // margen 50%
  ];
  const db = buildFakeDb(lines);
  const result = await computeRealizedMarginBatch(db, [{ branchId: BRANCH, productId: PRODUCT }]);
  const r = result.get(`${BRANCH}:${PRODUCT}`)!;
  assert.equal(r.marginPct, 14, "ponderado por cantidad, no promedio simple (que sería 30)");
});

test("computeUnits90dBatch cuenta TODAS las unidades, con o sin costSnapshot", async () => {
  const lines = [
    line({ daysAgo: 1, quantity: d(10), costSnapshot: d(70) }),
    line({ daysAgo: 2, quantity: d(5), costSnapshot: null }),
  ];
  const db = buildFakeDb(lines);
  const result = await computeUnits90dBatch(db, [{ branchId: BRANCH, productId: PRODUCT }]);
  assert.equal(result.get(`${BRANCH}:${PRODUCT}`), 15, "las 15 unidades cuentan, aunque una línea no tenga costSnapshot");
});

test("LA QUE IMPORTA — computeOtherBranchPricesBatch: min/max de las DEMÁS sucursales, excluyendo la propia", async () => {
  const settings = [
    { branchId: BRANCH, productId: PRODUCT, branchPrice: d(999) }, // la propia — debe excluirse
    { branchId: "branch-2", productId: PRODUCT, branchPrice: d(120) },
    { branchId: "branch-3", productId: PRODUCT, branchPrice: d(90) },
  ];
  const db = buildFakeDb([], settings);
  const result = await computeOtherBranchPricesBatch(db, [{ branchId: BRANCH, productId: PRODUCT }]);
  const r = result.get(`${BRANCH}:${PRODUCT}`)!;
  assert.equal(r.min, 90);
  assert.equal(r.max, 120);
  assert.equal(r.count, 2, "la propia sucursal no cuenta");
});

test("resolvePriorCost usa priceReviewedCost cuando existe, sin tocar ventas", async () => {
  const db = buildFakeDb([]);
  const prior = await resolvePriorCost(db, { branchId: BRANCH, productId: PRODUCT, priceReviewedCost: d(55), costUpdatedAt: null });
  assert.equal(prior, 55);
});

test("resolvePriorCost cae al costSnapshot de la última venta ANTES del cambio de costo, cuando no hay revisión guardada", async () => {
  const costUpdatedAt = new Date();
  const before = new Date(costUpdatedAt);
  before.setDate(before.getDate() - 10);
  const after = new Date(costUpdatedAt);
  after.setDate(after.getDate() + 1);

  const lines = [
    { productId: PRODUCT, quantity: d(1), unitPrice: d(100), discountAmount: d(0), costSnapshot: d(65), saleOrder: { branchId: BRANCH, createdAt: before } },
    { productId: PRODUCT, quantity: d(1), unitPrice: d(100), discountAmount: d(0), costSnapshot: d(90), saleOrder: { branchId: BRANCH, createdAt: after } },
  ];
  const db = buildFakeDb(lines);
  const prior = await resolvePriorCost(db, { branchId: BRANCH, productId: PRODUCT, priceReviewedCost: null, costUpdatedAt });
  assert.equal(prior, 65, "la venta ANTERIOR al cambio de costo, no la posterior");
});

test("resolvePriorCost sin revisión ni costUpdatedAt da null", async () => {
  const db = buildFakeDb([]);
  const prior = await resolvePriorCost(db, { branchId: BRANCH, productId: PRODUCT, priceReviewedCost: null, costUpdatedAt: null });
  assert.equal(prior, null);
});

test("LA QUE IMPORTA — el desglose del sugerido suma lo que da el motor: lee evidence+calculationSnapshot sin recalcular", () => {
  const evidence = { marginObjetivo: 30, commercialClass: "CZ", marginDelta: 20 };
  const snapshot = { marginPercent: 50, operatingExpensePerUnit: 2.5, minProfitAmount: 1, rawSuggestedPrice: 139.4, suggestedPrice: 140, roundingRule: "NEAREST_1" };
  const breakdown = buildSuggestedBreakdownFromDecision(evidence, snapshot);
  assert.ok(breakdown);
  assert.equal(breakdown!.targetMarginPercent, 30);
  assert.equal(breakdown!.marginDelta, 20);
  assert.equal(breakdown!.marginAfterAdjustment, 50);
  assert.equal(breakdown!.finalPrice, 140);
  assert.equal(breakdown!.abcXyzClass, "baja rotación (CZ)");
  assert.equal(breakdown!.flooredByPolicy, false, "30+20=50, coincide exacto, sin piso aplicado");
});

test("el desglose detecta cuando el piso de la política cambió el número final", () => {
  // AX: meta 30 + delta -5 = 25, pero minMargin:10 no aplicaría acá — simulamos un caso donde el motor terminó en un número distinto al simple meta+delta.
  const evidence = { marginObjetivo: 30, commercialClass: "AX", marginDelta: -5 };
  const snapshot = { marginPercent: 10, operatingExpensePerUnit: 0, minProfitAmount: 0, rawSuggestedPrice: 100, suggestedPrice: 100, roundingRule: "NEAREST_1" };
  const breakdown = buildSuggestedBreakdownFromDecision(evidence, snapshot);
  assert.ok(breakdown);
  assert.equal(breakdown!.flooredByPolicy, true, "30-5=25, pero el motor dio 10 — el piso de AX (minMargin:10) cambió el número");
});

test("sin evidence o sin calculationSnapshot, el desglose es null (no inventa nada)", () => {
  assert.equal(buildSuggestedBreakdownFromDecision(null, { marginPercent: 50 }), null);
  assert.equal(buildSuggestedBreakdownFromDecision({ marginObjetivo: 30, commercialClass: "CZ" }, null), null);
});
