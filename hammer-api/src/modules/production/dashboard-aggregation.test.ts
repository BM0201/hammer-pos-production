import assert from "node:assert/strict";
import test from "node:test";
import {
  aggregateBatchesByStatus,
  aggregateProducedByProduct,
  aggregateInputConsumption,
  findBlockingInputs,
  findIncompleteRecipes,
} from "@/modules/production/dashboard-aggregation";

/**
 * prompt-produccion-materiales.md Fase 3 — el bug a matar: el dashboard
 * viejo promediaba unitCost de lotes de productos DISTINTOS sin ponderar
 * por cantidad. Estos tests prueban el reemplazo puro.
 */

test("aggregateBatchesByStatus: cuenta por estado", () => {
  const counts = aggregateBatchesByStatus([
    { status: "COMPLETED" }, { status: "COMPLETED" }, { status: "PLANNED" }, { status: "REVERSED" },
  ]);
  assert.deepEqual(counts, { COMPLETED: 2, PLANNED: 1, REVERSED: 1 });
});

test("LA QUE IMPORTA — costo unitario ponderado por cantidad: dos lotes de cantidades MUY distintas del mismo producto", () => {
  // Lote A: 10 buenas, costo total 1000 -> unitCost=100.
  // Lote B: 990 buenas, costo total 9900 -> unitCost=10.
  // Promedio SIMPLE de unitCost (100+10)/2 = 55 -- el bug viejo.
  // Promedio PONDERADO: (1000+9900)/(10+990) = 10900/1000 = 10.9 -- lo correcto,
  // dominado por el lote grande, no por el promedio ciego de los dos unitCost.
  const result = aggregateProducedByProduct([
    { status: "COMPLETED", finishedProductId: "p1", finishedProductName: "Bloque", producedGoodQuantity: 10, producedBadQuantity: 0, totalCost: 1000, recipeYieldPercent: null },
    { status: "COMPLETED", finishedProductId: "p1", finishedProductName: "Bloque", producedGoodQuantity: 990, producedBadQuantity: 0, totalCost: 9900, recipeYieldPercent: null },
  ]);
  assert.equal(result.length, 1);
  assert.equal(result[0].weightedUnitCost, 10.9);
});

test("LA QUE IMPORTA — rendimiento ponderado: Σbuenas/Σintentadas, no el promedio de los yieldPct por lote", () => {
  // Lote A: 10 buenas, 90 malas (10% rendimiento), pero MUY poco volumen.
  // Lote B: 950 buenas, 50 malas (95% rendimiento), con mucho más volumen.
  // Promedio simple (10%+95%)/2 = 52.5% -- el bug viejo.
  // Ponderado: (10+950)/(10+90+950+50) = 960/1100 ≈ 87.27%.
  const result = aggregateProducedByProduct([
    { status: "COMPLETED", finishedProductId: "p1", finishedProductName: "Bloque", producedGoodQuantity: 10, producedBadQuantity: 90, totalCost: 100, recipeYieldPercent: null },
    { status: "COMPLETED", finishedProductId: "p1", finishedProductName: "Bloque", producedGoodQuantity: 950, producedBadQuantity: 50, totalCost: 9500, recipeYieldPercent: null },
  ]);
  assert.ok(Math.abs((result[0].weightedYieldPct ?? 0) - 960 / 1100) < 1e-9);
});

test("LA QUE IMPORTA — dos productos distintos NUNCA se mezclan en un mismo promedio", () => {
  const result = aggregateProducedByProduct([
    { status: "COMPLETED", finishedProductId: "p1", finishedProductName: "Bloque", producedGoodQuantity: 100, producedBadQuantity: 0, totalCost: 1000, recipeYieldPercent: null },
    { status: "COMPLETED", finishedProductId: "p2", finishedProductName: "Adoquín", producedGoodQuantity: 50, producedBadQuantity: 0, totalCost: 2000, recipeYieldPercent: null },
  ]);
  assert.equal(result.length, 2);
  const bloque = result.find((r) => r.productId === "p1");
  const adoquin = result.find((r) => r.productId === "p2");
  assert.equal(bloque?.weightedUnitCost, 10, "1000/100 — nunca contaminado por el adoquín");
  assert.equal(adoquin?.weightedUnitCost, 40, "2000/50 — nunca contaminado por el bloque");
});

test("aggregateProducedByProduct: ignora lotes no COMPLETED (PLANNED/IN_PROGRESS no tienen costo real todavía)", () => {
  const result = aggregateProducedByProduct([
    { status: "PLANNED", finishedProductId: "p1", finishedProductName: "Bloque", producedGoodQuantity: null, producedBadQuantity: null, totalCost: null, recipeYieldPercent: null },
  ]);
  assert.equal(result.length, 0);
});

test("aggregateProducedByProduct: targetYieldPct solo si TODOS los lotes de ese producto comparten la misma meta", () => {
  const sameTarget = aggregateProducedByProduct([
    { status: "COMPLETED", finishedProductId: "p1", finishedProductName: "Bloque", producedGoodQuantity: 10, producedBadQuantity: 0, totalCost: 100, recipeYieldPercent: 0.9 },
    { status: "COMPLETED", finishedProductId: "p1", finishedProductName: "Bloque", producedGoodQuantity: 20, producedBadQuantity: 0, totalCost: 200, recipeYieldPercent: 0.9 },
  ]);
  assert.equal(sameTarget[0].targetYieldPct, 0.9);

  const differentTargets = aggregateProducedByProduct([
    { status: "COMPLETED", finishedProductId: "p1", finishedProductName: "Bloque", producedGoodQuantity: 10, producedBadQuantity: 0, totalCost: 100, recipeYieldPercent: 0.9 },
    { status: "COMPLETED", finishedProductId: "p1", finishedProductName: "Bloque", producedGoodQuantity: 20, producedBadQuantity: 0, totalCost: 200, recipeYieldPercent: 0.8 },
  ]);
  assert.equal(differentTargets[0].targetYieldPct, null, "metas distintas -> no se inventa un promedio de metas");
});

test("aggregateInputConsumption: suma cantidad y costo por insumo, cruzando varios lotes", () => {
  const result = aggregateInputConsumption([
    { inputProductId: "ins-1", inputProductName: "Cemento", actualQuantity: 50, totalCost: 500 },
    { inputProductId: "ins-1", inputProductName: "Cemento", actualQuantity: 30, totalCost: 300 },
    { inputProductId: "ins-2", inputProductName: "Arena", actualQuantity: 10, totalCost: 50 },
  ]);
  const cemento = result.find((r) => r.productId === "ins-1");
  assert.equal(cemento?.totalQuantity, 80);
  assert.equal(cemento?.totalCost, 800);
  assert.equal(result.find((r) => r.productId === "ins-2")?.totalCost, 50);
});

test("findBlockingInputs: solo cuenta cuando reservado < planeado, suma el faltante", () => {
  const result = findBlockingInputs([
    { inputProductId: "ins-1", inputProductName: "Cemento", plannedQuantity: 100, reservedQuantity: 60 },
    { inputProductId: "ins-1", inputProductName: "Cemento", plannedQuantity: 50, reservedQuantity: 50 }, // sin faltante, no cuenta
    { inputProductId: "ins-2", inputProductName: "Arena", plannedQuantity: 20, reservedQuantity: 20 },
  ]);
  assert.equal(result.length, 1);
  assert.equal(result[0].productId, "ins-1");
  assert.equal(result[0].shortfall, 40);
});

test("findIncompleteRecipes: detecta sin insumos, expectedQuantity<=0, e insumo con costo 0", () => {
  const result = findIncompleteRecipes([
    { id: "r1", name: "Sin insumos", code: "R1", expectedQuantity: 100, inputs: [] },
    { id: "r2", name: "Cantidad inválida", code: "R2", expectedQuantity: 0, inputs: [{ costInBranch: 5 }] },
    { id: "r3", name: "Insumo gratis", code: "R3", expectedQuantity: 100, inputs: [{ costInBranch: 0 }] },
    { id: "r4", name: "Completa", code: "R4", expectedQuantity: 100, inputs: [{ costInBranch: 5 }] },
  ]);
  assert.equal(result.length, 3);
  assert.equal(result.find((r) => r.recipeId === "r1")?.reason, "NO_INPUTS");
  assert.equal(result.find((r) => r.recipeId === "r2")?.reason, "INVALID_EXPECTED_QUANTITY");
  assert.equal(result.find((r) => r.recipeId === "r3")?.reason, "ZERO_COST_INPUT");
  assert.ok(!result.some((r) => r.recipeId === "r4"));
});
