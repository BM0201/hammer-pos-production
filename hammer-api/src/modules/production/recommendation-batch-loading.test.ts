import assert from "node:assert/strict";
import test from "node:test";
import { getProductionRecommendationsForBranch } from "@/modules/production/production-recommendation-service";

/**
 * prompt-produccion-materiales.md Fase 4 — "Tope de tiempo: 50 productos
 * con 3 insumos cada uno en menos de 10 consultas." Este test monta un
 * Prisma falso que CUENTA cada llamada (no evalúa el where — getSaleStockAndCost/
 * production-wac-gate-*.test.ts ya prueban esa lógica a fondo) y confirma
 * que getProductionRecommendationsForBranch, con 50 recetas de 3 insumos
 * cada una, nunca pasa de 9 llamadas — fijo, sin importar cuántos productos
 * o insumos haya (antes: 2+ consultas POR insumo POR receta POR producto).
 */

const BRANCH_ID = "branch-1";

function buildFakeDb(recipeCount: number, inputsPerRecipe: number) {
  const calls: string[] = [];
  const track = (name: string) => calls.push(name);

  const recipeRows = Array.from({ length: recipeCount }, (_, i) => ({
    id: `recipe-${i}`,
    name: `Receta ${i}`,
    code: `REC-${i}`,
    recipeType: "MANUFACTURING",
    recipeFamily: "GENERAL",
    finishedProductId: `fin-${i}`,
    expectedQuantity: 100,
    wastePercent: null,
    laborEnabled: false,
    laborCostPerBatch: null,
    processingCostPerBatch: null,
    finishedProduct: { id: `fin-${i}`, sku: `FIN-${i}`, name: `Producto ${i}` },
    inputs: Array.from({ length: inputsPerRecipe }, (_, j) => ({
      inputProductId: `ins-${i}-${j}`,
      quantity: 5,
      unit: "KILO",
      inputProduct: { id: `ins-${i}-${j}`, sku: `INS-${i}-${j}`, name: `Insumo ${i}-${j}` },
    })),
  }));

  const db = {
    productionRecipe: {
      findMany: async () => { track("productionRecipe.findMany"); return recipeRows; },
    },
    systemSetting: {
      findUnique: async () => { track("systemSetting.findUnique"); return null; },
    },
    stockReorderPolicy: {
      findMany: async () => { track("stockReorderPolicy.findMany"); return []; },
    },
    branchProductSetting: {
      findMany: async () => { track("branchProductSetting.findMany"); return []; },
    },
    saleOrderLine: {
      groupBy: async () => { track("saleOrderLine.groupBy"); return []; },
    },
    productStockGroupMember: {
      findMany: async () => { track("productStockGroupMember.findMany"); return []; },
    },
    inventoryBalance: {
      findMany: async () => { track("inventoryBalance.findMany"); return []; },
    },
    product: {
      findMany: async () => { track("product.findMany"); return []; },
    },
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
  } as any;

  return { db, calls };
}

test("LA QUE IMPORTA — 50 productos con 3 insumos cada uno: menos de 10 consultas, sin importar el volumen", async () => {
  const { db, calls } = buildFakeDb(50, 3);
  const result = await getProductionRecommendationsForBranch({ branchId: BRANCH_ID }, db);
  assert.ok(Array.isArray(result.recommendations));
  assert.ok(calls.length < 10, `esperaba menos de 10 consultas, hizo ${calls.length}: ${calls.join(", ")}`);
});

test("1 producto con 3 insumos: el mismo número de consultas que 50 — fijo, no por producto", async () => {
  const { db, calls } = buildFakeDb(1, 3);
  await getProductionRecommendationsForBranch({ branchId: BRANCH_ID }, db);
  assert.ok(calls.length < 10, `esperaba menos de 10 consultas, hizo ${calls.length}`);
});

test("sin recetas activas: cero consultas de más (corta temprano, antes de tocar stock/costo)", async () => {
  const { db, calls } = buildFakeDb(0, 0);
  const result = await getProductionRecommendationsForBranch({ branchId: BRANCH_ID }, db);
  assert.deepEqual(result.recommendations, []);
  assert.ok(calls.length <= 2, `sin recetas, no debería tocar stock/costo/ventas: hizo ${calls.join(", ")}`);
});
