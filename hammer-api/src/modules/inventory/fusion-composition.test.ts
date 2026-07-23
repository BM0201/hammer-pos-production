import assert from "node:assert/strict";
import test from "node:test";
import { createInventoryMovementTx } from "@/modules/inventory/service";
import { createFusionFakeTx, type FusionWorldConfig } from "@/modules/inventory/fusion-test-support";

/**
 * Fusión de Inventario v2, Fase 1.1 — la primitiva única de composición
 * (createInventoryMovementTx con composition: BASE_AUTO) reemplaza la lógica
 * que antes vivía duplicada en consumeSharedStockForSaleTx.
 *
 * Escenario: "Clavo acero 2\"" — 1 caja = 25 libras (factor elegido para el
 * caso de prueba; el proyecto real usa factores por preset).
 */
const BASE_CONFIG: FusionWorldConfig = {
  branchId: "branch-mga",
  stockGroupId: "group-clavos",
  tracksPackages: true,
  packageUnit: "CAJA",
  baseUnit: "LIBRA",
  conversionFactorToBase: 25,
  minimumClosedPackageReserve: 1,
  autoOpenForUnitSale: true,
  canonicalProductId: "prod-clavo-suelto",
  packageProductId: "prod-clavo-caja",
  packageConversionFactor: 25,
  initialCanonicalBalance: { quantityOnHand: 0, closedPackageQuantity: 0, looseUnitQuantity: 0, weightedAverageCost: 10 },
};

test("Test 2 — Vender 30 lb con 8 sueltas + 12 cajas: auto-apertura de 1 caja, reserva respetada, invariante intacta", async () => {
  const { tx, getBalance } = createFusionFakeTx({
    ...BASE_CONFIG,
    initialCanonicalBalance: { quantityOnHand: 12 * 25 + 8, closedPackageQuantity: 12, looseUnitQuantity: 8, weightedAverageCost: 10 },
  });

  const result = await createInventoryMovementTx(tx, {
    actorUserId: "user-1",
    branchId: BASE_CONFIG.branchId,
    productId: BASE_CONFIG.canonicalProductId,
    movementType: "SALE_OUT",
    quantity: 30,
    unitCost: 10,
    referenceType: "SALE",
    referenceId: "sale-1",
    composition: { kind: "BASE_AUTO" },
  });

  const balance = getBalance();
  assert.equal(result.autoOpenMovements.length, 1, "debe abrir exactamente 1 caja (30-8=22 lb faltantes, 22/25 redondeado hacia arriba = 1)");
  assert.equal(balance.closedPackageQuantity.toNumber(), 11, "12 cajas - 1 abierta = 11");
  assert.equal(balance.looseUnitQuantity.toNumber(), 3, "8 + 25 (caja abierta) - 30 (venta) = 3");
  assert.equal(balance.quantityOnHand.toNumber(), 278, "308 (stock inicial) - 30 (venta) = 278");
  // Invariante: quantityOnHand == closedPackageQuantity*factor + looseUnitQuantity.
  assert.equal(balance.quantityOnHand.toNumber(), balance.closedPackageQuantity.mul(25).add(balance.looseUnitQuantity).toNumber());
  // La reserva mínima (1 caja) no se tocó: quedaron 11 >= 1.
  assert.ok(balance.closedPackageQuantity.toNumber() >= 1);
});

test("Test 4 — Ajuste de salida de 20 lb con 5 sueltas y 3 cajas: recompone (abre 1), no lanza error", async () => {
  const { tx, getBalance } = createFusionFakeTx({
    ...BASE_CONFIG,
    initialCanonicalBalance: { quantityOnHand: 3 * 25 + 5, closedPackageQuantity: 3, looseUnitQuantity: 5, weightedAverageCost: 10 },
  });

  await assert.doesNotReject(() => createInventoryMovementTx(tx, {
    actorUserId: "user-1",
    branchId: BASE_CONFIG.branchId,
    productId: BASE_CONFIG.canonicalProductId,
    movementType: "ADJUSTMENT_OUT",
    quantity: 20,
    unitCost: 10,
    referenceType: "MANUAL_ADJUSTMENT",
    referenceId: "adj-1",
    composition: { kind: "BASE_AUTO" },
  }));

  const balance = getBalance();
  assert.equal(balance.closedPackageQuantity.toNumber(), 2, "3 cajas - 1 abierta = 2");
  assert.equal(balance.looseUnitQuantity.toNumber(), 10, "5 + 25 (caja abierta) - 20 (ajuste) = 10");
  assert.equal(balance.quantityOnHand.toNumber(), 60, "80 (stock inicial) - 20 (ajuste) = 60");
  assert.equal(balance.quantityOnHand.toNumber(), balance.closedPackageQuantity.mul(25).add(balance.looseUnitQuantity).toNumber());
});

test("BASE_AUTO respeta la reserva mínima: si abrir dejaría menos de la reserva, lanza el error (no auto-abre igual)", async () => {
  // Solo 1 caja en stock, reserva mínima = 1 → no se puede abrir ninguna sin
  // violar la reserva, aunque falten sueltas.
  const { tx } = createFusionFakeTx({
    ...BASE_CONFIG,
    initialCanonicalBalance: { quantityOnHand: 1 * 25 + 2, closedPackageQuantity: 1, looseUnitQuantity: 2, weightedAverageCost: 10 },
  });

  await assert.rejects(
    () => createInventoryMovementTx(tx, {
      actorUserId: "user-1",
      branchId: BASE_CONFIG.branchId,
      productId: BASE_CONFIG.canonicalProductId,
      movementType: "SALE_OUT",
      quantity: 10,
      unitCost: 10,
      referenceType: "SALE",
      referenceId: "sale-2",
      composition: { kind: "BASE_AUTO" },
    }),
    (error: unknown) => (error as { code?: string }).code === "INSUFFICIENT_LOOSE_AND_RESERVED_PACKAGE_STOCK",
  );
});
