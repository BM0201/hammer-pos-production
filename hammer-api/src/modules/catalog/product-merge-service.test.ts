import assert from "node:assert/strict";
import test from "node:test";
import { Prisma } from "@prisma/client";
import {
  previewMerge,
  mergeProductsTx,
  MERGE_RELATION_POLICY,
  MERGE_POLICY_EXCLUDED_RELATIONS,
} from "@/modules/catalog/product-merge-service";

/**
 * prompt-codigos-y-duplicados.md Fase 3 — unificar productos duplicados.
 * Fake-db en memoria, mismo patrón que inventory/opening-balance.test.ts
 * (createInventoryMovementTx real, sin stock-group → productStockGroupMember
 * .findFirst null, wacEnabled false vía systemSetting.findUnique null —
 * ningún guard de WAC entra en juego, igual que ese archivo).
 */

function matchWhere(row: Record<string, unknown>, where: Record<string, unknown> | undefined): boolean {
  if (!where) return true;
  return Object.entries(where).every(([key, condition]) => {
    if (condition && typeof condition === "object" && !Array.isArray(condition) && !(condition instanceof Prisma.Decimal)) {
      const cond = condition as Record<string, unknown>;
      if ("in" in cond) return (cond.in as unknown[]).includes(row[key]);
      if ("notIn" in cond) return !(cond.notIn as unknown[]).includes(row[key]);
      return matchWhere(row[key] as Record<string, unknown>, cond);
    }
    return row[key] === condition;
  });
}

function applySelect(row: Record<string, unknown>, select: Record<string, boolean> | undefined) {
  if (!select) return { ...row };
  const result: Record<string, unknown> = {};
  for (const key of Object.keys(select)) result[key] = row[key];
  return result;
}

function makeTable(rows: Array<Record<string, unknown>>) {
  let nextId = rows.length + 1;
  return {
    findMany: async ({ where, select }: { where?: Record<string, unknown>; select?: Record<string, boolean> } = {}) =>
      rows.filter((r) => matchWhere(r, where)).map((r) => applySelect(r, select)),
    findFirst: async ({ where }: { where?: Record<string, unknown> } = {}) => {
      const found = rows.find((r) => matchWhere(r, where));
      return found ? { ...found } : null;
    },
    findUnique: async ({ where, select }: { where: Record<string, unknown>; select?: Record<string, boolean> }) => {
      const found = rows.find((r) => matchWhere(r, where));
      return found ? applySelect(found, select) : null;
    },
    count: async ({ where }: { where?: Record<string, unknown> } = {}) => rows.filter((r) => matchWhere(r, where)).length,
    create: async ({ data }: { data: Record<string, unknown> }) => {
      const row = { id: `gen-${nextId++}`, ...data };
      rows.push(row);
      return { ...row };
    },
    update: async ({ where, data }: { where: Record<string, unknown>; data: Record<string, unknown> }) => {
      const row = rows.find((r) => matchWhere(r, where));
      if (!row) throw new Error("not found");
      Object.assign(row, data);
      return { ...row };
    },
    updateMany: async ({ where, data }: { where?: Record<string, unknown>; data: Record<string, unknown> }) => {
      const matches = rows.filter((r) => matchWhere(r, where));
      for (const m of matches) Object.assign(m, data);
      return { count: matches.length };
    },
    upsert: async ({ where, create, update }: { where: Record<string, unknown>; create: Record<string, unknown>; update: Record<string, unknown> }) => {
      const row = rows.find((r) => matchWhere(r, where));
      if (row) {
        Object.assign(row, update);
        return { ...row };
      }
      const created = { id: `gen-${nextId++}`, ...create };
      rows.push(created);
      return { ...created };
    },
    _rows: rows,
  };
}

// inventoryMovement y purchaseOrderLine quedan AFUERA de esta lista: tienen
// su propio delegate especial más abajo (create real para
// createInventoryMovementTx / count+findMany+updateMany ya cableados).
const GENERIC_RELATION_DELEGATES = [
  "saleOrderLine", "saleReturnItem", "transferLine", "internalFreightTripLine",
  "productPricing", "branchProductSetting", "productAnalytics", "stockReorderPolicy", "reorderAlert",
  "reorderSuggestionLine", "productionRecipe", "productionRecipeInput", "productionBatchInput",
  "brainDecision", "replenishmentDraftItem", "priceUpdateLine",
];

function buildFakeDb(opts: {
  survivor: { id: string; sku: string; name: string; unit: string; isActive?: boolean; mergedIntoProductId?: string | null };
  merged: { id: string; sku: string; name: string; unit: string; isActive?: boolean; mergedIntoProductId?: string | null };
  balances?: Array<{ branchId: string; productId: string; quantityOnHand: number; weightedAverageCost: number }>;
  stockGroupMembers?: Array<{ productId: string; isActive: boolean; stockGroup: { isActive: boolean } }>;
  purchaseOrderLines?: Array<{ productId: string; purchaseOrder: { status: string } }>;
  timberProducts?: Array<{ id: string; productId: string }>;
  barcodes?: Array<{ id: string; productId: string; code: string; isPrimary: boolean; createdAt: Date }>;
  conditionBalances?: Array<{ id: string; branchId: string; productId: string; condition: string; quantity: number }>;
  seedRelations?: Partial<Record<string, Array<Record<string, unknown>>>>;
}) {
  const products = [
    { ...opts.survivor, isActive: opts.survivor.isActive ?? true, mergedIntoProductId: opts.survivor.mergedIntoProductId ?? null, barcode: null },
    { ...opts.merged, isActive: opts.merged.isActive ?? true, mergedIntoProductId: opts.merged.mergedIntoProductId ?? null, barcode: null },
  ];
  const balances = (opts.balances ?? []).map((b) => ({
    id: `bal-${b.branchId}-${b.productId}`,
    branchId: b.branchId,
    productId: b.productId,
    quantityOnHand: new Prisma.Decimal(b.quantityOnHand),
    closedPackageQuantity: new Prisma.Decimal(0),
    looseUnitQuantity: new Prisma.Decimal(0),
    weightedAverageCost: new Prisma.Decimal(b.weightedAverageCost),
    inventoryValue: new Prisma.Decimal(b.quantityOnHand * b.weightedAverageCost),
  }));
  const stockGroupMembers = opts.stockGroupMembers ?? [];
  const purchaseOrderLines = opts.purchaseOrderLines ?? [];
  const timberProducts = opts.timberProducts ?? [];
  const barcodes = opts.barcodes ?? [];
  const conditionBalances = (opts.conditionBalances ?? []).map((c) => ({ ...c, quantity: new Prisma.Decimal(c.quantity) }));
  const productMerges: Array<Record<string, unknown>> = [];
  const auditLogs: Array<Record<string, unknown>> = [];
  const movements: Array<Record<string, unknown>> = [];

  const productTable = makeTable(products);
  const balanceTable = makeTable(balances);
  const conditionTable = makeTable(conditionBalances);
  const barcodeTable = makeTable(barcodes);
  const timberTable = makeTable(timberProducts);
  const poLineTable = makeTable(purchaseOrderLines.map((p, i) => ({ id: `po-${i}`, ...p })));
  const stockGroupMemberTable = makeTable(stockGroupMembers.map((m, i) => ({ id: `sgm-${i}`, ...m })));

  const genericTables: Record<string, ReturnType<typeof makeTable>> = {};
  for (const name of GENERIC_RELATION_DELEGATES) {
    genericTables[name] = makeTable(opts.seedRelations?.[name] ?? []);
  }

  const db: Record<string, unknown> = {
    product: {
      findUnique: productTable.findUnique,
      update: productTable.update,
    },
    inventoryBalance: {
      findMany: balanceTable.findMany,
      findUnique: async ({ where }: { where: { branchId_productId?: { branchId: string; productId: string } } }) => {
        const key = where.branchId_productId;
        if (!key) return null;
        const found = balances.find((b) => b.branchId === key.branchId && b.productId === key.productId);
        return found ? { ...found } : null;
      },
      upsert: async ({ where, create, update }: { where: { branchId_productId?: { branchId: string; productId: string } }; create: Record<string, unknown>; update: Record<string, unknown> }) => {
        const key = where.branchId_productId!;
        const row = balances.find((b) => b.branchId === key.branchId && b.productId === key.productId);
        if (row) { Object.assign(row, update); return { ...row }; }
        // Prisma convierte un 0 crudo del `create` a Decimal(0) — la fila
        // recién creada acá tiene que entrar con el mismo tipo, o
        // recalculateWeightedAverage revienta en .lt() sobre un number.
        const created = {
          id: `bal-gen-${balances.length + 1}`,
          branchId: create.branchId as string,
          productId: create.productId as string,
          quantityOnHand: new Prisma.Decimal((create.quantityOnHand as number) ?? 0),
          closedPackageQuantity: new Prisma.Decimal((create.closedPackageQuantity as number) ?? 0),
          looseUnitQuantity: new Prisma.Decimal((create.looseUnitQuantity as number) ?? 0),
          weightedAverageCost: new Prisma.Decimal((create.weightedAverageCost as number) ?? 0),
          inventoryValue: new Prisma.Decimal((create.inventoryValue as number) ?? 0),
        };
        balances.push(created as never);
        return created;
      },
      update: async ({ where, data }: { where: { id: string }; data: Record<string, unknown> }) => {
        const row = balances.find((b) => b.id === where.id);
        if (!row) throw new Error("not found");
        Object.assign(row, data);
        return { ...row };
      },
    },
    inventoryConditionBalance: {
      findMany: conditionTable.findMany,
      upsert: async ({ where, create, update }: { where: { branchId_productId_condition?: { branchId: string; productId: string; condition: string } }; create: Record<string, unknown>; update: Record<string, unknown> }) => {
        const key = where.branchId_productId_condition!;
        const row = conditionBalances.find((c) => c.branchId === key.branchId && c.productId === key.productId && c.condition === key.condition);
        if (row) { Object.assign(row, update); return { ...row }; }
        const created = { id: `cond-${conditionBalances.length + 1}`, ...create };
        conditionBalances.push(created as never);
        return created;
      },
      update: conditionTable.update,
    },
    productBarcode: {
      findMany: barcodeTable.findMany,
      findFirst: barcodeTable.findFirst,
      count: barcodeTable.count,
      update: barcodeTable.update,
      updateMany: barcodeTable.updateMany,
    },
    timberProduct: {
      findUnique: timberTable.findUnique,
      update: timberTable.update,
    },
    purchaseOrderLine: { count: poLineTable.count, findMany: poLineTable.findMany, updateMany: poLineTable.updateMany },
    productStockGroupMember: { count: stockGroupMemberTable.count, findFirst: async () => null },
    productMerge: { create: async ({ data }: { data: Record<string, unknown> }) => { const row = { id: `merge-${productMerges.length + 1}`, ...data }; productMerges.push(row); return row; } },
    auditLog: { create: async ({ data }: { data: Record<string, unknown> }) => { auditLogs.push(data); return data; } },
    inventoryMovement: {
      create: async ({ data }: { data: Record<string, unknown> }) => { const row = { id: `mv-${movements.length + 1}`, ...data }; movements.push(row); return row; },
      count: async ({ where }: { where?: Record<string, unknown> } = {}) => movements.filter((m) => matchWhere(m, where)).length,
    },
    systemSetting: { findUnique: async () => null },
    $queryRaw: async () => [],
  };

  for (const name of GENERIC_RELATION_DELEGATES) {
    db[name] = { findMany: genericTables[name].findMany, count: genericTables[name].count, updateMany: genericTables[name].updateMany };
  }

  return {
    db: db as never,
    getProducts: () => products.map((p) => ({ ...p })),
    getBalances: () => balances.map((b) => ({ ...b })),
    getBarcodes: () => barcodes.map((b) => ({ ...b })),
    getConditionBalances: () => conditionBalances.map((c) => ({ ...c })),
    getMovements: () => movements,
    getMerges: () => productMerges,
    getAuditLogs: () => auditLogs,
    genericTables,
  };
}

const SURVIVOR = { id: "prod-a", sku: "GEN-0001", name: "Cemento Canal", unit: "SACO" };
const MERGED = { id: "prod-b", sku: "GEN-0099", name: "Cemento Canal (duplicado)", unit: "SACO" };

test("MERGE_RELATION_POLICY cubre TODAS las relaciones de negocio de Product del DMMF (ni de más, ni de menos)", async () => {
  const { Prisma: PrismaRuntime } = await import("@prisma/client");
  const model = PrismaRuntime.dmmf.datamodel.models.find((m) => m.name === "Product");
  assert.ok(model, "el modelo Product debe existir en el DMMF");
  const relationFieldNames = model!.fields.filter((f) => f.kind === "object").map((f) => f.name);

  const businessRelations = relationFieldNames.filter((name) => !MERGE_POLICY_EXCLUDED_RELATIONS.includes(name));
  const policyKeys = Object.keys(MERGE_RELATION_POLICY);

  for (const name of businessRelations) {
    assert.ok(policyKeys.includes(name), `falta política de fusión para la relación "${name}" — agregala a MERGE_RELATION_POLICY`);
  }
  for (const key of policyKeys) {
    assert.ok(relationFieldNames.includes(key), `MERGE_RELATION_POLICY tiene una entrada "${key}" que ya no existe como relación de Product`);
  }
});

test("previewMerge — sin conflictos: canExecute true, sin bloqueos", async () => {
  const { db } = buildFakeDb({ survivor: SURVIVOR, merged: MERGED });
  const preview = await previewMerge({ survivingProductId: SURVIVOR.id, mergedProductId: MERGED.id }, db);
  assert.equal(preview.canExecute, true);
  assert.equal(preview.blockers.length, 0);
});

test("previewMerge — producto ya fusionado antes: bloquea", async () => {
  const { db } = buildFakeDb({ survivor: SURVIVOR, merged: { ...MERGED, mergedIntoProductId: "otro-producto" } });
  const preview = await previewMerge({ survivingProductId: SURVIVOR.id, mergedProductId: MERGED.id }, db);
  assert.equal(preview.canExecute, false);
  assert.ok(preview.blockers.some((b) => b.code === "ALREADY_MERGED"));
});

test("previewMerge — unidad distinta sin confirmar: bloquea", async () => {
  const { db } = buildFakeDb({ survivor: SURVIVOR, merged: { ...MERGED, unit: "UN" } });
  const preview = await previewMerge({ survivingProductId: SURVIVOR.id, mergedProductId: MERGED.id }, db);
  assert.equal(preview.canExecute, false);
  assert.ok(preview.blockers.some((b) => b.code === "UNIT_MISMATCH"));
});

test("previewMerge — unidad distinta CONFIRMADA: ya no bloquea por esa razón", async () => {
  const { db } = buildFakeDb({ survivor: SURVIVOR, merged: { ...MERGED, unit: "UN" } });
  const preview = await previewMerge({ survivingProductId: SURVIVOR.id, mergedProductId: MERGED.id, confirmUnitMismatch: true }, db);
  assert.ok(!preview.blockers.some((b) => b.code === "UNIT_MISMATCH"));
});

test("previewMerge — membresía de fusión de inventario (stock-group) ACTIVA: bloquea", async () => {
  const { db } = buildFakeDb({
    survivor: SURVIVOR,
    merged: MERGED,
    stockGroupMembers: [{ productId: MERGED.id, isActive: true, stockGroup: { isActive: true } }],
  });
  const preview = await previewMerge({ survivingProductId: SURVIVOR.id, mergedProductId: MERGED.id }, db);
  assert.equal(preview.canExecute, false);
  assert.ok(preview.blockers.some((b) => b.code === "STOCK_GROUP_MEMBER"));
});

test("previewMerge — orden de compra ABIERTA (DRAFT/APPROVED) de B: bloquea", async () => {
  const { db } = buildFakeDb({
    survivor: SURVIVOR,
    merged: MERGED,
    purchaseOrderLines: [{ productId: MERGED.id, purchaseOrder: { status: "APPROVED" } }],
  });
  const preview = await previewMerge({ survivingProductId: SURVIVOR.id, mergedProductId: MERGED.id }, db);
  assert.equal(preview.canExecute, false);
  assert.ok(preview.blockers.some((b) => b.code === "OPEN_PURCHASE_ORDER"));
});

test("previewMerge — orden de compra ya RECEIVED de B: NO bloquea (es historial, no algo en curso)", async () => {
  const { db } = buildFakeDb({
    survivor: SURVIVOR,
    merged: MERGED,
    purchaseOrderLines: [{ productId: MERGED.id, purchaseOrder: { status: "RECEIVED" } }],
  });
  const preview = await previewMerge({ survivingProductId: SURVIVOR.id, mergedProductId: MERGED.id }, db);
  assert.equal(preview.canExecute, true);
});

test("previewMerge — los dos tienen su propia configuración de madera: bloquea", async () => {
  const { db } = buildFakeDb({
    survivor: SURVIVOR,
    merged: MERGED,
    timberProducts: [{ id: "tp-a", productId: SURVIVOR.id }, { id: "tp-b", productId: MERGED.id }],
  });
  const preview = await previewMerge({ survivingProductId: SURVIVOR.id, mergedProductId: MERGED.id }, db);
  assert.equal(preview.canExecute, false);
  assert.ok(preview.blockers.some((b) => b.code === "TIMBER_CONFIG_CONFLICT"));
});

test("previewMerge — CHOOSE: avisa cuántas filas de B chocan con A en la misma sucursal", async () => {
  const { db } = buildFakeDb({
    survivor: SURVIVOR,
    merged: MERGED,
    seedRelations: {
      branchProductSetting: [
        { id: "bps-a", productId: SURVIVOR.id, branchId: "branch-1" },
        { id: "bps-b1", productId: MERGED.id, branchId: "branch-1" },
        { id: "bps-b2", productId: MERGED.id, branchId: "branch-2" },
      ],
    },
  });
  const preview = await previewMerge({ survivingProductId: SURVIVOR.id, mergedProductId: MERGED.id }, db);
  const line = preview.plan.find((p) => p.relation === "branchProductSettings");
  assert.equal(line?.count, 2);
  assert.equal(line?.conflictCount, 1);
  assert.ok(preview.warnings.some((w) => w.code === "BRANCHPRODUCTSETTINGS_CONFLICT"));
});

test("mergeProductsTx — SKU de confirmación equivocado: rechaza con VALIDATION_ERROR, no toca nada", async () => {
  const { db, getProducts } = buildFakeDb({ survivor: SURVIVOR, merged: MERGED });
  await assert.rejects(
    () => mergeProductsTx(db, { survivingProductId: SURVIVOR.id, mergedProductId: MERGED.id, confirmedMergedSku: "SKU-QUE-NO-ES", actorUserId: "u1" }),
    /VALIDATION_ERROR/,
  );
  assert.equal(getProducts().find((p) => p.id === MERGED.id)?.isActive, true, "B no debe quedar tocado si la confirmación falla");
});

test("mergeProductsTx — bloqueado (unidad distinta sin confirmar): rechaza con MERGE_BLOCKED", async () => {
  const { db } = buildFakeDb({ survivor: SURVIVOR, merged: { ...MERGED, unit: "UN" } });
  await assert.rejects(
    () => mergeProductsTx(db, { survivingProductId: SURVIVOR.id, mergedProductId: MERGED.id, confirmedMergedSku: MERGED.sku, actorUserId: "u1" }),
    /MERGE_BLOCKED/,
  );
});

test("mergeProductsTx — LA QUE IMPORTA: transferencia de stock + WAC recompuesto igual que un ajuste normal", async () => {
  const { db, getBalances, getProducts, getMovements } = buildFakeDb({
    survivor: SURVIVOR,
    merged: MERGED,
    balances: [
      { branchId: "branch-1", productId: SURVIVOR.id, quantityOnHand: 100, weightedAverageCost: 18.55 },
      { branchId: "branch-1", productId: MERGED.id, quantityOnHand: 20, weightedAverageCost: 20 },
    ],
  });

  await mergeProductsTx(db, { survivingProductId: SURVIVOR.id, mergedProductId: MERGED.id, confirmedMergedSku: MERGED.sku, actorUserId: "u1" });

  // (100*18.55 + 20*20) / 120 = 18.7916... — EXACTAMENTE la misma cuenta
  // que recalculateWeightedAverage hace para un ADJUSTMENT_IN cualquiera
  // (ver inventory/opening-balance.test.ts, test 11, mismos números).
  const expectedWac = (100 * 18.55 + 20 * 20) / 120;
  const survivorBalance = getBalances().find((b) => b.productId === SURVIVOR.id && b.branchId === "branch-1");
  assert.ok(Math.abs(survivorBalance!.weightedAverageCost.toNumber() - expectedWac) < 0.001);
  assert.equal(survivorBalance!.quantityOnHand.toNumber(), 120);

  const mergedBalance = getBalances().find((b) => b.productId === MERGED.id && b.branchId === "branch-1");
  assert.equal(mergedBalance!.quantityOnHand.toNumber(), 0, "el stock de B queda en cero — todo pasó a A");

  const movementTypes = getMovements().map((m) => m.movementType).sort();
  assert.deepEqual(movementTypes, ["PRODUCT_MERGE_IN", "PRODUCT_MERGE_OUT"]);

  assert.equal(getProducts().find((p) => p.id === MERGED.id)?.isActive, false);
  assert.equal(getProducts().find((p) => p.id === MERGED.id)?.mergedIntoProductId, SURVIVOR.id);
});

test("mergeProductsTx — códigos de barra de B pasan a A; si A no tenía ninguno, el más viejo de B se vuelve principal", async () => {
  const { db, getBarcodes, getProducts } = buildFakeDb({
    survivor: SURVIVOR,
    merged: MERGED,
    barcodes: [
      { id: "bc1", productId: MERGED.id, code: "1000000000000", isPrimary: true, createdAt: new Date(0) },
      { id: "bc2", productId: MERGED.id, code: "2000000000000", isPrimary: false, createdAt: new Date(1) },
    ],
  });

  await mergeProductsTx(db, { survivingProductId: SURVIVOR.id, mergedProductId: MERGED.id, confirmedMergedSku: MERGED.sku, actorUserId: "u1" });

  const barcodes = getBarcodes();
  assert.ok(barcodes.every((b) => b.productId === SURVIVOR.id));
  assert.equal(barcodes.find((b) => b.id === "bc1")?.isPrimary, true, "el más viejo de B se vuelve principal de A");
  assert.equal(barcodes.find((b) => b.id === "bc2")?.isPrimary, false);
  assert.equal(getProducts().find((p) => p.id === SURVIVOR.id)?.barcode, "1000000000000");
});

test("mergeProductsTx — MOVE genérico: reorderAlerts de B pasan a A sin condición", async () => {
  const { db, genericTables } = buildFakeDb({
    survivor: SURVIVOR,
    merged: MERGED,
    seedRelations: { reorderAlert: [{ id: "ra1", productId: MERGED.id }] },
  });

  await mergeProductsTx(db, { survivingProductId: SURVIVOR.id, mergedProductId: MERGED.id, confirmedMergedSku: MERGED.sku, actorUserId: "u1" });

  const rows = await genericTables.reorderAlert.findMany({});
  assert.equal(rows[0].productId, SURVIVOR.id);
});

test("mergeProductsTx — CHOOSE: la fila de A gana, la de B que choca se queda en B (no se duplica)", async () => {
  const { db, genericTables } = buildFakeDb({
    survivor: SURVIVOR,
    merged: MERGED,
    seedRelations: {
      branchProductSetting: [
        { id: "bps-a", productId: SURVIVOR.id, branchId: "branch-1" },
        { id: "bps-b1", productId: MERGED.id, branchId: "branch-1" },
        { id: "bps-b2", productId: MERGED.id, branchId: "branch-2" },
      ],
    },
  });

  await mergeProductsTx(db, { survivingProductId: SURVIVOR.id, mergedProductId: MERGED.id, confirmedMergedSku: MERGED.sku, actorUserId: "u1" });

  const rows = await genericTables.branchProductSetting.findMany({});
  const byId = Object.fromEntries(rows.map((r) => [r.id, r]));
  assert.equal(byId["bps-a"].productId, SURVIVOR.id);
  assert.equal(byId["bps-b1"].productId, MERGED.id, "la fila que choca (branch-1, ya cubierta por A) se queda en B");
  assert.equal(byId["bps-b2"].productId, SURVIVOR.id, "la que no choca (branch-2) sí se mueve a A");
});

test("mergeProductsTx — CLOSE: las ventas de B quedan intactas apuntándole a B (no se reescribe el pasado)", async () => {
  const { db, genericTables } = buildFakeDb({
    survivor: SURVIVOR,
    merged: MERGED,
    seedRelations: { saleOrderLine: [{ id: "sol1", productId: MERGED.id }] },
  });

  await mergeProductsTx(db, { survivingProductId: SURVIVOR.id, mergedProductId: MERGED.id, confirmedMergedSku: MERGED.sku, actorUserId: "u1" });

  const rows = await genericTables.saleOrderLine.findMany({});
  assert.equal(rows[0].productId, MERGED.id, "las ventas de B siguen siendo de B — es historia, no se mueve");
});

test("mergeProductsTx — doble ejecución: la segunda encuentra a B ya fusionado y rechaza con MERGE_BLOCKED", async () => {
  const { db } = buildFakeDb({
    survivor: SURVIVOR,
    merged: MERGED,
    balances: [{ branchId: "branch-1", productId: MERGED.id, quantityOnHand: 5, weightedAverageCost: 10 }],
  });

  await mergeProductsTx(db, { survivingProductId: SURVIVOR.id, mergedProductId: MERGED.id, confirmedMergedSku: MERGED.sku, actorUserId: "u1" });

  await assert.rejects(
    () => mergeProductsTx(db, { survivingProductId: SURVIVOR.id, mergedProductId: MERGED.id, confirmedMergedSku: MERGED.sku, actorUserId: "u1" }),
    /MERGE_BLOCKED/,
  );
});

test("mergeProductsTx — by-code con el SKU de B debería resolver a A (findProductByCode usa mergedIntoProductId — ver catalog/service.ts)", async () => {
  const { db, getProducts } = buildFakeDb({ survivor: SURVIVOR, merged: MERGED });
  await mergeProductsTx(db, { survivingProductId: SURVIVOR.id, mergedProductId: MERGED.id, confirmedMergedSku: MERGED.sku, actorUserId: "u1" });
  const mergedProduct = getProducts().find((p) => p.id === MERGED.id);
  assert.equal(mergedProduct?.mergedIntoProductId, SURVIVOR.id);
});
