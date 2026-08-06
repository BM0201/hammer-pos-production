import assert from "node:assert/strict";
import test from "node:test";
import { Prisma } from "@prisma/client";
import { previewUnmergeStockGroupTx, unmergeStockGroupTx } from "@/modules/catalog/stock-group-crud";

/**
 * Fusión de Inventario v2, Fase 2.2 — desfusión (reemplaza el bloqueo
 * STOCK_NOT_ZERO). Escenario: "Clavo acero 2\"" — canónico UNIDAD (base) +
 * derivado KILO (factor 216), con 1296 unidades (6 kilos) consolidadas en
 * el canónico. Se desfusiona reasignando todo a la presentación KILO.
 */
const GROUP_ID = "group-clavos";
const BRANCH_ID = "branch-mga";
const CANONICAL_ID = "prod-clavo-unidad";
const PACKAGE_ID = "prod-clavo-kilo";
const FACTOR = 216;

type FakeBalance = {
  branchId: string;
  productId: string;
  quantityOnHand: Prisma.Decimal;
  closedPackageQuantity: Prisma.Decimal;
  looseUnitQuantity: Prisma.Decimal;
  weightedAverageCost: Prisma.Decimal;
};

function createUnmergeFakeTx(initialCanonicalQty: number, initialWac: number) {
  const balances = new Map<string, FakeBalance>();
  const key = (branchId: string, productId: string) => `${branchId}:${productId}`;
  balances.set(key(BRANCH_ID, CANONICAL_ID), {
    branchId: BRANCH_ID,
    productId: CANONICAL_ID,
    quantityOnHand: new Prisma.Decimal(initialCanonicalQty),
    closedPackageQuantity: new Prisma.Decimal(0),
    looseUnitQuantity: new Prisma.Decimal(0),
    weightedAverageCost: new Prisma.Decimal(initialWac),
  });

  const auditLogs: Array<Record<string, unknown>> = [];
  let groupActive = true;
  const memberActive = { [CANONICAL_ID]: true, [PACKAGE_ID]: true };

  const group = {
    id: GROUP_ID,
    code: "GRP-CLAVOS",
    name: "Clavo acero 2\" - stock compartido",
    tracksPackages: true,
    products: [
      { productId: CANONICAL_ID, isCanonical: true, conversionFactor: new Prisma.Decimal(1) },
      { productId: PACKAGE_ID, isCanonical: false, conversionFactor: new Prisma.Decimal(FACTOR) },
    ],
  };

  const tx = {
    productStockGroup: {
      findUnique: async () => (groupActive ? group : null),
      update: async (args: { data: { isActive?: boolean } }) => {
        if (args.data.isActive === false) groupActive = false;
        return { ...group, isActive: groupActive };
      },
    },
    productStockGroupMember: {
      updateMany: async () => {
        memberActive[CANONICAL_ID] = false;
        memberActive[PACKAGE_ID] = false;
        return { count: 2 };
      },
    },
    branch: {
      findMany: async () => [{ id: BRANCH_ID, code: "MGA" }],
    },
    inventoryBalance: {
      findMany: async (args: { where: { branchId?: string; productId: { in: string[] } } }) =>
        [...balances.values()].filter(
          (b) => (!args.where.branchId || b.branchId === args.where.branchId) && args.where.productId.in.includes(b.productId),
        ),
      upsert: async (args: {
        where: { branchId_productId: { branchId: string; productId: string } };
        create: Record<string, unknown>;
        update: Record<string, unknown>;
      }) => {
        const k = key(args.where.branchId_productId.branchId, args.where.branchId_productId.productId);
        const data = (balances.has(k) ? args.update : args.create) as {
          quantityOnHand: Prisma.Decimal; closedPackageQuantity: Prisma.Decimal; looseUnitQuantity: Prisma.Decimal; weightedAverageCost: Prisma.Decimal;
        };
        const row: FakeBalance = {
          branchId: args.where.branchId_productId.branchId,
          productId: args.where.branchId_productId.productId,
          quantityOnHand: data.quantityOnHand,
          closedPackageQuantity: data.closedPackageQuantity,
          looseUnitQuantity: data.looseUnitQuantity,
          weightedAverageCost: data.weightedAverageCost,
        };
        balances.set(k, row);
        return row;
      },
      updateMany: async (args: { where: { branchId: string; productId: { in: string[] } } }) => {
        let count = 0;
        for (const productId of args.where.productId.in) {
          const k = key(args.where.branchId, productId);
          const existing = balances.get(k);
          if (!existing) continue;
          balances.set(k, { ...existing, quantityOnHand: new Prisma.Decimal(0), closedPackageQuantity: new Prisma.Decimal(0), looseUnitQuantity: new Prisma.Decimal(0), weightedAverageCost: new Prisma.Decimal(0) });
          count += 1;
        }
        return { count };
      },
    },
    auditLog: {
      create: async (args: { data: Record<string, unknown> }) => {
        auditLogs.push(args.data);
        return args.data;
      },
    },
    $queryRaw: async () => [],
  };

  return {
    tx: tx as unknown as Prisma.TransactionClient,
    getBalance: (productId: string) => balances.get(key(BRANCH_ID, productId)),
    isGroupActive: () => groupActive,
    auditLogs,
  };
}

test("Preview de desfusion hacia el kilo: 1296 unidades base -> 6 kilos", async () => {
  const { tx } = createUnmergeFakeTx(1296, 0.5);
  const preview = await previewUnmergeStockGroupTx(tx, { stockGroupId: GROUP_ID, targetProductId: PACKAGE_ID });
  const branch = preview.branches[0];
  assert.equal(branch.targetNewQty, "6");
  assert.deepEqual(branch.otherMemberIdsZeroed, [CANONICAL_ID]);
  assert.equal(preview.totalStock, "1296");
});

test("Preview de desfusion sin target explicito usa el canonico (default) sin conversion", async () => {
  const { tx } = createUnmergeFakeTx(1296, 0.5);
  const preview = await previewUnmergeStockGroupTx(tx, { stockGroupId: GROUP_ID });
  assert.equal(preview.targetProductId, CANONICAL_ID);
  assert.equal(preview.branches[0].targetNewQty, "1296");
});

test("Desfusionar hacia el kilo: el kilo queda con 6, el canonico en cero, el grupo se desactiva", async () => {
  const { tx, getBalance, isGroupActive } = createUnmergeFakeTx(1296, 0.5);

  const result = await unmergeStockGroupTx(tx, { stockGroupId: GROUP_ID, targetProductId: PACKAGE_ID, actorUserId: "user-1" });

  assert.equal(result.branches[0].targetNewQty, "6");
  const packageBalance = getBalance(PACKAGE_ID)!;
  assert.equal(packageBalance.quantityOnHand.toString(), "6");
  assert.equal(Number(packageBalance.weightedAverageCost), 0.5 * FACTOR);

  const canonicalBalance = getBalance(CANONICAL_ID)!;
  assert.equal(canonicalBalance.quantityOnHand.toString(), "0", "el canonico queda en cero fisico tras desfusionar");

  assert.equal(isGroupActive(), false, "el grupo se desactiva tras desfusionar");
});

test("Desfusionar sin stock (caso simple, antes bloqueado por STOCK_NOT_ZERO) no lanza error", async () => {
  const { tx, isGroupActive } = createUnmergeFakeTx(0, 0);
  await unmergeStockGroupTx(tx, { stockGroupId: GROUP_ID, actorUserId: "user-1" });
  assert.equal(isGroupActive(), false);
});
