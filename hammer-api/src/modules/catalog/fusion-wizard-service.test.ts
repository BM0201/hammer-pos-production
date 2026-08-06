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
  const existingCodes = new Set<string>();
  let groupCounter = 0;

  const tx = {
    productStockGroup: {
      findUnique: async (args: { where: { code: string } }) => (existingCodes.has(args.where.code) ? { id: "existing", code: args.where.code } : null),
      create: async (args: { data: Record<string, unknown> }) => {
        groupCounter += 1;
        existingCodes.add(args.data.code as string);
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

test("Dos fusiones con el mismo nombre (mismo preset, variantes distintas como STD/9V) NO chocan — el codigo se desambigua solo", async () => {
  // Bug real: el codigo interno se deriva del nombre (nunca se muestra al
  // usuario). Si dos variantes fisicas distintas (p.ej. Hierro 3/8 STD y
  // Hierro 3/8 9V) usan el mismo preset y el usuario no edita el nombre,
  // antes esto bloqueaba la segunda creacion con VALIDATION_ERROR.
  const { tx } = createWizardFakeTx([]);

  const first = await createFusionGroupTx(tx, {
    name: "Hierro 3/8",
    tracksPackages: false,
    members: [
      { productId: "prod-varilla-std", saleUnit: "VARILLA", conversionFactor: 1, isCanonical: true, isPackagePresentation: false },
      { productId: "prod-quintal-std", saleUnit: "QUINTAL", conversionFactor: 14, isCanonical: false, isPackagePresentation: false },
    ],
    actorUserId: "user-1",
  });

  const second = await createFusionGroupTx(tx, {
    name: "Hierro 3/8",
    tracksPackages: false,
    members: [
      { productId: "prod-varilla-9v", saleUnit: "VARILLA", conversionFactor: 1, isCanonical: true, isPackagePresentation: false },
      { productId: "prod-quintal-9v", saleUnit: "QUINTAL", conversionFactor: 14, isCanonical: false, isPackagePresentation: false },
    ],
    actorUserId: "user-1",
  });

  assert.notEqual(first.groupCode, second.groupCode, "el segundo debe recibir un codigo distinto, no fallar");
  assert.equal(second.groupCode, `${first.groupCode}_2`);
});

// ─── Fusión triple — clavo de acero: CAJA(empaque)/UNIDAD(canónico)/LIBRA(suelto alternativo) ───
// Antes de este cambio, packageMember se resolvía como `derivedMembers[0]` —
// el primer producto agregado, sin importar cuál tuviera isPackagePresentation.
// Si LIBRA se agregaba antes que CAJA, LIBRA quedaba tratada como "el
// empaque" y el saldo real de CAJA (o el de LIBRA, según el orden) se perdía
// al consolidar. Este test agrega los miembros en un orden donde el bug
// viejo fallaría (LIBRA en el medio, CAJA al final) para probar que ahora
// se resuelve por la bandera isPackagePresentation, no por posición.
test("Fusión triple (Caja/Unidad/Libra) — el empaque se resuelve por bandera, no por orden de alta; Libra no se pierde", async () => {
  const UNIDAD_ID = "prod-clavo-unidad";
  const LIBRA_ID = "prod-clavo-libra";
  const CAJA_ID = "prod-clavo-caja";
  const CAJA_FACTOR = 25; // 1 caja = 25 kg (canónico = kilo, aquí modelado vía UNIDAD por simplicidad del factor)
  const LIBRA_FACTOR = 0.453592;

  const { tx, getBalance } = createWizardFakeTx([
    { branchId: "branch-mga", productId: CAJA_ID, quantityOnHand: 3, weightedAverageCost: 500 },
    { branchId: "branch-mga", productId: LIBRA_ID, quantityOnHand: 8, weightedAverageCost: 220 },
  ]);

  // Orden deliberado: canónico, LIBRA (suelto alternativo), CAJA (empaque) —
  // con el bug viejo (derivedMembers[0]) LIBRA habría sido tratada como
  // empaque en vez de CAJA.
  const members = [
    { productId: UNIDAD_ID, saleUnit: "UNIDAD", conversionFactor: 1, isCanonical: true, isPackagePresentation: false },
    { productId: LIBRA_ID, saleUnit: "LIBRA", conversionFactor: LIBRA_FACTOR, isCanonical: false, isPackagePresentation: false },
    { productId: CAJA_ID, saleUnit: "CAJA", conversionFactor: CAJA_FACTOR, isCanonical: false, isPackagePresentation: true },
  ];

  const result = await createFusionGroupTx(tx, {
    name: "Clavo de acero 2\"",
    tracksPackages: true,
    packageUnit: "CAJA",
    conversionFactorToBase: CAJA_FACTOR,
    members,
    actorUserId: "user-1",
    branchResolutions: { "branch-mga": { resolution: "SUM_BOTH" } },
  });

  const mga = result.branches.find((b) => b.branchCode === "MGA")!;
  // El empaque (CAJA) debe quedar en closed=3 — NUNCA en loose ni perdido.
  assert.equal(mga.newCanonicalClosed, "3", "las 3 cajas deben quedar como empaque cerrado, no como sueltas");
  // Libra (suelto alternativo) se pliega al lado loose, convertida a base —
  // NO se pierde ni se cuenta como empaque. Comparación con tolerancia:
  // Decimal.js (produccion) y la aritmetica de punto flotante de este test
  // pueden diferir en los ultimos digitos de 8 * 0.453592.
  const libraAsBase = 8 * LIBRA_FACTOR;
  assert.ok(
    Math.abs(Number(mga.newCanonicalLoose) - libraAsBase) < 1e-6,
    `el saldo de Libra debe plegarse al lado suelto: esperado ≈${libraAsBase}, obtenido ${mga.newCanonicalLoose}`,
  );

  // Los 3 productos SKU quedan en la fusión (0 físico salvo el canónico).
  const canonicalBalance = getBalance("branch-mga", UNIDAD_ID)!;
  assert.equal(canonicalBalance.closedPackageQuantity.toString(), "3");
  const cajaBalanceAfter = getBalance("branch-mga", CAJA_ID)!;
  assert.equal(cajaBalanceAfter.quantityOnHand.toString(), "0", "CAJA queda en cero fisico tras la fusion");
  const libraBalanceAfter = getBalance("branch-mga", LIBRA_ID)!;
  assert.equal(libraBalanceAfter.quantityOnHand.toString(), "0", "LIBRA queda en cero fisico tras la fusion (su valor ya vive en el canonico)");
});
