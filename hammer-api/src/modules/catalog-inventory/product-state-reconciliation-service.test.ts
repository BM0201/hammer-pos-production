import assert from "node:assert/strict";
import test from "node:test";
import { Prisma } from "@prisma/client";
import { reconcileSales90dTx, compareProductStateSample, backfillMissingProductStatesTx } from "@/modules/catalog-inventory/product-state-reconciliation-service";

test("reconcileSales90dTx — LA QUE IMPORTA: recalcula units90d/revenue90d DE VERDAD desde ventas de los últimos 90 días", async () => {
  const states: Array<Record<string, unknown>> = [
    { productId: "p1", branchId: "b1", units90d: new Prisma.Decimal(999), revenue90d: new Prisma.Decimal(999) },
  ];
  const db = {
    saleOrderLine: {
      groupBy: async () => [{ productId: "p1", branchId: "b1", _sum: { quantity: new Prisma.Decimal(7), lineSubtotal: new Prisma.Decimal(700) } }],
    },
    productBranchState: {
      upsert: async ({ where, create, update }: { where: { productId_branchId: { productId: string; branchId: string } }; create: Record<string, unknown>; update: Record<string, unknown> }) => {
        const idx = states.findIndex((s) => s.productId === where.productId_branchId.productId && s.branchId === where.productId_branchId.branchId);
        if (idx === -1) states.push({ ...create });
        else states[idx] = { ...states[idx], ...update };
      },
      findMany: async () => states.filter((s) => (s.units90d as Prisma.Decimal).gt(0) || (s.revenue90d as Prisma.Decimal).gt(0)),
      update: async ({ where, data }: { where: { productId_branchId: { productId: string; branchId: string } }; data: Record<string, unknown> }) => {
        const idx = states.findIndex((s) => s.productId === where.productId_branchId.productId && s.branchId === where.productId_branchId.branchId);
        states[idx] = { ...states[idx], ...data };
      },
    },
  };

  const result = await reconcileSales90dTx(db as never);
  assert.equal(result.rowsUpdated, 1);
  assert.equal((states[0].units90d as Prisma.Decimal).toNumber(), 7, "el recálculo REEMPLAZA el valor viejo, no lo suma");
  assert.equal((states[0].revenue90d as Prisma.Decimal).toNumber(), 700);
});

test("reconcileSales90dTx — fila con ventas viejas que ya NO vendió en la ventana: queda en 0 (no se deja el número stale)", async () => {
  const states: Array<Record<string, unknown>> = [
    { productId: "p-viejo", branchId: "b1", units90d: new Prisma.Decimal(50), revenue90d: new Prisma.Decimal(5000) },
  ];
  const db = {
    saleOrderLine: { groupBy: async () => [] },
    productBranchState: {
      upsert: async () => { throw new Error("no debería llamarse — no hay ventas en la ventana"); },
      findMany: async () => states,
      update: async ({ where, data }: { where: { productId_branchId: { productId: string; branchId: string } }; data: Record<string, unknown> }) => {
        const idx = states.findIndex((s) => s.productId === where.productId_branchId.productId && s.branchId === where.productId_branchId.branchId);
        states[idx] = { ...states[idx], ...data };
      },
    },
  };

  const result = await reconcileSales90dTx(db as never);
  assert.equal(result.rowsUpdated, 1);
  assert.equal((states[0].units90d as Prisma.Decimal).toNumber(), 0);
  assert.equal((states[0].revenue90d as Prisma.Decimal).toNumber(), 0);
});

/**
 * Fake DB COMPLETO (mismo patrón que product-state-service.test.ts) — acá
 * importa que refreshProductStateTx corra de VERDAD adentro de
 * compareProductStateSample (no se puede inyectar/mockear: ESM no permite
 * reasignar un export importado). La "fila vieja" se siembra directo en
 * `productBranchStateRows` con un valor DISTINTO al que el recálculo real
 * va a producir — así el desvío es real, no simulado.
 */
function createFullFakeDb(input: {
  products: Array<{ id: string; barcode: string | null; standardSalePrice: number; globalCost?: number | null }>;
  balances: Array<{ productId: string; branchId: string; quantityOnHand: number; weightedAverageCost: number }>;
  sampleRows: Array<Record<string, unknown>>;
}) {
  const balances = input.balances.map((b) => ({ ...b, quantityOnHand: new Prisma.Decimal(b.quantityOnHand), weightedAverageCost: new Prisma.Decimal(b.weightedAverageCost) }));
  const productBranchStateRows = [...input.sampleRows];
  const brainDecisions: Array<Record<string, unknown>> = [];

  const db = {
    product: {
      findMany: async ({ where }: { where: { id: { in: string[] } } }) =>
        input.products.filter((p) => where.id.in.includes(p.id)).map((p) => ({
          id: p.id, barcode: p.barcode, standardSalePrice: new Prisma.Decimal(p.standardSalePrice),
          globalCost: p.globalCost != null ? new Prisma.Decimal(p.globalCost) : null,
          averageCost: null, lastPurchaseCost: null,
        })),
    },
    branchProductSetting: { findMany: async () => [] },
    inventoryBalance: {
      findMany: async (args: { where: { productId?: { in: string[] }; OR?: Array<{ productId: string; branchId: string }> } }) => {
        const { where } = args;
        return balances.filter((b) => (where.OR ? where.OR.some((pair) => pair.productId === b.productId && pair.branchId === b.branchId) : where.productId!.in.includes(b.productId)));
      },
    },
    stockReorderPolicy: { findMany: async () => [] },
    productStockGroupMember: { findMany: async () => [] },
    systemSetting: { findUnique: async () => null },
    productBranchState: {
      upsert: async ({ where, create, update }: { where: { productId_branchId: { productId: string; branchId: string } }; create: Record<string, unknown>; update: Record<string, unknown> }) => {
        const idx = productBranchStateRows.findIndex((s) => s.productId === where.productId_branchId.productId && s.branchId === where.productId_branchId.branchId);
        if (idx === -1) productBranchStateRows.push({ ...create });
        else productBranchStateRows[idx] = { ...productBranchStateRows[idx], ...update };
      },
      findMany: async ({ where }: { where: { productId: { in: string[] } } | { OR: Array<{ productId: string; branchId: string }> } }) => {
        if ("OR" in where) return where.OR.map((pair) => productBranchStateRows.find((s) => s.productId === pair.productId && s.branchId === pair.branchId)!);
        return productBranchStateRows.filter((s) => where.productId.in.includes(s.productId as string));
      },
    },
    productCatalogState: {
      upsert: async () => {},
    },
    $queryRaw: async () => input.sampleRows,
    brainDecision: {
      upsert: async ({ create }: { create: Record<string, unknown> }) => { brainDecisions.push(create); },
    },
  };

  return { db, brainDecisions };
}

test("compareProductStateSample — sin diferencias: no crea ninguna decisión de Brain", async () => {
  // globalCost=10, standardSalePrice=100 → marginPercent real = (100-10)/100*100 = 90; sin política, qty=5 > fallback(1) → stockStatus "OK". Tiene que coincidir exacto con lo que el recálculo real produce.
  const sampleRow = { productId: "p1", branchId: "b1", quantityOnHand: new Prisma.Decimal(5), effectiveCost: new Prisma.Decimal(10), effectivePrice: new Prisma.Decimal(100), marginPercent: new Prisma.Decimal(90), stockStatus: "OK", reorderPoint: null };
  const { db, brainDecisions } = createFullFakeDb({
    products: [{ id: "p1", barcode: null, standardSalePrice: 100, globalCost: 10 }],
    balances: [{ productId: "p1", branchId: "b1", quantityOnHand: 5, weightedAverageCost: 999 }],
    sampleRows: [sampleRow],
  });

  const result = await compareProductStateSample(200, db as never);
  assert.equal(result.sampled, 1);
  assert.equal(result.drifted.length, 0, "el recálculo real coincide con lo que ya había guardado");
  assert.equal(brainDecisions.length, 0);
});

test("compareProductStateSample — LA QUE IMPORTA: una fila vieja (quantityOnHand desactualizado) se detecta como desvío y levanta UNA decisión de Brain", async () => {
  // La fila "vieja" dice 2 unidades, pero el balance real (InventoryBalance) tiene 5 — alguna escritura no refrescó esta fila a tiempo. El resto de los campos SÍ coincide con el recálculo real (ver test de arriba) para que el único desvío sea quantityOnHand.
  const staleSampleRow = { productId: "p1", branchId: "b1", quantityOnHand: new Prisma.Decimal(2), effectiveCost: new Prisma.Decimal(10), effectivePrice: new Prisma.Decimal(100), marginPercent: new Prisma.Decimal(90), stockStatus: "OK", reorderPoint: null };
  const { db, brainDecisions } = createFullFakeDb({
    products: [{ id: "p1", barcode: null, standardSalePrice: 100, globalCost: 10 }],
    balances: [{ productId: "p1", branchId: "b1", quantityOnHand: 5, weightedAverageCost: 999 }],
    sampleRows: [staleSampleRow],
  });

  const result = await compareProductStateSample(200, db as never);
  assert.equal(result.drifted.length, 1);
  assert.equal(result.drifted[0].field, "quantityOnHand");
  assert.equal(result.drifted[0].before, "2");
  assert.equal(result.drifted[0].after, "5");
  assert.equal(brainDecisions.length, 1);
  assert.equal(brainDecisions[0].category, "SYSTEM");
  assert.equal(brainDecisions[0].proposedActionType, "REVIEW_PRODUCT_STATE_DRIFT");
});

test("compareProductStateSample — muestra vacía (tabla recién creada, sin filas todavía): no revienta, no sampled", async () => {
  const { db, brainDecisions } = createFullFakeDb({ products: [], balances: [], sampleRows: [] });
  const result = await compareProductStateSample(200, db as never);
  assert.equal(result.sampled, 0);
  assert.equal(result.drifted.length, 0);
  assert.equal(brainDecisions.length, 0);
});

/**
 * Fake DB propio para backfillMissingProductStatesTx — distinto del de
 * arriba porque esta función arranca de `product.findMany({ where:
 * {isActive} })` (todo el catálogo activo), no de una lista de ids ya
 * conocida, y necesita `productBranchState.findMany`/`productCatalogState.
 * findMany` con forma `{productId: {in}}` (el de arriba solo soporta la
 * forma `{OR}` que usa compareProductStateSample).
 */
function createBackfillFakeDb(input: {
  products: Array<{ id: string; barcode: string | null; standardSalePrice: number; globalCost?: number | null }>;
  balances?: Array<{ productId: string; branchId: string; quantityOnHand: number }>;
  existingBranchStates?: Array<{ productId: string; branchId: string }>;
  existingCatalogStates?: Array<{ productId: string }>;
}) {
  const balances = (input.balances ?? []).map((b) => ({ ...b, quantityOnHand: new Prisma.Decimal(b.quantityOnHand) }));
  const branchStates: Array<Record<string, unknown>> = (input.existingBranchStates ?? []).map((s) => ({ ...s }));
  const catalogStates: Array<Record<string, unknown>> = (input.existingCatalogStates ?? []).map((s) => ({ ...s }));

  const db = {
    product: {
      findMany: async (args: { where?: { id?: { in: string[] } } }) => {
        const rows = args.where?.id ? input.products.filter((p) => args.where!.id!.in.includes(p.id)) : input.products;
        return rows.map((p) => ({
          id: p.id, barcode: p.barcode, standardSalePrice: new Prisma.Decimal(p.standardSalePrice),
          globalCost: p.globalCost != null ? new Prisma.Decimal(p.globalCost) : null, averageCost: null, lastPurchaseCost: null,
        }));
      },
    },
    branchProductSetting: { findMany: async () => [] },
    inventoryBalance: {
      findMany: async (args: { where: { productId?: { in: string[] }; OR?: Array<{ productId: string; branchId: string }> } }) => {
        const { where } = args;
        return balances.filter((b) => (where.OR ? where.OR.some((pair) => pair.productId === b.productId && pair.branchId === b.branchId) : where.productId!.in.includes(b.productId)));
      },
    },
    stockReorderPolicy: { findMany: async () => [] },
    productStockGroupMember: { findMany: async () => [] },
    systemSetting: { findUnique: async () => null },
    productBranchState: {
      upsert: async ({ where, create, update }: { where: { productId_branchId: { productId: string; branchId: string } }; create: Record<string, unknown>; update: Record<string, unknown> }) => {
        const idx = branchStates.findIndex((s) => s.productId === where.productId_branchId.productId && s.branchId === where.productId_branchId.branchId);
        if (idx === -1) branchStates.push({ ...create });
        else branchStates[idx] = { ...branchStates[idx], ...update };
      },
      findMany: async (args: { where: { productId: { in: string[] } } }) => branchStates.filter((s) => args.where.productId.in.includes(s.productId as string)),
    },
    productCatalogState: {
      upsert: async ({ where, create, update }: { where: { productId: string }; create: Record<string, unknown>; update: Record<string, unknown> }) => {
        const idx = catalogStates.findIndex((s) => s.productId === where.productId);
        if (idx === -1) catalogStates.push({ ...create });
        else catalogStates[idx] = { ...catalogStates[idx], ...update };
      },
      findMany: async (args: { where: { productId: { in: string[] } } }) => catalogStates.filter((s) => args.where.productId.in.includes(s.productId as string)),
    },
  };
  return { db, branchStates, catalogStates };
}

test("backfillMissingProductStatesTx — LA QUE IMPORTA: crea el estado SOLO para el par (producto, sucursal) con señal real que todavía no lo tiene", async () => {
  const { db, branchStates } = createBackfillFakeDb({
    products: [{ id: "p1", barcode: "123", standardSalePrice: 100, globalCost: 50 }],
    balances: [{ productId: "p1", branchId: "b1", quantityOnHand: 5 }],
  });

  const result = await backfillMissingProductStatesTx(db as never);

  assert.equal(result.branchPairsBackfilled, 1);
  assert.equal(branchStates.length, 1);
  assert.equal(branchStates[0].productId, "p1");
  assert.equal(branchStates[0].branchId, "b1");
});

test("backfillMissingProductStatesTx — ya tiene su estado: reconstruye SOLO lo faltante, no vuelve a tocar lo que ya está", async () => {
  const { db, branchStates } = createBackfillFakeDb({
    products: [{ id: "p1", barcode: "123", standardSalePrice: 100, globalCost: 50 }],
    balances: [{ productId: "p1", branchId: "b1", quantityOnHand: 5 }],
    existingBranchStates: [{ productId: "p1", branchId: "b1" }],
    existingCatalogStates: [{ productId: "p1" }],
  });

  const result = await backfillMissingProductStatesTx(db as never);

  assert.equal(result.branchPairsBackfilled, 0, "el par ya existía — no cuenta como faltante");
  assert.equal(result.catalogStatesBackfilled, 0);
  assert.equal(branchStates.length, 1, "no se duplicó ni se tocó de más");
});

test("backfillMissingProductStatesTx — producto sin NINGUNA señal (nunca tocado): no inventa un par de sucursal, pero sí crea su ProductCatalogState (hasCost=false, real)", async () => {
  const { db, branchStates, catalogStates } = createBackfillFakeDb({
    products: [{ id: "p2", barcode: null, standardSalePrice: 0, globalCost: null }],
  });

  const result = await backfillMissingProductStatesTx(db as never);

  assert.equal(result.branchPairsBackfilled, 0);
  assert.equal(branchStates.length, 0, "sin señal en ninguna sucursal — no se crea ningún ProductBranchState de la nada");
  assert.equal(catalogStates.length, 1);
  assert.equal(catalogStates[0].productId, "p2");
  assert.equal(catalogStates[0].hasCost, false);
});
