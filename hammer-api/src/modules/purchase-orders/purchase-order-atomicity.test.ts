import assert from "node:assert/strict";
import test from "node:test";
import { Prisma } from "@prisma/client";
import {
  approvePurchaseOrderTx,
  receivePurchaseOrderTx,
  cancelPurchaseOrderTx,
} from "@/modules/purchase-orders/service";

/**
 * prompt-seguridad-basica.md Fase 1 — approvePurchaseOrder/receivePurchaseOrder/
 * cancelPurchaseOrder leían el estado fuera de la transacción (o, en
 * receivePurchaseOrder, calculaban `pendingByProduct` con un `groupBy` FUERA
 * del lock) y actualizaban sin condición: un doble click repetía la
 * operación. PurchaseOrderStatus NO tiene PARTIALLY_RECEIVED — una recepción
 * parcial deja la orden en APPROVED, por eso el fix real es recalcular el
 * pendiente DESPUÉS del lock, no solo un CAS de status. Fake tx en memoria
 * (sin fusión, updateGlobalCost:false para no arrastrar todo el motor de
 * costo global — eso ya lo cubre global-cost-update.test.ts).
 */

const BRANCH_ID = "branch-1";
const PRODUCT_ID = "prod-1";
const PO_ID = "po-1";
const LINE_ID = "po-line-1";

type Balance = {
  id: string;
  branchId: string;
  productId: string;
  quantityOnHand: Prisma.Decimal;
  closedPackageQuantity: Prisma.Decimal;
  looseUnitQuantity: Prisma.Decimal;
  weightedAverageCost: Prisma.Decimal;
  inventoryValue: Prisma.Decimal;
};

function createPoFakeStore(opts: {
  status?: string;
  quantity?: number;
  unitCost?: number;
} = {}) {
  const po = {
    id: PO_ID,
    orderNumber: "PO-TEST-1",
    status: opts.status ?? "APPROVED",
    branchId: BRANCH_ID,
    supplierId: null as string | null,
    supplier: "Proveedor Test",
    supplierNameSnapshot: null as string | null,
    total: new Prisma.Decimal(1000),
    dueDate: null as Date | null,
    paymentTermDaysSnapshot: 30,
  };

  const lines = [{
    id: LINE_ID,
    purchaseOrderId: PO_ID,
    productId: PRODUCT_ID,
    quantity: new Prisma.Decimal(opts.quantity ?? 100),
    unitCostBeforeTax: new Prisma.Decimal(opts.unitCost ?? 10),
    unitCost: new Prisma.Decimal(opts.unitCost ?? 10),
    product: { id: PRODUCT_ID, name: "Producto de prueba" },
  }];

  const branch = { id: BRANCH_ID, code: "SUC1", name: "Sucursal 1" };

  const balances = new Map<string, Balance>();
  const key = (branchId: string, productId: string) => `${branchId}:${productId}`;

  const movements: Array<Record<string, unknown> & { id: string; movementType: string; productId: string; referenceType: string; referenceId: string; quantity: Prisma.Decimal }> = [];
  const auditLogs: Array<Record<string, unknown>> = [];
  let movementSeq = 0;

  const product = {
    id: PRODUCT_ID,
    standardSalePrice: new Prisma.Decimal(20),
    globalCost: new Prisma.Decimal(10),
    averageCost: new Prisma.Decimal(10),
    lastPurchaseCost: new Prisma.Decimal(10),
    categoryId: "cat-1",
    category: { code: "GEN", name: "General" },
  };

  const tx = {
    $queryRaw: async () => [],
    systemSetting: { findUnique: async () => null },
    productStockGroupMember: { findFirst: async () => null },
    inventoryBalance: {
      upsert: async ({ where }: { where: { branchId_productId: { branchId: string; productId: string } } }) => {
        const k = key(where.branchId_productId.branchId, where.branchId_productId.productId);
        if (!balances.has(k)) {
          balances.set(k, {
            id: `bal-${k}`,
            branchId: where.branchId_productId.branchId,
            productId: where.branchId_productId.productId,
            quantityOnHand: new Prisma.Decimal(0),
            closedPackageQuantity: new Prisma.Decimal(0),
            looseUnitQuantity: new Prisma.Decimal(0),
            weightedAverageCost: new Prisma.Decimal(0),
            inventoryValue: new Prisma.Decimal(0),
          });
        }
        return balances.get(k)!;
      },
      findUnique: async ({ where }: { where: { branchId_productId: { branchId: string; productId: string } } }) =>
        balances.get(key(where.branchId_productId.branchId, where.branchId_productId.productId)) ?? null,
      update: async ({ where, data }: { where: { id: string }; data: Record<string, unknown> }) => {
        const row = [...balances.values()].find((b) => b.id === where.id);
        if (!row) throw new Error("balance not found");
        Object.assign(row, data);
        return row;
      },
    },
    inventoryMovement: {
      create: async ({ data }: { data: Record<string, unknown> & { movementType: string; productId: string; referenceType: string; referenceId: string; quantity: Prisma.Decimal } }) => {
        movementSeq += 1;
        const row = { id: `mv-${movementSeq}`, ...data };
        movements.push(row);
        return row;
      },
      groupBy: async ({ where }: { where: { referenceType?: string; referenceId?: string; movementType?: string; productId?: { in: string[] } } }) => {
        const matches = movements.filter((m) =>
          (!where.referenceType || m.referenceType === where.referenceType)
          && (!where.referenceId || m.referenceId === where.referenceId)
          && (!where.movementType || m.movementType === where.movementType)
          && (!where.productId || where.productId.in.includes(m.productId)),
        );
        const byProduct = new Map<string, Prisma.Decimal>();
        for (const m of matches) {
          const prev = byProduct.get(m.productId) ?? new Prisma.Decimal(0);
          byProduct.set(m.productId, prev.add(m.quantity));
        }
        return [...byProduct.entries()].map(([productId, sum]) => ({ productId, _sum: { quantity: sum } }));
      },
      count: async ({ where }: { where: { referenceType?: string; referenceId?: string; movementType?: string } }) =>
        movements.filter((m) =>
          (!where.referenceType || m.referenceType === where.referenceType)
          && (!where.referenceId || m.referenceId === where.referenceId)
          && (!where.movementType || m.movementType === where.movementType),
        ).length,
    },
    product: {
      findUnique: async () => product,
      findUniqueOrThrow: async () => product,
    },
    branchProductSetting: {
      findUnique: async () => null,
    },
    branchCategoryPricingPolicy: {
      findUnique: async () => null,
    },
    category: {
      findUnique: async () => ({ code: "GEN", name: "General" }),
    },
    auditLog: {
      create: async ({ data }: { data: Record<string, unknown> }) => {
        auditLogs.push(data);
        return data;
      },
    },
    purchaseOrder: {
      findUnique: async () => ({ ...po, lines, branch }),
      findUniqueOrThrow: async () => ({ ...po, lines, branch }),
      updateMany: async ({ where, data }: { where: { id: string; status: string }; data: Record<string, unknown> }) => {
        if (where.id !== po.id || where.status !== po.status) return { count: 0 };
        Object.assign(po, data);
        return { count: 1 };
      },
    },
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
  } as any;

  return { tx: tx as Prisma.TransactionClient, po, lines, movements, auditLogs, balances };
}

test("LA QUE IMPORTA — doble approvePurchaseOrder: el segundo falla, sin doble aprobación", async () => {
  const { tx, po } = createPoFakeStore({ status: "DRAFT" });
  const first = await approvePurchaseOrderTx(tx, PO_ID, "user-1");
  assert.equal(first.status, "APPROVED");
  await assert.rejects(() => approvePurchaseOrderTx(tx, PO_ID, "user-1"), /ALREADY_PROCESSED/);
  assert.equal(po.status, "APPROVED");
});

test("LA QUE IMPORTA — doble receivePurchaseOrder con recepcion total (doble click/reintento): el segundo no encuentra pendiente y no duplica el movimiento de entrada", async () => {
  const { tx, movements } = createPoFakeStore({ status: "APPROVED", quantity: 100 });

  const first = await receivePurchaseOrderTx(tx, PO_ID, "user-1", { updateGlobalCost: false });
  assert.equal(first.statusAfter, "RECEIVED");
  const inMovements = movements.filter((m) => m.movementType === "PURCHASE_IN");
  assert.equal(inMovements.length, 1);

  // Reintento: el status ya es RECEIVED -> rechazo inmediato (ALREADY_PROCESSED).
  await assert.rejects(() => receivePurchaseOrderTx(tx, PO_ID, "user-1", { updateGlobalCost: false }), /ALREADY_PROCESSED/);
  assert.equal(movements.filter((m) => m.movementType === "PURCHASE_IN").length, 1, "el segundo intento no recibe de nuevo");
});

test("receivePurchaseOrder parcial: el segundo intento recalcula el pendiente FRESCO (groupBy dentro del lock) y no sobre-recibe", async () => {
  const { tx, movements } = createPoFakeStore({ status: "APPROVED", quantity: 100 });

  const first = await receivePurchaseOrderTx(tx, PO_ID, "user-1", {
    updateGlobalCost: false,
    items: [{ productId: PRODUCT_ID, quantityReceived: 60 }],
  });
  assert.equal(first.statusAfter, "PARTIALLY_RECEIVED");
  assert.equal(movements.filter((m) => m.movementType === "PURCHASE_IN").length, 1);

  // Reintento pidiendo MAS de lo que ya queda pendiente (40) -> debe
  // rechazarse contra el pendiente FRESCO (40), no el original (100).
  await assert.rejects(
    () => receivePurchaseOrderTx(tx, PO_ID, "user-1", {
      updateGlobalCost: false,
      items: [{ productId: PRODUCT_ID, quantityReceived: 60 }],
    }),
    /No se puede recibir mas de lo pendiente/,
  );
  assert.equal(movements.filter((m) => m.movementType === "PURCHASE_IN").length, 1, "el reintento no debe crear un segundo movimiento");
});

test("LA QUE IMPORTA — doble cancelPurchaseOrder: el segundo falla", async () => {
  const { tx, po } = createPoFakeStore({ status: "DRAFT" });
  const first = await cancelPurchaseOrderTx(tx, PO_ID, "user-1");
  assert.equal(first.status, "CANCELLED");
  await assert.rejects(() => cancelPurchaseOrderTx(tx, PO_ID, "user-1"), /ALREADY_PROCESSED/);
  assert.equal(po.status, "CANCELLED");
});
