import assert from "node:assert/strict";
import test from "node:test";
import { Prisma } from "@prisma/client";
import { getWacHistory, reconstructWacHistory, WacHistoryMovementInput } from "@/modules/inventory/wac-history";

/**
 * "que el WAC deje de moverse sin que nadie lo decida, y poder ver de
 * dónde salió cada valor" — PARTE A. reconstructWacHistory reproduce,
 * movimiento por movimiento y con la MISMA función (recalculateWeightedAverage),
 * la cuenta que createInventoryMovementTx ya hace en producción — para
 * poder auditarla, no para reimplementarla.
 */

type MvArgs = {
  id?: string;
  createdAt?: Date;
  movementType: string;
  referenceType?: string;
  referenceId?: string;
  quantity: number;
  unitCost: number;
  conversionFactorSnapshot?: number | null;
  inputUnit?: string | null;
  inputQuantity?: number | null;
  userId?: string | null;
  notes?: string | null;
};

function mv(partial: MvArgs): WacHistoryMovementInput {
  return {
    id: partial.id ?? `mv-${Math.random().toString(36).slice(2)}`,
    createdAt: partial.createdAt ?? new Date("2026-01-01T00:00:00Z"),
    movementType: partial.movementType,
    referenceType: partial.referenceType ?? "PURCHASE",
    referenceId: partial.referenceId ?? "REF-1",
    quantity: new Prisma.Decimal(partial.quantity),
    unitCost: new Prisma.Decimal(partial.unitCost),
    conversionFactorSnapshot: partial.conversionFactorSnapshot != null ? new Prisma.Decimal(partial.conversionFactorSnapshot) : null,
    inputUnit: partial.inputUnit ?? null,
    inputQuantity: partial.inputQuantity != null ? new Prisma.Decimal(partial.inputQuantity) : null,
    userId: partial.userId ?? "user-1",
    notes: partial.notes ?? null,
  };
}

test("7. Secuencia de tres entradas conocidas → el WAC reconstruido coincide con el calculado paso a paso", () => {
  // 1) 10 @ 100 -> wac=100, qty=10
  // 2) 10 @ 200 -> existente 10*100=1000, entra 10*200=2000, wac=(1000+2000)/20=150, qty=20
  // 3) 20 @ 100 -> existente 20*150=3000, entra 20*100=2000, wac=(3000+2000)/40=125, qty=40
  const movements = [
    mv({ movementType: "PURCHASE_IN", quantity: 10, unitCost: 100 }),
    mv({ movementType: "PURCHASE_IN", quantity: 10, unitCost: 200 }),
    mv({ movementType: "PURCHASE_IN", quantity: 20, unitCost: 100 }),
  ];
  const result = reconstructWacHistory(movements);
  assert.equal(result.reconstructedWac, 125);
  assert.equal(result.reconstructedQty, 40);
  assert.equal(result.rows[0].wacAfter, 100);
  assert.equal(result.rows[1].wacAfter, 150);
  assert.equal(result.rows[2].wacAfter, 125);
  assert.equal(result.rows.every((r) => !r.excludedFromReplay), true);
});

test("8. Una salida entre medio NO cambia el WAC reconstruido (el WAC se preserva en salidas)", () => {
  const movements = [
    mv({ movementType: "PURCHASE_IN", quantity: 10, unitCost: 100 }),
    mv({ movementType: "SALE_OUT", quantity: 4, unitCost: 0, referenceType: "SALE" }),
  ];
  const result = reconstructWacHistory(movements);
  assert.equal(result.reconstructedWac, 100, "una salida preserva el WAC, no lo promedia contra su propio costo (0)");
  assert.equal(result.reconstructedQty, 6);
  assert.equal(result.rows[1].wacBefore, 100);
  assert.equal(result.rows[1].wacAfter, 100);
  assert.equal(result.rows[1].wacDelta, 0);
});

test("PACKAGE_AUTO_OPENED/PACKAGE_OPENED/PACKAGE_CLOSED se excluyen de la reconstrucción — no tocan weightedAverageCost en produccion", () => {
  const movements = [
    mv({ movementType: "PURCHASE_IN", quantity: 10, unitCost: 100 }),
    mv({ movementType: "PACKAGE_AUTO_OPENED", quantity: 1, unitCost: 100 }),
    mv({ movementType: "PACKAGE_OPENED", quantity: 1, unitCost: 100 }),
    mv({ movementType: "PACKAGE_CLOSED", quantity: 1, unitCost: 100 }),
  ];
  const result = reconstructWacHistory(movements);
  assert.equal(result.reconstructedWac, 100, "las filas de re-composición no deben mover el WAC reconstruido");
  assert.equal(result.reconstructedQty, 10, "tampoco deben sumar/restar cantidad — son un cambio de forma, no de cantidad");
  assert.equal(result.rows[1].excludedFromReplay, true);
  assert.equal(result.rows[2].excludedFromReplay, true);
  assert.equal(result.rows[3].excludedFromReplay, true);
});

test("RETURN_IN_DAMAGED se excluye — sales-returns/service.ts la escribe contra InventoryConditionBalance, nunca contra el WAC normal", () => {
  const movements = [
    mv({ movementType: "PURCHASE_IN", quantity: 10, unitCost: 100 }),
    mv({ movementType: "RETURN_IN_DAMAGED", quantity: 3, unitCost: 100, referenceType: "SALE_RETURN_DAMAGED" }),
  ];
  const result = reconstructWacHistory(movements);
  assert.equal(result.reconstructedWac, 100);
  assert.equal(result.reconstructedQty, 10, "RETURN_IN_DAMAGED no suma al inventario normal — vive en la bodega de dañados");
  assert.equal(result.rows[1].excludedFromReplay, true);
});

test("reversión EXPLICIT con costo 0 (venta legado sin costo) restaura cantidad SIN promediar contra costo 0", () => {
  const movements = [
    mv({ movementType: "PURCHASE_IN", quantity: 10, unitCost: 100 }),
    mv({ movementType: "SALE_OUT", quantity: 4, unitCost: 0, referenceType: "SALE" }),
    // Reversión de esa venta con costo 0 (dato legado) — el 'inbound' que
    // restaura la cantidad no debe promediar el WAC contra un costo de 0.
    mv({ movementType: "RETURN_IN", quantity: 4, unitCost: 0, referenceType: "SALE_CANCEL" }),
  ];
  const result = reconstructWacHistory(movements);
  assert.equal(result.reconstructedWac, 100, "restaurar con costo 0 no debe corromper el WAC");
  assert.equal(result.reconstructedQty, 10);
});

/**
 * "Si el valor reconstruido al final NO coincide con el weightedAverageCost
 * que está hoy en InventoryBalance, devolvé esa discrepancia
 * explícitamente" — getWacHistory con una base de datos falsa en memoria
 * (mismo patrón que fusion-test-support.ts: solo los métodos que
 * realmente se llaman). Test 9: ESTE ES EL QUE IMPORTA — es lo que
 * detecta una escritura del WAC fuera del historial de movimientos.
 */
function fakeDb(input: {
  movements: WacHistoryMovementInput[];
  storedWac: number;
  productId?: string;
}) {
  const productId = input.productId ?? "prod-1";
  return {
    productStockGroupMember: {
      findFirst: async () => null, // producto simple, sin fusión
    },
    inventoryMovement: {
      findMany: async () => input.movements.map((m) => ({ ...m, branchId: "branch-1", productId })),
    },
    inventoryBalance: {
      findUnique: async () => ({
        id: "bal-1",
        branchId: "branch-1",
        productId,
        quantityOnHand: new Prisma.Decimal(0),
        weightedAverageCost: new Prisma.Decimal(input.storedWac),
        inventoryValue: new Prisma.Decimal(0),
      }),
    },
    product: {
      findUnique: async ({ where }: { where: { id: string } }) =>
        where.id === productId ? { id: productId, sku: "SKU-1", name: "Producto de prueba" } : null,
    },
    user: {
      findMany: async () => [{ id: "user-1", username: "operador1", fullName: "Operador Uno" }],
    },
  } as any;
}

test("9. Si el balance almacenado difiere del reconstruido, matches es false — detecta una escritura fuera del historial", async () => {
  const movements = [mv({ movementType: "PURCHASE_IN", quantity: 10, unitCost: 100 })];
  const db = fakeDb({ movements, storedWac: 999 }); // 999 no tiene relación con lo que dan los movimientos (100)
  const result = await getWacHistory(db, { productId: "prod-1", branchId: "branch-1" });
  assert.equal(result.reconstructed, 100);
  assert.equal(result.stored, 999);
  assert.equal(result.matches, false, "un WAC guardado que no sale de ningún movimiento es exactamente el hallazgo que este endpoint debe exponer");
});

test("getWacHistory: cuando el balance SÍ coincide con lo reconstruido, matches es true", async () => {
  const movements = [mv({ movementType: "PURCHASE_IN", quantity: 10, unitCost: 100 })];
  const db = fakeDb({ movements, storedWac: 100 });
  const result = await getWacHistory(db, { productId: "prod-1", branchId: "branch-1" });
  assert.equal(result.matches, true);
  assert.equal(result.movementCount, 1);
  assert.deepEqual(result.breakdownByReferenceType, { PURCHASE: 1 });
});

test("getWacHistory: trae el nombre del actor a partir de userId (actorName)", async () => {
  const movements = [mv({ movementType: "PURCHASE_IN", quantity: 10, unitCost: 100, userId: "user-1" })];
  const db = fakeDb({ movements, storedWac: 100 });
  const result = await getWacHistory(db, { productId: "prod-1", branchId: "branch-1" });
  assert.equal((result.rows[0] as any).actorName, "Operador Uno");
});
