import assert from "node:assert/strict";
import test from "node:test";
import { kpiTone, bucketCategoryValues, buildAttentionItems, type InventoryAttentionCountsInput } from "@/lib/inventory-home-logic";

test("LA QUE IMPORTA — kpiTone: rojo solo para stock negativo, ámbar para el resto de problemas, neutro en 0", () => {
  assert.equal(kpiTone("negativeStock", 3), "danger");
  assert.equal(kpiTone("negativeStock", 0), "neutral");
  assert.equal(kpiTone("lowStock", 5), "warning");
  assert.equal(kpiTone("noCostOrPrice", 1118), "warning");
  assert.equal(kpiTone("lowStock", 0), "neutral");
});

test("bucketCategoryValues: 7 categorías o menos — nada se agrupa en 'Otras'", () => {
  const bars = bucketCategoryValues([
    { name: "Cemento", value: 61200 },
    { name: "Clavos", value: 26310 },
  ]);
  assert.deepEqual(bars, [
    { name: "Cemento", value: 61200, isOther: false },
    { name: "Clavos", value: 26310, isOther: false },
  ]);
});

test("LA QUE IMPORTA — bucketCategoryValues: más de 7 — top 7 + 'Otras (N)' con la suma del resto, 8 barras en total", () => {
  const categories = [
    { name: "Cemento", value: 61200 },
    { name: "Clavos", value: 26310 },
    { name: "Hierro", value: 18940 },
    { name: "Alambres", value: 11820 },
    { name: "Pinturas", value: 6540 },
    { name: "Ferretería", value: 5410 },
    { name: "Plomería", value: 3120 },
    { name: "Tornillos", value: 900 },
    { name: "Pegamento", value: 500 },
  ];
  const bars = bucketCategoryValues(categories);
  assert.equal(bars.length, 8);
  assert.equal(bars[6].name, "Plomería");
  assert.equal(bars[7].name, "Otras (2)");
  assert.equal(bars[7].value, 1400);
  assert.equal(bars[7].isOther, true);
});

test("bucketCategoryValues: categorías en C$0 no entran ni como top ni como 'Otras'", () => {
  const bars = bucketCategoryValues([{ name: "Cemento", value: 100 }, { name: "Sin valor", value: 0 }]);
  assert.equal(bars.length, 1);
});

test("bucketCategoryValues: orden siempre descendente, sin importar el orden de entrada", () => {
  const bars = bucketCategoryValues([{ name: "B", value: 10 }, { name: "A", value: 50 }]);
  assert.deepEqual(bars.map((b) => b.name), ["A", "B"]);
});

const BASE_COUNTS: InventoryAttentionCountsInput = {
  noCost: 0,
  noPrice: 0,
  costEqualsPrice: 0,
  negativeStock: 0,
  lowStock: 0,
  staleTransfers: 0,
  staleTransferSample: null,
  failedIntakeLines: 0,
  topMoversNoCost: null,
};

test("LA QUE IMPORTA — buildAttentionItems: solo los tipos con conteo > 0, ordenados por impacto (conteo descendente)", () => {
  const items = buildAttentionItems({ ...BASE_COUNTS, noCost: 1094, noPrice: 24, costEqualsPrice: 7, staleTransfers: 1 });
  assert.deepEqual(items.map((i) => i.type), ["NO_COST", "NO_PRICE", "COST_EQ_PRICE", "STALE_TRANSFERS"]);
  assert.deepEqual(items.map((i) => i.count), [1094, 24, 7, 1]);
});

test("buildAttentionItems: todo en 0 no devuelve ninguna fila", () => {
  assert.deepEqual(buildAttentionItems(BASE_COUNTS), []);
});

test("buildAttentionItems: empate en conteo desempata por el orden del doc (sin costo antes que traslados)", () => {
  const items = buildAttentionItems({ ...BASE_COUNTS, staleTransfers: 1, failedIntakeLines: 1 });
  assert.deepEqual(items.map((i) => i.type), ["STALE_TRANSFERS", "FAILED_INTAKE"]);
});

test("buildAttentionItems: 'Sin costo' con top-movers afectados menciona el contexto de ventas; sin esa señal cae al genérico", () => {
  const withTopMovers = buildAttentionItems({ ...BASE_COUNTS, noCost: 1094, topMoversNoCost: 20 });
  assert.match(withTopMovers[0].context, /Los 20 que más venden primero/);

  const withoutTopMovers = buildAttentionItems({ ...BASE_COUNTS, noCost: 1094, topMoversNoCost: null });
  assert.equal(withoutTopMovers[0].context, "No se puede medir la ganancia");
});

test("buildAttentionItems: 'Traslados en tránsito' usa el ejemplo real (ruta · número) cuando hay muestra, genérico si no", () => {
  const withSample = buildAttentionItems({ ...BASE_COUNTS, staleTransfers: 1, staleTransferSample: { transferNumber: "TR-0091", fromBranchCode: "MGA", toBranchCode: "RIV" } });
  assert.equal(withSample[0].context, "MGA → RIV · TR-0091");

  const withoutSample = buildAttentionItems({ ...BASE_COUNTS, staleTransfers: 3, staleTransferSample: null });
  assert.equal(withoutSample[0].context, "Traslados despachados hace más de 2 días");
});

test("buildAttentionItems: tonos del punto — rojo para costo=precio/negativo/entradas con error, ámbar para el resto", () => {
  const items = buildAttentionItems({ ...BASE_COUNTS, noCost: 1, noPrice: 1, costEqualsPrice: 1, negativeStock: 1, lowStock: 1, staleTransfers: 1, failedIntakeLines: 1 });
  const toneByType = Object.fromEntries(items.map((i) => [i.type, i.dotTone]));
  assert.equal(toneByType.NO_COST, "warning");
  assert.equal(toneByType.NO_PRICE, "warning");
  assert.equal(toneByType.COST_EQ_PRICE, "danger");
  assert.equal(toneByType.NEGATIVE_STOCK, "danger");
  assert.equal(toneByType.LOW_STOCK, "warning");
  assert.equal(toneByType.STALE_TRANSFERS, "warning");
  assert.equal(toneByType.FAILED_INTAKE, "danger");
});
