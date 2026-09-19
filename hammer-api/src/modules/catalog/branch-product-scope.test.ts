import assert from "node:assert/strict";
import test from "node:test";
import { branchProductScopeFilter } from "@/modules/catalog/branch-product-scope";

/**
 * Fase 3 (prompt-flujo-velocidad.md): la condición 2 (historial de venta)
 * pasó de armar un JOIN SaleOrderLine->SaleOrder (`saleOrder: { branchId }`)
 * a filtrar directo por el branchId denormalizado en la propia línea
 * (`orderLines: { some: { branchId } }`). Esta prueba fija esa forma para
 * que un futuro cambio no reintroduzca el join sin darse cuenta.
 */
test("branchProductScopeFilter: condición 2 filtra orderLines.branchId directo, sin join a saleOrder", () => {
  const filter = branchProductScopeFilter("branch-mga");
  const or = filter.OR as Record<string, unknown>[];
  const saleHistoryCondition = or.find((c) => "orderLines" in c) as {
    orderLines: { some: { branchId?: string; saleOrder?: unknown } };
  };

  assert.ok(saleHistoryCondition, "debe existir una condición de historial de venta");
  assert.equal(saleHistoryCondition.orderLines.some.branchId, "branch-mga");
  assert.equal(saleHistoryCondition.orderLines.some.saleOrder, undefined, "no debe volver a armar el join saleOrder.branchId");
});

test("branchProductScopeFilter: mantiene las otras 3 condiciones (stock, asignación manual, traslado activo)", () => {
  const filter = branchProductScopeFilter("branch-mga");
  const or = filter.OR as Record<string, unknown>[];
  assert.equal(or.length, 4);
  assert.ok(or.some((c) => "inventoryBalances" in c));
  assert.ok(or.some((c) => "branchProductSettings" in c));
  assert.ok(or.some((c) => "transferLines" in c));
});
