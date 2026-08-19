import assert from "node:assert/strict";
import test from "node:test";
import { Prisma } from "@prisma/client";
import { checkStockGroupHealth } from "@/modules/catalog/stock-group-health";
import { previewStockGroupRepairTx, applyStockGroupRepairTx } from "@/modules/catalog/stock-group-crud";

/**
 * Fusión de Inventario v2, Fase 1.5-1.6 — Test 6 del prompt:
 * "Inyectar drift a mano → el verificador lo detecta; reparar con preview lo
 * corrige y el verificador queda en verde."
 *
 * Fake tx en memoria modelando UN grupo tracksPackages (canónico suelto +
 * miembro-paquete) en UNA sucursal, con los métodos exactos que
 * checkStockGroupHealth / previewStockGroupRepairTx / rebuildStockGroupBalancesTx
 * (llamado por applyStockGroupRepairTx) realmente invocan.
 */
const STOCK_GROUP_ID = "group-clavos";
const BRANCH_ID = "branch-mga";
const CANONICAL_ID = "prod-clavo-suelto";
const PACKAGE_ID = "prod-clavo-caja";
const FACTOR = 25;

type FakeBalance = {
  branchId: string;
  productId: string;
  quantityOnHand: Prisma.Decimal;
  closedPackageQuantity: Prisma.Decimal;
  looseUnitQuantity: Prisma.Decimal;
  weightedAverageCost: Prisma.Decimal;
};

function createRepairFakeTx(initial: { canonical: Omit<FakeBalance, "branchId" | "productId">; package: Omit<FakeBalance, "branchId" | "productId"> }) {
  const balances = new Map<string, FakeBalance>();
  const key = (branchId: string, productId: string) => `${branchId}:${productId}`;
  balances.set(key(BRANCH_ID, CANONICAL_ID), { branchId: BRANCH_ID, productId: CANONICAL_ID, ...initial.canonical });
  balances.set(key(BRANCH_ID, PACKAGE_ID), { branchId: BRANCH_ID, productId: PACKAGE_ID, ...initial.package });

  const auditLogs: Array<Record<string, unknown>> = [];

  const group = {
    id: STOCK_GROUP_ID,
    code: "GRP-CLAVOS",
    tracksPackages: true,
    conversionFactorToBase: new Prisma.Decimal(FACTOR),
    isActive: true,
    products: [
      { productId: CANONICAL_ID, conversionFactor: new Prisma.Decimal(1), isCanonical: true, isPackagePresentation: false, saleUnit: "LIBRA" },
      { productId: PACKAGE_ID, conversionFactor: new Prisma.Decimal(FACTOR), isCanonical: false, isPackagePresentation: true, saleUnit: "CAJA" },
    ],
  };

  const tx = {
    productStockGroup: {
      findUnique: async () => group,
    },
    branch: {
      findMany: async () => [{ id: BRANCH_ID, code: "MGA" }],
    },
    inventoryBalance: {
      findMany: async (args: { where: { branchId?: string; productId: { in: string[] } } }) => {
        return [...balances.values()].filter(
          (b) => (!args.where.branchId || b.branchId === args.where.branchId) && args.where.productId.in.includes(b.productId),
        );
      },
      upsert: async (args: {
        where: { branchId_productId: { branchId: string; productId: string } };
        create: Record<string, unknown>;
        update: Record<string, unknown>;
      }) => {
        const k = key(args.where.branchId_productId.branchId, args.where.branchId_productId.productId);
        const data = (balances.has(k) ? args.update : args.create) as {
          quantityOnHand: Prisma.Decimal;
          closedPackageQuantity: Prisma.Decimal;
          looseUnitQuantity: Prisma.Decimal;
          weightedAverageCost: Prisma.Decimal;
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
      updateMany: async (args: { where: { branchId: string; productId: { in: string[] } }; data: Record<string, unknown> }) => {
        let count = 0;
        for (const productId of args.where.productId.in) {
          const k = key(args.where.branchId, productId);
          const existing = balances.get(k);
          if (!existing) continue;
          balances.set(k, {
            ...existing,
            quantityOnHand: new Prisma.Decimal(0),
            closedPackageQuantity: new Prisma.Decimal(0),
            looseUnitQuantity: new Prisma.Decimal(0),
            weightedAverageCost: new Prisma.Decimal(0),
          });
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
    getCanonicalBalance: () => balances.get(key(BRANCH_ID, CANONICAL_ID))!,
    getPackageBalance: () => balances.get(key(BRANCH_ID, PACKAGE_ID))!,
    auditLogs,
  };
}

test("Test 6 — drift inyectado a mano: el verificador lo detecta, reparar con preview lo corrige, el verificador queda en verde", async () => {
  // Estado corrupto: el miembro derivado (caja) tiene balance no-cero (debería
  // estar en cero — su stock ya debería vivir en el canónico), y el canónico
  // no cumple el invariante cerrado×factor+suelto == quantityOnHand.
  const { tx, getCanonicalBalance, getPackageBalance } = createRepairFakeTx({
    canonical: {
      quantityOnHand: new Prisma.Decimal(110),
      closedPackageQuantity: new Prisma.Decimal(4),
      looseUnitQuantity: new Prisma.Decimal(5), // 4*25+5=105, no 110 → drift de 5
      weightedAverageCost: new Prisma.Decimal(10),
    },
    package: {
      quantityOnHand: new Prisma.Decimal(2), // debería estar en cero
      closedPackageQuantity: new Prisma.Decimal(0),
      looseUnitQuantity: new Prisma.Decimal(0),
      weightedAverageCost: new Prisma.Decimal(200),
    },
  });

  const before = await checkStockGroupHealth(tx, { stockGroupId: STOCK_GROUP_ID });
  assert.equal(before.healthy, false, "el verificador debe detectar el drift inyectado");
  assert.ok(before.issues.some((i) => i.kind === "INVARIANT"), "debe reportar el invariante roto");
  assert.ok(before.issues.some((i) => i.kind === "DERIVED_NONZERO"), "debe reportar el miembro derivado con balance");

  const preview = await previewStockGroupRepairTx(tx, STOCK_GROUP_ID);
  assert.equal(preview.anyChange, true, "el preview debe indicar que hay cambios pendientes");
  assert.ok(preview.hash.length > 0);

  // Rechaza aplicar con un hash viejo/incorrecto — "nadie repara sin ver".
  await assert.rejects(
    () => applyStockGroupRepairTx(tx, { stockGroupId: STOCK_GROUP_ID, actorUserId: "user-1", reason: "test", expectedHash: "hash-viejo-invalido" }),
    (error: unknown) => (error as Error).message.includes("REPAIR_PREVIEW_STALE"),
  );

  // Con el hash correcto (recién generado), aplica sin problema.
  await applyStockGroupRepairTx(tx, { stockGroupId: STOCK_GROUP_ID, actorUserId: "user-1", reason: "test", expectedHash: preview.hash });

  // Package (derivado) queda en cero; canónico queda con el invariante correcto.
  const pkgAfter = getPackageBalance();
  assert.equal(pkgAfter.quantityOnHand.toString(), "0");

  const canonicalAfter = getCanonicalBalance();
  const expectedQty = canonicalAfter.closedPackageQuantity.mul(FACTOR).add(canonicalAfter.looseUnitQuantity);
  assert.ok(canonicalAfter.quantityOnHand.eq(expectedQty), "el invariante debe cumplirse tras la reparación");

  const after = await checkStockGroupHealth(tx, { stockGroupId: STOCK_GROUP_ID });
  assert.equal(after.healthy, true, "el verificador debe quedar en verde tras reparar con el preview correcto");
  assert.equal(after.issues.length, 0);
});
