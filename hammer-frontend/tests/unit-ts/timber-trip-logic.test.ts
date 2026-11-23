import assert from "node:assert/strict";
import test from "node:test";
import { correctionChanges, EMPTY_EXPENSES, liveTripCost, mergeCubicationImport, tripReadiness, type InjectionPreviewLine, type Reconciliation } from "@/components/timber/trip-logic";

const ok: Reconciliation = { invoicedFeet: null, differenceFeet: 0, differencePercent: 0, tolerancePercent: 0.01, status: "NOT_APPLICABLE" };
const line = { pieces: 10 } as never;
const previewLine = (cost: number, price: number, before: number | null = null): InjectionPreviewLine => ({
  lineId: "l", dimensions: { thickness: 1, width: 12, length: 16 }, isNewProduct: false, productName: "TABLA 1X12X6", sku: null, piecesToAdd: 10,
  costPerPiece: { before: null, after: cost }, sellingPrice: { before, after: price },
});
const base = { reconciliationAcknowledged: false, marginOverrideReason: "" };

test("ingresar: todo en orden habilita el botón", () => {
  const r = tripReadiness({ ...base, trip: { lines: [line], woodTripTotalCost: 3200, landedCostPerFoot: 25, reconciliation: ok }, preview: { lines: [previewLine(400, 600)] } });
  assert.equal(r.canConfirm, true);
  assert.deepEqual(r.items.map((i) => i.key), ["lines", "cost"]);
});

test("ingresar: sin costo de la madera no se puede, aunque haya gastos (igual que TRIP_REQUIRES_COST)", () => {
  const r = tripReadiness({ ...base, trip: { lines: [line], woodTripTotalCost: 0, landedCostPerFoot: 5, reconciliation: ok }, preview: { lines: [previewLine(80, 600)] } });
  assert.equal(r.canConfirm, false);
  assert.equal(r.items.find((i) => i.key === "cost")?.ok, false);
});

test("ingresar: factura que no cuadra exige marcarlo — nunca se da por revisada sola", () => {
  const trip = { lines: [line], woodTripTotalCost: 3200, landedCostPerFoot: 25, reconciliation: { ...ok, status: "REVIEW" as const } };
  const preview = { lines: [previewLine(400, 600)] };
  assert.equal(tripReadiness({ ...base, trip, preview }).canConfirm, false);
  assert.equal(tripReadiness({ ...base, reconciliationAcknowledged: true, trip, preview }).canConfirm, true);
});

test("ingresar: margen negativo pide motivo; precio que baja solo avisa", () => {
  const trip = { lines: [line], woodTripTotalCost: 3200, landedCostPerFoot: 25, reconciliation: ok };
  const preview = { lines: [previewLine(400, 350), previewLine(400, 500, 600)] };
  const without = tripReadiness({ ...base, trip, preview });
  assert.equal(without.negativeMarginLines, 1);
  assert.equal(without.priceDrops, 1);
  assert.equal(without.canConfirm, false);
  assert.equal(tripReadiness({ ...base, marginOverrideReason: "madera de segunda", trip, preview }).canConfirm, true);
});

test("ingresar: sin vista previa todavía no se habilita", () => {
  assert.equal(tripReadiness({ ...base, trip: { lines: [line], woodTripTotalCost: 3200, landedCostPerFoot: 25, reconciliation: ok }, preview: null }).canConfirm, false);
});

test("costo en vivo: el aserrado entra al costo por pie como el flete, sin tocar el total de la madera", () => {
  const cost = liveTripCost({
    lines: [{ thickness: 1, width: 12, length: 16, pieces: 10 }], // 160 pies
    costMode: "PER_FOOT", costPerFoot: 20, woodTripTotalCost: 0,
    expenses: { ...EMPTY_EXPENSES, freightAmount: 320, sawingAmount: 480 },
  });
  assert.equal(cost.totalFeet, 160);
  assert.equal(cost.woodTotal, 3200);
  assert.equal(cost.expensesTotal, 800);
  assert.equal(cost.landedCostPerFoot, 25);
});

test("Excel: la medida que ya estaba se reemplaza, la nueva se agrega", () => {
  const merged = mergeCubicationImport(
    [{ thickness: 1, width: 12, length: 16, pieces: 5 }],
    [{ thickness: 1, width: 12, length: 16, pieces: 30 }, { thickness: 2, width: 4, length: 16, pieces: 8 }],
  );
  assert.deepEqual(merged, [{ thickness: 1, width: 12, length: 16, pieces: 30 }, { thickness: 2, width: 4, length: 16, pieces: 8 }]);
});

test("corrección: solo lista las medidas que cambian de piezas", () => {
  const saved = [
    { thicknessIn: 1, widthIn: 12, lengthIn: 16, pieces: 100 },
    { thicknessIn: 1, widthIn: 3, lengthIn: 13, pieces: 40 },
    { thicknessIn: 2, widthIn: 4, lengthIn: 13, pieces: 8 },
  ];
  const edited = [
    { thickness: 1, width: 12, length: 16, pieces: 90 },
    { thickness: 2, width: 4, length: 13, pieces: 8 },
    { thickness: 2, width: 2, length: 13, pieces: 20 },
  ];
  assert.deepEqual(correctionChanges(saved, edited), [
    { measure: "1×12×16", before: 100, after: 90 },
    { measure: "1×3×13", before: 40, after: 0 },
    { measure: "2×2×13", before: 0, after: 20 },
  ]);
});
