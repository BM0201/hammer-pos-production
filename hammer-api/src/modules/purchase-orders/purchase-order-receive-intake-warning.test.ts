import assert from "node:assert/strict";
import test from "node:test";
import { Prisma } from "@prisma/client";
import { receivePurchaseOrderTx } from "@/modules/purchase-orders/service";

/**
 * Fase 3 (prompt-entrada-inventario.md) — "si se recibe una orden de un
 * producto que tuvo un ADD_STOCK manual en las últimas 48h en esa sucursal,
 * avisar antes de confirmar... No bloquea." Mismo fake tx en memoria que
 * purchase-order-atomicity.test.ts (recepción simple, updateGlobalCost:false),
 * extendido con inventoryMovement.findMany + multiBranchIntake.findMany —
 * lo único nuevo que findRecentManualAddStockCodesTx necesita.
 */

const BRANCH_ID = "branch-1";
const PRODUCT_ID = "prod-1";
const PO_ID = "po-1";
const LINE_ID = "po-line-1";

function hoursAgo(h: number): Date {
  return new Date(Date.now() - h * 60 * 60 * 1000);
}

function createPoFakeStore(opts: {
  priorMovements?: Array<{ productId: string; referenceType: string; referenceId: string; movementType: string; createdAt: Date }>;
  intakes?: Array<{ id: string; code: string; kind: string }>;
} = {}) {
  const po = {
    id: PO_ID, orderNumber: "PO-TEST-1", status: "APPROVED", branchId: BRANCH_ID,
    supplierId: null as string | null, supplier: "Proveedor Test", supplierNameSnapshot: null as string | null,
    total: new Prisma.Decimal(1000), dueDate: null as Date | null, paymentTermDaysSnapshot: 30,
  };
  const lines = [{
    id: LINE_ID, purchaseOrderId: PO_ID, productId: PRODUCT_ID,
    quantity: new Prisma.Decimal(100), unitCostBeforeTax: new Prisma.Decimal(10), unitCost: new Prisma.Decimal(10),
    product: { id: PRODUCT_ID, name: "Producto de prueba" },
  }];
  const branch = { id: BRANCH_ID, code: "SUC1", name: "Sucursal 1" };
  const balances = new Map<string, { id: string; branchId: string; productId: string; quantityOnHand: Prisma.Decimal; closedPackageQuantity: Prisma.Decimal; looseUnitQuantity: Prisma.Decimal; weightedAverageCost: Prisma.Decimal; inventoryValue: Prisma.Decimal }>();
  const key = (branchId: string, productId: string) => `${branchId}:${productId}`;
  const movements: Array<Record<string, unknown> & { id: string; movementType: string; productId: string; referenceType: string; referenceId: string; quantity: Prisma.Decimal; createdAt: Date }> = (opts.priorMovements ?? []).map((m, i) => ({
    id: `prior-mv-${i}`, quantity: new Prisma.Decimal(1), ...m,
  }));
  const intakes = opts.intakes ?? [];
  const auditLogs: Array<Record<string, unknown>> = [];
  let movementSeq = 0;
  const product = { id: PRODUCT_ID, standardSalePrice: new Prisma.Decimal(20), globalCost: new Prisma.Decimal(10), averageCost: new Prisma.Decimal(10), lastPurchaseCost: new Prisma.Decimal(10), categoryId: "cat-1", category: { code: "GEN", name: "General" } };

  const tx = {
    $queryRaw: async () => [],
    systemSetting: { findUnique: async () => null },
    productStockGroupMember: { findFirst: async () => null },
    inventoryBalance: {
      upsert: async ({ where }: { where: { branchId_productId: { branchId: string; productId: string } } }) => {
        const k = key(where.branchId_productId.branchId, where.branchId_productId.productId);
        if (!balances.has(k)) balances.set(k, { id: `bal-${k}`, branchId: where.branchId_productId.branchId, productId: where.branchId_productId.productId, quantityOnHand: new Prisma.Decimal(0), closedPackageQuantity: new Prisma.Decimal(0), looseUnitQuantity: new Prisma.Decimal(0), weightedAverageCost: new Prisma.Decimal(0), inventoryValue: new Prisma.Decimal(0) });
        return balances.get(k)!;
      },
      findUnique: async ({ where }: { where: { branchId_productId: { branchId: string; productId: string } } }) => balances.get(key(where.branchId_productId.branchId, where.branchId_productId.productId)) ?? null,
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
        const row = { id: `mv-${movementSeq}`, createdAt: new Date(), ...data };
        movements.push(row);
        return row;
      },
      groupBy: async ({ where }: { where: { referenceType?: string; referenceId?: string; movementType?: string; productId?: { in: string[] } } }) => {
        const matches = movements.filter((m) => (!where.referenceType || m.referenceType === where.referenceType) && (!where.referenceId || m.referenceId === where.referenceId) && (!where.movementType || m.movementType === where.movementType) && (!where.productId || where.productId.in.includes(m.productId)));
        const byProduct = new Map<string, Prisma.Decimal>();
        for (const m of matches) byProduct.set(m.productId, (byProduct.get(m.productId) ?? new Prisma.Decimal(0)).add(m.quantity));
        return [...byProduct.entries()].map(([productId, sum]) => ({ productId, _sum: { quantity: sum } }));
      },
      count: async ({ where }: { where: { referenceType?: string; referenceId?: string; movementType?: string } }) => movements.filter((m) => (!where.referenceType || m.referenceType === where.referenceType) && (!where.referenceId || m.referenceId === where.referenceId) && (!where.movementType || m.movementType === where.movementType)).length,
      findMany: async ({ where }: { where: { branchId: string; productId: { in: string[] }; referenceType: string; movementType: string; createdAt: { gte: Date } } }) =>
        movements
          .filter((m) => m.branchId === where.branchId && where.productId.in.includes(m.productId) && m.referenceType === where.referenceType && m.movementType === where.movementType && m.createdAt >= where.createdAt.gte)
          .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime())
          .map((m) => ({ productId: m.productId, referenceId: m.referenceId })),
    },
    multiBranchIntake: {
      findMany: async ({ where }: { where: { id: { in: string[] }; kind: { in: string[] } } }) => intakes.filter((i) => where.id.in.includes(i.id) && where.kind.in.includes(i.kind)),
    },
    product: { findUnique: async () => product, findUniqueOrThrow: async () => product },
    branchProductSetting: { findUnique: async () => null },
    branchCategoryPricingPolicy: { findUnique: async () => null },
    pricingConfig: { findUnique: async () => null },
    category: { findUnique: async () => ({ code: "GEN", name: "General" }) },
    auditLog: { create: async ({ data }: { data: Record<string, unknown> }) => { auditLogs.push(data); return data; } },
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

  // movements seedeados antes de la recepción necesitan branchId para el filtro de arriba.
  for (const m of movements) (m as Record<string, unknown>).branchId = BRANCH_ID;

  return { tx: tx as Prisma.TransactionClient, movements, auditLogs };
}

test("LA QUE IMPORTA — recepción de OC avisa (no bloquea) si el mismo producto/sucursal tuvo un ADD_STOCK manual en las últimas 48h", async () => {
  const { tx } = createPoFakeStore({
    priorMovements: [{ productId: PRODUCT_ID, referenceType: "MULTI_BRANCH_INTAKE", referenceId: "intake-1", movementType: "ADJUSTMENT_IN", createdAt: hoursAgo(10) }],
    intakes: [{ id: "intake-1", code: "IM-000123", kind: "ADD_STOCK" }],
  });
  const result = await receivePurchaseOrderTx(tx, PO_ID, "user-1", { updateGlobalCost: false });
  assert.equal(result.statusAfter, "RECEIVED");
  assert.ok(result.warnings.some((w: string) => w.includes("IM-000123")), `esperaba un aviso con IM-000123, recibí: ${JSON.stringify(result.warnings)}`);
});

test("un ADD_STOCK manual de hace más de 48h NO genera el aviso", async () => {
  const { tx } = createPoFakeStore({
    priorMovements: [{ productId: PRODUCT_ID, referenceType: "MULTI_BRANCH_INTAKE", referenceId: "intake-1", movementType: "ADJUSTMENT_IN", createdAt: hoursAgo(72) }],
    intakes: [{ id: "intake-1", code: "IM-000123", kind: "ADD_STOCK" }],
  });
  const result = await receivePurchaseOrderTx(tx, PO_ID, "user-1", { updateGlobalCost: false });
  assert.ok(!result.warnings.some((w: string) => w.includes("IM-000123")));
});

test("un PHYSICAL_COUNT o CARGA INICIAL reciente NO genera el aviso — solo ADD_STOCK cuenta como 'la misma mercadería que ya entró'", async () => {
  const { tx } = createPoFakeStore({
    priorMovements: [{ productId: PRODUCT_ID, referenceType: "MULTI_BRANCH_INTAKE", referenceId: "intake-2", movementType: "ADJUSTMENT_IN", createdAt: hoursAgo(5) }],
    intakes: [{ id: "intake-2", code: "IM-000200", kind: "PHYSICAL_COUNT" }],
  });
  const result = await receivePurchaseOrderTx(tx, PO_ID, "user-1", { updateGlobalCost: false });
  assert.ok(!result.warnings.some((w: string) => w.includes("IM-000200")));
});

test("ADJUSTMENT_IN (alias legado de ADD_STOCK) SÍ genera el aviso", async () => {
  const { tx } = createPoFakeStore({
    priorMovements: [{ productId: PRODUCT_ID, referenceType: "MULTI_BRANCH_INTAKE", referenceId: "intake-3", movementType: "ADJUSTMENT_IN", createdAt: hoursAgo(1) }],
    intakes: [{ id: "intake-3", code: "IM-000300", kind: "ADJUSTMENT_IN" }],
  });
  const result = await receivePurchaseOrderTx(tx, PO_ID, "user-1", { updateGlobalCost: false });
  assert.ok(result.warnings.some((w: string) => w.includes("IM-000300")));
});

test("sin ningún ADD_STOCK manual reciente, la recepción sigue sin avisos de este tipo", async () => {
  const { tx } = createPoFakeStore();
  const result = await receivePurchaseOrderTx(tx, PO_ID, "user-1", { updateGlobalCost: false });
  assert.equal(result.statusAfter, "RECEIVED");
  assert.ok(!result.warnings.some((w: string) => w.includes("sumó a mano")));
});
