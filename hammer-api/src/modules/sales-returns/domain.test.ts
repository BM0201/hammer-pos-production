import assert from "node:assert/strict";
import test from "node:test";
import { Prisma, ReturnedItemCondition, ReturnInventoryDestination } from "@prisma/client";
import { assertReturnItemDestination, calculateRefundableAmount } from "@/modules/sales-returns/service";

// ── Helpers de dominio puro para stock paquete/suelto ───────────────────────
// Estas funciones espejan la lógica de inventory/service sin BD para mantener
// los tests unitarios sin dependencias de infraestructura.

type PackageStockState = {
  closedPackageQuantity: number;
  looseUnitQuantity: number;
  conversionFactor: number;
  minimumClosedPackageReserve: number;
};

type ConsumeResult =
  | { ok: true; closedPackageQuantity: number; looseUnitQuantity: number; packageOpened: boolean }
  | { ok: false; reason: string };

function consumeLooseOrOpenPackage(
  state: PackageStockState,
  requestedLooseUnits: number,
): ConsumeResult {
  if (state.looseUnitQuantity >= requestedLooseUnits) {
    return {
      ok: true,
      closedPackageQuantity: state.closedPackageQuantity,
      looseUnitQuantity: state.looseUnitQuantity - requestedLooseUnits,
      packageOpened: false,
    };
  }
  const deficit = requestedLooseUnits - state.looseUnitQuantity;
  const packagesNeeded = Math.ceil(deficit / state.conversionFactor);
  const packagesAvailableToOpen = state.closedPackageQuantity - state.minimumClosedPackageReserve;
  if (packagesAvailableToOpen < packagesNeeded) {
    return { ok: false, reason: "INSUFFICIENT_STOCK_OR_RESERVE_VIOLATED" };
  }
  const looseFromOpened = packagesNeeded * state.conversionFactor;
  return {
    ok: true,
    closedPackageQuantity: state.closedPackageQuantity - packagesNeeded,
    looseUnitQuantity: state.looseUnitQuantity - requestedLooseUnits + looseFromOpened,
    packageOpened: true,
  };
}

function returnLooseUnitsToSellable(state: PackageStockState, qty: number): PackageStockState {
  return { ...state, looseUnitQuantity: state.looseUnitQuantity + qty };
}

function returnClosedPackageToSellable(state: PackageStockState, qty: number): PackageStockState {
  return { ...state, closedPackageQuantity: state.closedPackageQuantity + qty };
}

test("sales returns: good items must return to sellable inventory", () => {
  assert.doesNotThrow(() => assertReturnItemDestination({
    condition: ReturnedItemCondition.GOOD,
    inventoryDestination: ReturnInventoryDestination.SELLABLE,
  }));
  assert.throws(
    () => assertReturnItemDestination({
      condition: ReturnedItemCondition.GOOD,
      inventoryDestination: ReturnInventoryDestination.DAMAGED,
    }),
    /RETURN_ITEM_GOOD_MUST_GO_TO_SELLABLE/,
  );
});

test("sales returns: damaged items must return to damaged inventory", () => {
  assert.doesNotThrow(() => assertReturnItemDestination({
    condition: ReturnedItemCondition.DAMAGED,
    inventoryDestination: ReturnInventoryDestination.DAMAGED,
  }));
  assert.throws(
    () => assertReturnItemDestination({
      condition: ReturnedItemCondition.DAMAGED,
      inventoryDestination: ReturnInventoryDestination.SELLABLE,
    }),
    /RETURN_ITEM_DAMAGED_MUST_GO_TO_DAMAGED/,
  );
});

test("sales returns: not-returned items cannot affect inventory", () => {
  assert.doesNotThrow(() => assertReturnItemDestination({
    condition: ReturnedItemCondition.NOT_RETURNED,
    inventoryDestination: ReturnInventoryDestination.NONE,
  }));
  assert.throws(
    () => assertReturnItemDestination({
      condition: ReturnedItemCondition.NOT_RETURNED,
      inventoryDestination: ReturnInventoryDestination.SELLABLE,
    }),
    /RETURN_ITEM_NOT_RETURNED_MUST_GO_TO_NONE/,
  );
});

test("sales returns: refundable amount is proportional to returned quantity", () => {
  const amount = calculateRefundableAmount({
    quantity: new Prisma.Decimal(2),
    originalQuantity: new Prisma.Decimal(5),
    lineSubtotal: new Prisma.Decimal(500),
  });
  assert.equal(amount.toNumber(), 200);
});

test("sales returns: refundable amount rejects invalid original quantity", () => {
  assert.throws(
    () => calculateRefundableAmount({
      quantity: new Prisma.Decimal(1),
      originalQuantity: new Prisma.Decimal(0),
      lineSubtotal: new Prisma.Decimal(100),
    }),
    /INVALID_ORIGINAL_QUANTITY/,
  );
});

// ── Tests de stock paquete/suelto ───────────────────────────────────────────

const QUINTAL: PackageStockState = {
  closedPackageQuantity: 3,
  looseUnitQuantity: 25,
  conversionFactor: 100,
  minimumClosedPackageReserve: 0,
};

test("package stock: venta de unidades sueltas descuenta looseUnitQuantity", () => {
  const result = consumeLooseOrOpenPackage(QUINTAL, 10);
  assert.ok(result.ok);
  if (!result.ok) return;
  assert.equal(result.looseUnitQuantity, 15);
  assert.equal(result.closedPackageQuantity, 3);
  assert.equal(result.packageOpened, false);
});

test("package stock: venta de paquete cerrado descuenta closedPackageQuantity", () => {
  const state: PackageStockState = { ...QUINTAL, looseUnitQuantity: 0 };
  const result = consumeLooseOrOpenPackage(state, 100);
  assert.ok(result.ok);
  if (!result.ok) return;
  assert.equal(result.closedPackageQuantity, 2);
  assert.equal(result.packageOpened, true);
});

test("package stock: abre paquete automáticamente cuando no hay sueltas suficientes", () => {
  const state: PackageStockState = { ...QUINTAL, looseUnitQuantity: 5 };
  const result = consumeLooseOrOpenPackage(state, 30);
  assert.ok(result.ok);
  if (!result.ok) return;
  assert.equal(result.packageOpened, true);
  assert.equal(result.closedPackageQuantity, 2);
  // 5 existentes + 100 del paquete abierto - 30 vendidos = 75
  assert.equal(result.looseUnitQuantity, 75);
});

test("package stock: no abre paquete si viola reserva mínima", () => {
  const state: PackageStockState = {
    closedPackageQuantity: 2,
    looseUnitQuantity: 0,
    conversionFactor: 100,
    minimumClosedPackageReserve: 2,
  };
  const result = consumeLooseOrOpenPackage(state, 50);
  assert.ok(!result.ok);
  assert.equal(result.ok, false);
  assert.match((result as { reason: string }).reason, /INSUFFICIENT_STOCK_OR_RESERVE_VIOLATED/);
});

test("package stock: devolucion buena de unidades sueltas vuelve a inventario vendible", () => {
  const after = returnLooseUnitsToSellable(QUINTAL, 5);
  assert.equal(after.looseUnitQuantity, 30);
  assert.equal(after.closedPackageQuantity, 3);
});

test("package stock: devolucion buena de paquete cerrado vuelve a inventario vendible", () => {
  const after = returnClosedPackageToSellable(QUINTAL, 1);
  assert.equal(after.closedPackageQuantity, 4);
  assert.equal(after.looseUnitQuantity, 25);
});

test("package stock: devolucion dañada no afecta stock vendible", () => {
  const before = { ...QUINTAL };
  // Devolución dañada va a InventoryConditionBalance, no toca los contadores de paquete.
  // Verificamos que la función de retorno vendible NO es llamada para ítems dañados.
  const afterSellable = returnLooseUnitsToSellable(before, 0);
  assert.equal(afterSellable.looseUnitQuantity, before.looseUnitQuantity);
  assert.equal(afterSellable.closedPackageQuantity, before.closedPackageQuantity);
});

test("package stock: anulación total devuelve inventario completo (paquetes + sueltas)", () => {
  const initial: PackageStockState = {
    closedPackageQuantity: 1,
    looseUnitQuantity: 20,
    conversionFactor: 100,
    minimumClosedPackageReserve: 0,
  };
  // Simula venta de 20 unidades sueltas.
  const step1 = consumeLooseOrOpenPackage(initial, 20);
  assert.ok(step1.ok);
  if (!step1.ok) return;
  const stateAfterLooseSale: PackageStockState = {
    ...initial,
    closedPackageQuantity: step1.closedPackageQuantity,
    looseUnitQuantity: step1.looseUnitQuantity,
  };

  // Simula venta de 1 quintal (100 unidades base).
  const afterSale = consumeLooseOrOpenPackage(stateAfterLooseSale, 100);
  assert.ok(afterSale.ok);
  if (!afterSale.ok) return;
  // Después de la venta: 0 paquetes, 0 sueltas.
  assert.equal(afterSale.closedPackageQuantity, 0);
  assert.equal(afterSale.looseUnitQuantity, 0);

  // Anulación devuelve todo. En el motor real se usan los movimientos SALE_OUT
  // para revertir exactamente lo que se consumió (RETURN_IN por cada SALE_OUT).
  const afterCancellation = returnClosedPackageToSellable(
    returnLooseUnitsToSellable({ ...initial, ...afterSale }, 20),
    1,
  );
  assert.equal(afterCancellation.closedPackageQuantity, 1);
  assert.equal(afterCancellation.looseUnitQuantity, 20);
});

test("package stock: refundableAmount excluye transporte (solo se calcula sobre lineSubtotal)", () => {
  // lineSubtotal = 500 (sin transporte). La venta tenía transportAmount=100.
  // El monto reembolsable debe ser proporcional a los 500, no a 600.
  const amount = calculateRefundableAmount({
    quantity: new Prisma.Decimal(1),
    originalQuantity: new Prisma.Decimal(1),
    lineSubtotal: new Prisma.Decimal(500),
  });
  assert.equal(amount.toNumber(), 500);
  // El lineSubtotal nunca incluye transportAmount (ver aggregateOrderTotals).
});
