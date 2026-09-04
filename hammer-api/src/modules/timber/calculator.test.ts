import assert from "node:assert/strict";
import test from "node:test";
import {
  calculateTimberTrip,
  calculateReconciliation,
  classifyTimber,
  getVaraLength,
  DEFAULT_CLASSIFICATION_CONFIG,
  type TimberTripLineInput,
  type TimberClassificationConfig,
} from "@/modules/timber/calculator";

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

// ─── Madera v2 Fase 4 — configuracion como datos (clasificacion via config) ──
// El Excel original arrastra 3 errores de copiado que el codigo YA corrige:
// 1x12x8 cubicando con largo 11, 1x10x8 usando 3 en vez de 8, y 2x8x14 con 4
// varas en vez de 5. Estos tests son el guardian contra reintroducirlos al
// mover la clasificacion a config.

test("medidas de 8 pies: varas=3 (config por defecto), forzadas a CUADRO sin importar el ancho", () => {
  assert.equal(getVaraLength(8), 3);
  assert.equal(classifyTimber(1, 12, 8), "CUADRO", "1x12x8 se fuerza a CUADRO por longitud 8, no cubica con largo 11");
  assert.equal(classifyTimber(1, 10, 8), "CUADRO", "1x10x8 se fuerza a CUADRO, el factor de varas sigue siendo 3 (no 8)");
  assert.equal(classifyTimber(1, 6, 8), "CUADRO");
});

test("2x8x14: CUADRO (grosor 2 + ancho 8 no es TABLA ni TABLILLA), varas=5 (no 4)", () => {
  assert.equal(classifyTimber(2, 8, 14), "CUADRO");
  assert.equal(getVaraLength(14), 5, "largo 14 siempre son 5 varas, nunca 4");
});

test("clasificacion con config personalizada (Fase 4): anchos TABLA/TABLILLA y tabla de cubicacion configurables", () => {
  const customConfig: TimberClassificationConfig = {
    tablaWidths: [9, 12], // ancho 9 tratado como TABLA en vez del default [10,12]
    tablillaWidths: [6],
    cubicationTable: [
      { lengthFeet: 16, varas: 6, forceCuadro: false },
      { lengthFeet: 9, varas: 3, forceCuadro: true }, // largo 9 nuevo, forzado a CUADRO
    ],
  };
  assert.equal(classifyTimber(1, 9, 16, customConfig), "TABLA", "ancho 9 es TABLA con la config personalizada");
  assert.equal(classifyTimber(1, 8, 16, customConfig), "CUADRO", "ancho 8 ya no es TABLILLA con la config personalizada (solo 6)");
  assert.equal(classifyTimber(1, 12, 9, customConfig), "CUADRO", "largo 9 forzado a CUADRO en la config personalizada");
  assert.equal(getVaraLength(9, customConfig), 3);
  // Config por defecto no se ve afectada por instancias personalizadas.
  assert.equal(classifyTimber(1, 10, 16), "TABLA");
  assert.equal(classifyTimber(1, 9, 16), "CUADRO", "con la config por defecto, ancho 9 sigue siendo CUADRO");
});

test("DEFAULT_CLASSIFICATION_CONFIG deriva la tabla de cubicacion de VARA_LENGTH_MAP sin duplicar numeros", () => {
  const row16 = DEFAULT_CLASSIFICATION_CONFIG.cubicationTable.find((r) => r.lengthFeet === 16);
  assert.equal(row16?.varas, 6);
  assert.equal(row16?.forceCuadro, false);
  const row8 = DEFAULT_CLASSIFICATION_CONFIG.cubicationTable.find((r) => r.lengthFeet === 8);
  assert.equal(row8?.varas, 3);
  assert.equal(row8?.forceCuadro, true);
});

/**
 * prompt-timber-borrador-bugs.md, BUG 2 — "Verificar que updateTimberTrip
 * tolere bien un array vacío en input.lines". calculateTimberTrip ya
 * tolera un array vacío sin tocarlo (los guards totalFeet>0/pieces>0/
 * saleTotal>0 ya existían) — este test lo deja explícito, para que quien
 * quite el guard de arriba por error lo note acá, no en producción.
 */
test("timber trip: lines vacío no rompe — es el estado real de un DRAFT a medio editar, no un error", () => {
  const result = calculateTimberTrip([], 0, PRICING);
  assert.equal(result.lines.length, 0);
  assert.equal(result.totals.totalPieces, 0);
  assert.equal(result.totals.totalFeet, 0);
  assert.equal(result.totals.computedCostPerFoot, 0);
  assert.equal(result.totals.landedCostPerFoot, 0);
  assert.equal(result.totals.totalCostFeet, 0);
  assert.equal(result.totals.globalMarginPct, 0, "0/0 no debe dar NaN ni Infinity");
  assert.equal(result.distribution.pctTabla, 0);
  assert.equal(result.marginAlerts.linesUnderTarget, 0);
});

test("timber trip: lines vacío con gastos del viaje ya cargados sigue sin romper (landedCostPerFoot cae a 0, no divide entre pies inexistentes)", () => {
  const result = calculateTimberTrip([], 0, PRICING, {
    expenses: { freightAmount: 500, fuelAmount: 100, perDiemAmount: 0, permitsAmount: 0, otherExpensesAmount: 0 },
  });
  assert.equal(result.totals.tripExpensesTotal, 600);
  assert.equal(result.totals.landedCostPerFoot, 0);
  assert.ok(Number.isFinite(result.totals.landedCostPerFoot));
});
