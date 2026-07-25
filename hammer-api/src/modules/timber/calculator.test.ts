import assert from "node:assert/strict";
import test from "node:test";
import { calculateTimberTrip, calculateReconciliation, type TimberTripLineInput } from "@/modules/timber/calculator";

const PRICING = {
  costPerFoot: 20,
  pricePerInchTabla: 8.9,
  pricePerInchTablilla: 6.9,
  pricePerInchCuadro: 6.9,
};

// 1"×12"×16' tabla → boardFeet = (1×12×16)/12 = 16 pies per piece.
const lines: TimberTripLineInput[] = [
  { thickness: 1, width: 12, length: 16, pieces: 10, priceGroup: "TABLA" },
];

test("timber trip: TOTAL mode derives cost per foot from trip total", () => {
  const result = calculateTimberTrip(lines, 3200, PRICING);
  // 10 pieces × 16 pies = 160 pies; 3200 / 160 = 20 C$/pie
  assert.equal(result.totals.totalFeet, 160);
  assert.equal(result.totals.computedCostPerFoot, 20);
  assert.equal(result.totals.woodTripTotalCost, 3200);
});

test("timber trip: PER_FOOT mode uses entered price per foot directly", () => {
  const result = calculateTimberTrip(lines, 0, PRICING, { costPerFootInput: 52 });
  // computedCostPerFoot must equal the entered 52 (not derived)
  assert.equal(result.totals.computedCostPerFoot, 52);
  // total is derived: 52 × 160 pies = 8320
  assert.equal(result.totals.woodTripTotalCost, 8320);
  // line cost feet = 160 × 52 = 8320
  assert.equal(result.totals.totalCostFeet, 8320);
});

test("timber trip: PER_FOOT overrides any provided trip total", () => {
  const result = calculateTimberTrip(lines, 999999, PRICING, { costPerFootInput: 52 });
  assert.equal(result.totals.computedCostPerFoot, 52);
  assert.equal(result.totals.woodTripTotalCost, 8320);
});

test("timber trip: PER_FOOT ignored when value is not positive", () => {
  const result = calculateTimberTrip(lines, 3200, PRICING, { costPerFootInput: 0 });
  assert.equal(result.totals.computedCostPerFoot, 20);
});

// ─── Madera v2 Fase 1 — test dorado y test aterrizado (Excel original) ───────

const GOLDEN_LINES: TimberTripLineInput[] = [
  { thickness: 1, width: 12, length: 16, pieces: 94 },
  { thickness: 1, width: 12, length: 14, pieces: 133 },
  { thickness: 1, width: 12, length: 11, pieces: 165 },
  { thickness: 1, width: 10, length: 16, pieces: 223 },
  { thickness: 1, width: 10, length: 14, pieces: 210 },
  { thickness: 1, width: 10, length: 11, pieces: 108 },
];

test("test dorado — Excel original, costo C$20/pie, sin gastos", () => {
  const result = calculateTimberTrip(GOLDEN_LINES, 0, PRICING, { costPerFootInput: 20 });

  assert.equal(result.totals.totalPieces, 933);
  assert.equal(result.totals.totalFeet, 11594.3333);
  assert.equal(result.totals.totalCostFeet, 231886.67);
  assert.equal(result.totals.totalSale, 452725.2);
  assert.equal(result.totals.totalProfit, 220838.53);
  assert.equal(result.totals.globalMarginPct, 0.4878);
  assert.equal(result.totals.tripExpensesTotal, 0);
  assert.equal(result.totals.landedCostPerFoot, 20, "sin gastos, el costo aterrizado == el costo de la madera sola");

  const line1 = result.lines[0];
  assert.equal(line1.calculatedFeet, 1504.0);
  assert.equal(line1.calculatedCostFeet, 30080.0);
  assert.equal(line1.calculatedCostPerPiece, 320.0);
  assert.equal(line1.calculatedSalePricePerPiece, 640.8);
  assert.equal(line1.calculatedMarginPct, 0.5006);
});

test("test aterrizado — mismas 6 medidas a C$49/pie + C$30,100 de gastos del viaje", () => {
  const result = calculateTimberTrip(GOLDEN_LINES, 0, PRICING, {
    costPerFootInput: 49,
    expenses: { freightAmount: 18000, fuelAmount: 6500, perDiemAmount: 3200, permitsAmount: 2400 },
  });

  assert.equal(result.totals.tripExpensesTotal, 30100);
  assert.equal(result.totals.landedCostPerFoot, 51.5961);
  assert.equal(result.totals.totalCostFeet, 598222.33);

  const line1 = result.lines[0];
  assert.equal(line1.calculatedCostPerPiece, 825.54);

  const sumLineCostFeet = result.lines.reduce((acc, l) => acc + l.calculatedCostFeet, 0);
  assert.equal(
    Math.round(sumLineCostFeet * 100) / 100,
    result.totals.totalCostFeet,
    "residuo de redondeo: la suma de las lineas debe cuadrar exacto contra el total del viaje",
  );
});

test("residuo de redondeo: la linea de mayor cantidad de pies absorbe la diferencia", () => {
  // 3 lineas con pies que generan drift de centavos al costear con un
  // landedCostPerFoot de muchos decimales.
  const lines: TimberTripLineInput[] = [
    { thickness: 1, width: 12, length: 16, pieces: 7 }, // 112.0000 pies (la mayor)
    { thickness: 1, width: 10, length: 11, pieces: 3 }, // 27.5000 pies
    { thickness: 1, width: 6, length: 8, pieces: 5 }, // 4.0000 pies
  ];
  const result = calculateTimberTrip(lines, 0, PRICING, {
    costPerFootInput: 33.333,
    expenses: { freightAmount: 100, otherExpensesAmount: 7.77 },
  });

  const sumLineCostFeet = Math.round(result.lines.reduce((acc, l) => acc + l.calculatedCostFeet, 0) * 100) / 100;
  assert.equal(sumLineCostFeet, result.totals.totalCostFeet);

  const largestLine = result.lines.reduce((max, l) => (l.calculatedFeet > max.calculatedFeet ? l : max));
  assert.equal(largestLine.calculatedFeet, 112.0, "la linea de 1x12x16 con 7 piezas tiene la mayor cantidad de pies");
});

// ─── Madera v2 Fase 1.3 — conciliación con factura ───────────────────────────

test("conciliacion: dentro de tolerancia (1%) da status OK", () => {
  const rec = calculateReconciliation(11594.33, 11600, 0.01);
  assert.equal(rec.status, "OK");
  assert.ok(Math.abs(rec.differenceFeet - -5.67) < 0.01);
});

test("conciliacion: fuera de tolerancia da status REVIEW", () => {
  const rec = calculateReconciliation(11594.33, 12000, 0.01);
  assert.equal(rec.status, "REVIEW");
});

test("conciliacion: sin factura registrada es NOT_APPLICABLE", () => {
  const rec = calculateReconciliation(11594.33, null, 0.01);
  assert.equal(rec.status, "NOT_APPLICABLE");
});

// ─── Madera v2 Fase 3 — margenes y alertas ───────────────────────────────────

test("marginAlerts: viaje aterrizado (C$51.5961/pie) con margen objetivo 40% marca las 6 lineas bajo objetivo y con margen negativo", () => {
  const result = calculateTimberTrip(GOLDEN_LINES, 0, PRICING, {
    costPerFootInput: 49,
    expenses: { freightAmount: 18000, fuelAmount: 6500, perDiemAmount: 3200, permitsAmount: 2400 },
    targetMarginPercent: 0.4,
  });

  assert.equal(result.marginAlerts.linesUnderTarget, 6);
  assert.equal(result.marginAlerts.linesWithNegativeMargin, 6);
  assert.equal(result.marginAlerts.minPricePerInchByGroup.TABLA, 20.07);

  const line1 = result.lines[0];
  assert.equal(line1.minPricePerInchForTargetMargin, 19.11);
  assert.ok(line1.calculatedMarginPct < 0);
});

test("marginAlerts: precio por pulgada minimo garantiza el margen objetivo si se aplica", () => {
  const result = calculateTimberTrip(GOLDEN_LINES, 0, PRICING, {
    costPerFootInput: 49,
    expenses: { freightAmount: 18000, fuelAmount: 6500, perDiemAmount: 3200, permitsAmount: 2400 },
    targetMarginPercent: 0.4,
  });

  const maxMin = result.marginAlerts.minPricePerInchByGroup.TABLA!;
  const simulated = calculateTimberTrip(GOLDEN_LINES, 0, { ...PRICING, pricePerInchTabla: maxMin }, {
    costPerFootInput: 49,
    expenses: { freightAmount: 18000, fuelAmount: 6500, perDiemAmount: 3200, permitsAmount: 2400 },
    targetMarginPercent: 0.4,
  });
  for (const line of simulated.lines) {
    assert.ok(line.calculatedMarginPct >= 0.4 - 0.0005, `linea ${JSON.stringify(line.dimensions)} debe alcanzar >= 40% (obtuvo ${line.calculatedMarginPct})`);
  }
});

test("marginAlerts: sin gastos ni sobrecosto, ninguna linea queda bajo objetivo con el precio por defecto", () => {
  const result = calculateTimberTrip(GOLDEN_LINES, 0, PRICING, { costPerFootInput: 20, targetMarginPercent: 0.4 });
  // margen del test dorado es 48.78% global, por encima del 40% objetivo.
  assert.equal(result.marginAlerts.linesWithNegativeMargin, 0);
});
