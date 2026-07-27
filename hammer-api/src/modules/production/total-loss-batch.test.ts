import assert from "node:assert/strict";
import test from "node:test";
import { calculateBatchCosts } from "@/modules/production/calculations";
import { completeBatchSchema } from "@/modules/production/validators";

/**
 * Auditoría 2026-07-22 (ALTO Producción): completeBatchSchema rechazaba
 * producedGoodQuantity=0 (.positive()) — un lote con pérdida total (todo el
 * insumo consumido, cero unidades buenas) nunca podía "completarse" en el
 * sistema, y los insumos consumidos físicamente nunca se deducían del
 * inventario (quedaban como stock fantasma).
 *
 * Producción v2 Fase 1 (2026-07-27): completeBatchSchema ya no acepta costos
 * ni cantidades de insumo del cliente (el "costo del navegador") — solo
 * producedGoodQuantity/producedBadQuantity, laborEntries informativo, y el
 * hash del preview de inyección vigente.
 */
test("completeBatchSchema acepta producedGoodQuantity=0 (perdida total)", () => {
  const result = completeBatchSchema.safeParse({
    producedGoodQuantity: 0,
    producedBadQuantity: 10,
    expectedHash: "abc123",
  });
  assert.equal(result.success, true);
});

test("completeBatchSchema sigue rechazando producedGoodQuantity negativo", () => {
  const result = completeBatchSchema.safeParse({
    producedGoodQuantity: -1,
    expectedHash: "abc123",
  });
  assert.equal(result.success, false);
});

test("completeBatchSchema rechaza costo/cantidad de insumo enviados por el cliente", () => {
  const result = completeBatchSchema.safeParse({
    producedGoodQuantity: 100,
    expectedHash: "abc123",
    inputs: [{ inputProductId: "clx0000000000000000000000", actualQuantity: 10, unitCost: 5 }],
  });
  // Zod ignora campos desconocidos por defecto — lo que importa es que el
  // tipo resultante (CompleteBatchInput) no exponga `inputs` en absoluto,
  // así que el servidor jamás podría leer un costo enviado por el cliente.
  assert.equal(result.success, true);
  assert.equal((result.data as Record<string, unknown>).inputs, undefined);
});

test("completeBatchSchema exige el hash del preview de inyección", () => {
  const result = completeBatchSchema.safeParse({ producedGoodQuantity: 100 });
  assert.equal(result.success, false);
});

test("calculateBatchCosts: perdida total (C$500 de insumos, 0 unidades buenas) -> unitCost=0, sin division por cero", () => {
  const costs = calculateBatchCosts({
    materialsCost: 500,
    laborCost: 0,
    overheadCost: 0,
    producedGoodQuantity: 0,
  });

  assert.equal(costs.materialsCost.toNumber(), 500);
  assert.equal(costs.totalCost.toNumber(), 500);
  assert.equal(costs.unitCost.toNumber(), 0, "sin unidades buenas no hay a quien repartirle el costo");
  assert.equal(costs.suggestedPrice, null);
});
