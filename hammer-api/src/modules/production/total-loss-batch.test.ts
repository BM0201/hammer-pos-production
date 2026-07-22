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
 */
test("completeBatchSchema acepta producedGoodQuantity=0 (perdida total)", () => {
  const result = completeBatchSchema.safeParse({
    producedGoodQuantity: 0,
    producedBadQuantity: 0,
    laborCost: 0,
    overheadCost: 0,
    inputs: [{ inputProductId: "clx0000000000000000000000", actualQuantity: 10, unitCost: 5 }],
  });
  assert.equal(result.success, true);
});

test("completeBatchSchema sigue rechazando producedGoodQuantity negativo", () => {
  const result = completeBatchSchema.safeParse({
    producedGoodQuantity: -1,
    inputs: [{ inputProductId: "clx0000000000000000000000", actualQuantity: 10, unitCost: 5 }],
  });
  assert.equal(result.success, false);
});

test("calculateBatchCosts: perdida total (C$500 de insumos, 0 unidades buenas) -> unitCost=0, sin division por cero", () => {
  const costs = calculateBatchCosts({
    inputs: [{ actualQuantity: 100, unitCost: 5 }],
    laborCost: 0,
    overheadCost: 0,
    producedGoodQuantity: 0,
  });

  assert.equal(costs.materialsCost, 500);
  assert.equal(costs.totalCost, 500);
  assert.equal(costs.unitCost, 0, "sin unidades buenas no hay a quien repartirle el costo");
  assert.equal(costs.suggestedPrice, null);
});
