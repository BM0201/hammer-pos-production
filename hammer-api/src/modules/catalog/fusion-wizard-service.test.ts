import assert from "node:assert/strict";
import test from "node:test";
import { Prisma } from "@prisma/client";
import { previewFusionCreationTx, createFusionGroupTx, type WizardMember } from "@/modules/catalog/fusion-wizard-service";

/**
 * Fusión de Inventario v2, Fase 2.1 — asistente de creación de 3 pasos.
 * Escenario del mockup: "Alambre de amarre" — LIBRA (suelta/base) + ROLLO
 * (empaque, factor 25). MGA no tiene conflicto (recomendación automática);
 * MSY tiene stock en ambas presentaciones y requiere que el usuario elija.
 */
const LOOSE_ID = "prod-alambre-libra";
const PACKAGE_ID = "prod-alambre-rollo";
const FACTOR = 25;

type FakeBalance = {
  branchId: string;
  productId: string;
  quantityOnHand: Prisma.Decimal;
  closedPackageQuantity: Prisma.Decimal;
  looseUnitQuantity: Prisma.Decimal;
  weightedAverageCost: Prisma.Decimal;
};

function createWizardFakeTx(balancesInit: Array<{ branchId: string; productId: string; quantityOnHand: number; weightedAverageCost: number }>) {
  const balances = new Map<string, FakeBalance>();
  const key = (branchId: string, productId: string) => `${branchId}:${productId}`;
  for (const b of balancesInit) {
    balances.set(key(b.branchId, b.productId), {
      branchId: b.branchId,
      productId: b.productId,
      quantityOnHand: new Prisma.Decimal(b.quantityOnHand),
      closedPackageQuantity: new Prisma.Decimal(0),
      looseUnitQuantity: new Prisma.Decimal(0),
      weightedAverageCost: new Prisma.Decimal(b.weightedAverageCost),
    });
  }

  const branches = [
    { id: "branch-mga", code: "MGA" },
    { id: "branch-msy", code: "MSY" },
  ];
  const auditLogs: Array<Record<string, unknown>> = [];
  let groupCounter = 0;

  const tx = {
    productStockGroup: {
      findUnique: async () => null, // ningún código previo existe
      create: async (args: { data: Record<string, unknown> }) => {
        groupCounter += 1;
        return { id: `group-${groupCounter}`, ...args.data };
      },
    },
    productStockGroupMember: {
      create: async (args: { data: Record<string, unknown> }) => ({ id: `member-${Math.random()}`, ...args.data }),
      findMany: async () => [], // sin conflictos con otras fusiones activas
    },
    product: {
      findMany: async (args: { where: { id: { in: string[] } } }) =>
        args.where.id.in.map((id) => ({ id, name: id, sku: id })),
    },
    branch: {
      findMany: async () => branches,
    },
    inventoryBalance: {
      findMany: async (args: { where: { branchId: string; productId: { in: string[] } } }) =>
        [...balances.values()].filter(
          (b) => b.branchId === args.where.branchId && args.where.productId.in.includes(b.productId),
        ),
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

  return { tx: tx as unknown as Prisma.TransactionClient, getBalance: (branchId: string, productId: string) => balances.get(key(branchId, productId)), auditLogs };
}

const MEMBERS: WizardMember[] = [
  { productId: LOOSE_ID, conversionFactor: 1, isCanonical: true, isPackagePresentation: false },
  { productId: PACKAGE_ID, conversionFactor: FACTOR, isCanonical: false, isPackagePresentation: true },
];

const MEMBERS_WITH_SALE_UNIT = [
  { ...MEMBERS[0], saleUnit: "LIBRA" },
  { ...MEMBERS[1], saleUnit: "ROLLO" },
];

test("Paso 3 — preview: MGA sin conflicto (recomienda usar el empaque), MSY con conflicto (requiere eleccion)", async () => {
  const { tx } = createWizardFakeTx([
    { branchId: "branch-mga", productId: PACKAGE_ID, quantityOnHand: 12, weightedAverageCost: 100 },
    { branchId: "branch-msy", productId: LOOSE_ID, quantityOnHand: 115, weightedAverageCost: 18 },
    { branchId: "branch-msy", productId: PACKAGE_ID, quantityOnHand: 4, weightedAverageCost: 100 },
  ]);

  const preview = await previewFusionCreationTx(tx, { members: MEMBERS });

  const mga = preview.branches.find((b) => b.branchCode === "MGA")!;
  assert.equal(mga.hasConflict, false);
  assert.equal(mga.recommendedResolution, "USE_DERIVED_ONLY");
  assert.equal(mga.resultIfUseDerivedOnly, 12 * FACTOR);

  const msy = preview.branches.find((b) => b.branchCode === "MSY")!;
  assert.equal(msy.hasConflict, true);
  assert.equal(msy.resultIfSumBoth, 115 + 4 * FACTOR);
  assert.equal(preview.hasAnyConflict, true);
});

test("Crear fusion — MGA se resuelve solo (RECOMMENDED), MSY exige que el usuario elija SUM_BOTH", async () => {
  const { tx, getBalance } = createWizardFakeTx([
    { branchId: "branch-mga", productId: PACKAGE_ID, quantityOnHand: 12, weightedAverageCost: 100 },
    { branchId: "branch-msy", productId: LOOSE_ID, quantityOnHand: 115, weightedAverageCost: 18 },
    { branchId: "branch-msy", productId: PACKAGE_ID, quantityOnHand: 4, weightedAverageCost: 100 },
  ]);

  const result = await createFusionGroupTx(tx, {
    name: "Alambre de amarre",
    tracksPackages: true,
    packageUnit: "ROLLO",
    conversionFactorToBase: FACTOR,
    members: MEMBERS_WITH_SALE_UNIT,
    actorUserId: "user-1",
    branchResolutions: { "branch-msy": { resolution: "SUM_BOTH" } },
  });

  const mgaResult = result.branches.find((b) => b.branchCode === "MGA")!;
  assert.equal(mgaResult.resolution, "USE_DERIVED_ONLY");
  assert.equal(mgaResult.newCanonicalClosed, "12");
  assert.equal(mgaResult.newCanonicalLoose, "0");
  assert.equal(mgaResult.newCanonicalQty, String(12 * FACTOR));

  const msyResult = result.branches.find((b) => b.branchCode === "MSY")!;
  assert.equal(msyResult.resolution, "SUM_BOTH");
  assert.equal(msyResult.newCanonicalClosed, "4");
  assert.equal(msyResult.newCanonicalLoose, "115");
  assert.equal(msyResult.newCanonicalQty, String(4 * FACTOR + 115));

  const msyCanonicalBalance = getBalance("branch-msy", LOOSE_ID)!;
  assert.equal(msyCanonicalBalance.quantityOnHand.toString(), String(4 * FACTOR + 115));
  const msyPackageBalanceAfter = getBalance("branch-msy", PACKAGE_ID)!;
  assert.equal(msyPackageBalanceAfter.quantityOnHand.toString(), "0", "el empaque queda en cero fisico tras la fusion");
});

test("Crear fusion falla si una sucursal tiene conflicto y no llego resolucion (paso 3 es obligatorio)", async () => {
  const { tx } = createWizardFakeTx([
    { branchId: "branch-msy", productId: LOOSE_ID, quantityOnHand: 115, weightedAverageCost: 18 },
    { branchId: "branch-msy", productId: PACKAGE_ID, quantityOnHand: 4, weightedAverageCost: 100 },
  ]);

  await assert.rejects(
    () => createFusionGroupTx(tx, {
      name: "Alambre de amarre",
      tracksPackages: true,
      packageUnit: "ROLLO",
      conversionFactorToBase: FACTOR,
      members: MEMBERS_WITH_SALE_UNIT,
      actorUserId: "user-1",
    }),
    (error: unknown) => (error as Error).message.includes("CONFLICT_REQUIRES_RESOLUTION"),
  );
});

test("Crear fusion simple (sin empaque, tipo hierro): sin conflicto resuelve solo con el factor del calibre", async () => {
  const VARILLA_ID = "prod-varilla-3-8";
  const QUINTAL_ID = "prod-quintal-3-8";
  const { tx, getBalance } = createWizardFakeTx([
    { branchId: "branch-mga", productId: QUINTAL_ID, quantityOnHand: 8, weightedAverageCost: 700 },
  ]);

  const result = await createFusionGroupTx(tx, {
    name: "Hierro 3/8",
    tracksPackages: false,
    members: [
      { productId: VARILLA_ID, saleUnit: "VARILLA", conversionFactor: 1, isCanonical: true, isPackagePresentation: false },
      { productId: QUINTAL_ID, saleUnit: "QUINTAL", conversionFactor: 14, isCanonical: false, isPackagePresentation: false },
    ],
    actorUserId: "user-1",
  });

  const mga = result.branches.find((b) => b.branchCode === "MGA")!;
  assert.equal(mga.resolution, "USE_DERIVED_ONLY");
  assert.equal(mga.newCanonicalQty, "112");

  const canonicalBalance = getBalance("branch-mga", VARILLA_ID)!;
  assert.equal(canonicalBalance.quantityOnHand.toString(), "112");
  assert.equal(canonicalBalance.closedPackageQuantity.toString(), "0", "grupo sin tracksPackages no usa closed/loose");
});
