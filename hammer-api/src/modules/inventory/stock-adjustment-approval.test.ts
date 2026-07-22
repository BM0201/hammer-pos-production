import assert from "node:assert/strict";
import test from "node:test";
import { resolveStockAdjustmentMovement } from "@/modules/inventory/service";

/**
 * Auditoría 2026-07-22, hallazgo C2: aprobar una solicitud de STOCK_ADJUSTMENT
 * desde la cola de aprobaciones solo cambiaba ApprovalRequest.status — el stock
 * nunca se movía. El fix ejecuta este cálculo (recalculado contra el stock
 * ACTUAL, no el snapshot de cuando se solicitó) y crea el InventoryMovement
 * correspondiente en /api/approvals/[id]/route.ts al aprobar.
 *
 * Caso numérico: se solicitó llevar el producto a 120 unidades cuando había
 * 95 (delta +25, ADJUSTMENT_IN). Si para cuando el Master aprueba ya hay 110
 * (otra venta consumió 10 de esas 95 previamente contadas... o una recepción
 * sumó unidades), el ajuste debe recalcularse contra 110, no contra 95.
 */
test("C2: desired=120, current=95 -> ADJUSTMENT_IN de 25", () => {
  const movement = resolveStockAdjustmentMovement(120, 95);
  assert.deepEqual(movement, { movementType: "ADJUSTMENT_IN", quantity: 25 });
});

test("C2: desired=80, current=95 -> ADJUSTMENT_OUT de 15", () => {
  const movement = resolveStockAdjustmentMovement(80, 95);
  assert.deepEqual(movement, { movementType: "ADJUSTMENT_OUT", quantity: 15 });
});

test("C2: desired=current -> sin movimiento (null), no crea un InventoryMovement de cantidad 0", () => {
  assert.equal(resolveStockAdjustmentMovement(100, 100), null);
});

test("C2: recalcula contra el stock ACTUAL al momento de aprobar, no el snapshot de la solicitud", () => {
  // Se solicitó al ver 95 en stock (desired=120, delta esperado +25).
  const requestedDelta = resolveStockAdjustmentMovement(120, 95);
  assert.deepEqual(requestedDelta, { movementType: "ADJUSTMENT_IN", quantity: 25 });

  // Para cuando el Master aprueba, una venta ya bajó el stock a 110 (habían llegado
  // 15 más por otra vía) — el ajuste real correcto es solo +10, no +25.
  const atApprovalTime = resolveStockAdjustmentMovement(120, 110);
  assert.deepEqual(atApprovalTime, { movementType: "ADJUSTMENT_IN", quantity: 10 });
});
