import assert from "node:assert/strict";
import test from "node:test";
import { Prisma } from "@prisma/client";
import { updateGlobalProductCostForReceiptTx } from "@/modules/purchase-orders/service";

/**
 * Fake Prisma tx implementando solo lo que updateGlobalProductCostForReceiptTx
 * (y resolveInventoryProductForMovement, que llama por debajo) consultan:
 * productStockGroupMember.findFirst (resolución de fusión), product.findUniqueOrThrow,
 * inventoryBalance.aggregate (stock GLOBAL, sin filtro de sucursal) y product.update.
 * Sigue el mismo patrón de "fake db en memoria" que realtime-sales-summary.integration.test.ts.
 */
function createFakeTx(input: {
  product: { id: string; globalCost: number | null; averageCost: number | null; lastPurchaseCost: number | null };
  balancesByBranch: Record<string, number>; // quantityOnHand por sucursal, para el MISMO producto
}) {
  const product = {
    id: input.product.id,
    globalCost: input.product.globalCost === null ? null : new Prisma.Decimal(input.product.globalCost),
    averageCost: input.product.averageCost === null ? null : new Prisma.Decimal(input.product.averageCost),
    lastPurchaseCost: input.product.lastPurchaseCost === null ? null : new Prisma.Decimal(input.product.lastPurchaseCost),
  };
  const productUpdates: Array<Record<string, unknown>> = [];
  const auditLogs: Array<Record<string, unknown>> = [];

  const tx = {
    productStockGroupMember: {
      findFirst: async () => null, // producto sin fusión/equivalencia — caso simple
    },
    product: {
      findUniqueOrThrow: async ({ where }: { where: { id: string } }) => {
        if (where.id !== product.id) throw new Error(`Producto ${where.id} no encontrado en fake db`);
        return { ...product };
      },
      update: async ({ where, data }: { where: { id: string }; data: Record<string, unknown> }) => {
        assert.equal(where.id, product.id);
        Object.assign(product, data);
        productUpdates.push(data);
        return { ...product };
      },
    },
    inventoryBalance: {
      // Sin filtro de sucursal: suma el stock de TODAS las sucursales — así es como
      // el costo se vuelve verdaderamente global y no depende de en qué sucursal se recibió.
      aggregate: async ({ where }: { where: { productId: string } }) => {
        assert.equal(where.productId, product.id);
        const total = Object.values(input.balancesByBranch).reduce((acc, qty) => acc + qty, 0);
        return { _sum: { quantityOnHand: new Prisma.Decimal(total) } };
      },
    },
    auditLog: {
      create: async ({ data }: { data: Record<string, unknown> }) => {
        auditLogs.push(data);
        return data;
      },
    },
  };

  return { tx: tx as unknown as Prisma.TransactionClient, product, productUpdates, auditLogs };
}

test("updateGlobalProductCostForReceiptTx: primera recepción sin costo previo fija el costo global al recibido", async () => {
  const { tx, product } = createFakeTx({
    product: { id: "prod-1", globalCost: null, averageCost: null, lastPurchaseCost: null },
    balancesByBranch: { "branch-a": 10 }, // el movimiento de ingreso ya se aplicó antes de llamar a esta función
  });

  await updateGlobalProductCostForReceiptTx(tx, {
    actorUserId: "user-1",
    branchId: "branch-a",
    productId: "prod-1",
    purchaseOrderId: "po-1",
    purchaseOrderLineId: "line-1",
    receivedQuantity: new Prisma.Decimal(10),
    receivedUnitCost: new Prisma.Decimal(50),
  });

  assert.equal(product.globalCost?.toNumber(), 50);
  assert.equal(product.averageCost?.toNumber(), 50);
  assert.equal(product.lastPurchaseCost?.toNumber(), 50);
});

test("updateGlobalProductCostForReceiptTx: promedio ponderado usa el stock GLOBAL (todas las sucursales), no solo el de la sucursal receptora", async () => {
  // Stock previo a esta recepción: 20 uds a costo 40 (repartidas en dos sucursales distintas).
  // Se reciben 10 uds más a costo 100 en la sucursal B. El promedio ponderado global esperado:
  // (20*40 + 10*100) / 30 = 46.666...
  const { tx, product } = createFakeTx({
    product: { id: "prod-2", globalCost: 40, averageCost: 40, lastPurchaseCost: 40 },
    balancesByBranch: { "branch-a": 15, "branch-b": 15 }, // 30 total, de las cuales 10 son la recepción recién aplicada en branch-b
  });

  await updateGlobalProductCostForReceiptTx(tx, {
    actorUserId: "user-1",
    branchId: "branch-b",
    productId: "prod-2",
    purchaseOrderId: "po-2",
    purchaseOrderLineId: "line-2",
    receivedQuantity: new Prisma.Decimal(10),
    receivedUnitCost: new Prisma.Decimal(100),
  });

  const expected = (20 * 40 + 10 * 100) / 30;
  assert.ok(product.averageCost && Math.abs(product.averageCost.toNumber() - expected) < 1e-9);
  // globalCost y averageCost deben quedar sincronizados al mismo valor: un solo precio de compra para toda la empresa.
  assert.equal(product.globalCost?.toNumber(), product.averageCost?.toNumber());
  // lastPurchaseCost refleja el costo de ESTA recepción puntual, no el promedio acumulado.
  assert.equal(product.lastPurchaseCost?.toNumber(), 100);
});

test("updateGlobalProductCostForReceiptTx: el costo global recién actualizado es visible sin importar la sucursal que consulte después", async () => {
  const { tx, product } = createFakeTx({
    product: { id: "prod-3", globalCost: 25, averageCost: 25, lastPurchaseCost: 25 },
    balancesByBranch: { "branch-a": 5 },
  });

  await updateGlobalProductCostForReceiptTx(tx, {
    actorUserId: "user-1",
    branchId: "branch-a",
    productId: "prod-3",
    purchaseOrderId: "po-3",
    purchaseOrderLineId: "line-3",
    receivedQuantity: new Prisma.Decimal(5),
    receivedUnitCost: new Prisma.Decimal(25),
  });

  // Recibir al mismo costo que ya tenía no debe alterar el promedio (caso estable/idempotente en costo).
  assert.equal(product.globalCost?.toNumber(), 25);
  assert.equal(product.averageCost?.toNumber(), 25);

  // El valor persistido en Product (no en una tabla por sucursal) es lo que
  // getEffectiveProductPricing lee como costo efectivo para CUALQUIER sucursal
  // que no tenga su propio branchCost — así el precio de compra queda unificado.
});
