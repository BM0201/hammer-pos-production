import assert from "node:assert/strict";
import test from "node:test";
import { buildRecommendations, computeShortageQty, type EngineProductInput, type EngineRecipeInput } from "@/modules/production/recommendation-engine";

/**
 * prompt-produccion-materiales.md Fase 4 — núcleo puro, sin DB. Los tests
 * que pide el doc: producto sin política pero con ventas, BUY_INSTEAD
 * cuando producir sale más caro, y merma incluida en los insumos.
 */

const BRANCH_ID = "branch-1";

function baseRecipe(overrides: Partial<EngineRecipeInput> = {}): EngineRecipeInput {
  return {
    recipeId: "recipe-1",
    recipeName: "Receta",
    recipeCode: "REC-1",
    recipeType: "MANUFACTURING",
    recipeFamily: "GENERAL",
    finishedProductId: "fin-1",
    expectedQuantity: 100,
    wastePercent: null,
    laborCostPerBatch: null,
    processingCostPerBatch: null,
    inputs: [
      { productId: "ins-1", productName: "Insumo", sku: "INS-1", quantityPerBatch: 5, unit: "KILO", stockOnHand: 1000, targetStock: 0, unitCost: 10 },
    ],
    ...overrides,
  };
}

function baseProduct(overrides: Partial<EngineProductInput> = {}): EngineProductInput {
  return {
    productId: "fin-1",
    productName: "Bloque",
    sku: "FIN-1",
    branchId: BRANCH_ID,
    stockOnHand: 0,
    reorderPoint: 0,
    targetStock: 0,
    minStock: 0,
    dailySalesVelocity: 0,
    lastPurchaseCost: null,
    ...overrides,
  };
}

test("computeShortageQty: max(reorden, cobertura*venta) - stock", () => {
  assert.equal(computeShortageQty({ stockOnHand: 10, reorderPoint: 50, dailySalesVelocity: 0, coverageDays: 14 }), 40);
  assert.equal(computeShortageQty({ stockOnHand: 0, reorderPoint: 0, dailySalesVelocity: 10, coverageDays: 14 }), 140);
  assert.equal(computeShortageQty({ stockOnHand: 200, reorderPoint: 50, dailySalesVelocity: 10, coverageDays: 14 }), 0, "stock de sobra, nunca negativo");
});

test("LA QUE IMPORTA — producto SIN política de reorden (reorderPoint=0) pero CON ventas: igual entra", () => {
  const product = baseProduct({ stockOnHand: 5, reorderPoint: 0, dailySalesVelocity: 20 }); // se vende rapido, sin reorderPoint configurado
  const recommendations = buildRecommendations({
    products: [product],
    recipesByProduct: new Map([["fin-1", [baseRecipe()]]]),
    coverageDays: 14,
  });
  assert.equal(recommendations.length, 1, "antes de esta fase, reorderPoint=0 lo hacía invisible; ahora la demanda real lo saca a la luz");
  assert.equal(recommendations[0].targetShortageQty, 14 * 20 - 5, "cobertura(14) x venta diaria(20) - stock(5)");
});

test("producto sin ventas y sin política: nunca genera una recomendación falsa", () => {
  const product = baseProduct({ stockOnHand: 5, reorderPoint: 0, dailySalesVelocity: 0 });
  const recommendations = buildRecommendations({
    products: [product],
    recipesByProduct: new Map([["fin-1", [baseRecipe()]]]),
    coverageDays: 14,
  });
  assert.equal(recommendations.length, 0);
});

test("LA QUE IMPORTA — BUY_INSTEAD cuando producir sale más caro que comprarlo ya hecho", () => {
  // Insumo muy caro: producir 1 bloque = 5 kilos * C$100 = C$500 de materiales,
  // para una receta que rinde 100 -> unitCost ~5. Si lastPurchaseCost es menor, BUY_INSTEAD.
  const product = baseProduct({ stockOnHand: 0, reorderPoint: 50, lastPurchaseCost: 3 });
  const recipe = baseRecipe({
    inputs: [{ productId: "ins-1", productName: "Insumo caro", sku: "INS-1", quantityPerBatch: 500, unit: "KILO", stockOnHand: 100000, targetStock: 0, unitCost: 1 }],
  });
  const recommendations = buildRecommendations({
    products: [product],
    recipesByProduct: new Map([["fin-1", [recipe]]]),
    coverageDays: 14,
  });
  assert.equal(recommendations.length, 1);
  assert.equal(recommendations[0].recommendationType, "BUY_INSTEAD");
  assert.equal(recommendations[0].buyCost, 3);
  assert.ok((recommendations[0].estimatedUnitCost ?? 0) >= 3, "el costo de producir, a la vista, es mayor o igual al de comprar");
});

test("sin BUY_INSTEAD cuando producir sale más barato que comprar", () => {
  const product = baseProduct({ stockOnHand: 0, reorderPoint: 50, lastPurchaseCost: 100 }); // comprar es carísimo
  const recommendations = buildRecommendations({
    products: [product],
    recipesByProduct: new Map([["fin-1", [baseRecipe()]]]), // producir sale barato (5*10/100 = 0.5/unidad)
    coverageDays: 14,
  });
  assert.notEqual(recommendations[0].recommendationType, "BUY_INSTEAD");
});

test("LA QUE IMPORTA — merma esperada: wastePercent 5% pide 1/0.95 más de insumo, no la cantidad cruda de la receta", () => {
  const withoutWaste = buildRecommendations({
    products: [baseProduct({ stockOnHand: 0, reorderPoint: 100 })],
    recipesByProduct: new Map([["fin-1", [baseRecipe({ wastePercent: null })]]]),
    coverageDays: 14,
  });
  const withWaste = buildRecommendations({
    products: [baseProduct({ stockOnHand: 0, reorderPoint: 100 })],
    recipesByProduct: new Map([["fin-1", [baseRecipe({ wastePercent: 0.05 })]]]),
    coverageDays: 14,
  });
  const lineNoWaste = withoutWaste[0].inputSummary[0].requiredQtyPerBatch;
  const lineWithWaste = withWaste[0].inputSummary[0].requiredQtyPerBatch;
  assert.ok(Math.abs(lineWithWaste - lineNoWaste / 0.95) < 0.01, `esperaba ~${lineNoWaste / 0.95}, dio ${lineWithWaste}`);
  assert.ok(lineWithWaste > lineNoWaste, "con merma, pide estrictamente más insumo");
});

test("receta incompleta (sin insumos) -> REVIEW_RECIPE, nunca intenta calcular un costo", () => {
  const product = baseProduct({ stockOnHand: 0, reorderPoint: 50 });
  const recipe = baseRecipe({ inputs: [] });
  const recommendations = buildRecommendations({
    products: [product],
    recipesByProduct: new Map([["fin-1", [recipe]]]),
    coverageDays: 14,
  });
  assert.equal(recommendations[0].recommendationType, "REVIEW_RECIPE");
  assert.equal(recommendations[0].estimatedUnitCost, null);
});

test("producto sin receta activa: nunca aparece (no hay nada que recomendar producir)", () => {
  const product = baseProduct({ stockOnHand: 0, reorderPoint: 50 });
  const recommendations = buildRecommendations({
    products: [product],
    recipesByProduct: new Map(), // sin receta para fin-1
    coverageDays: 14,
  });
  assert.equal(recommendations.length, 0);
});
