import assert from "node:assert/strict";
import test from "node:test";
import { Prisma } from "@prisma/client";
import { completeBatchTx, reverseBatchTx } from "@/modules/production/service";

/**
 * prompt-produccion-materiales.md Fase 1 — completeBatch/reverseBatch
 * validaban el estado FUERA de cualquier transacción y el update final no
 * era condicional: un doble click o un reintento de red pasaba la
 * validación las dos veces, consumía insumos dos veces y/o inyectaba costo
 * dos veces. Ahora todo vive dentro de un SELECT...FOR UPDATE + updateMany
 * condicional. Este archivo prueba la atomicidad con un tx fake (no hay
 * lock real de Postgres en memoria, pero sí se puede probar la RELECTURA
 * del estado y el rechazo si ya no es el esperado — exactamente lo que
 * evita el doble consumo).
 *
 * El fake cubre el camino MÁS simple posible (sin fusión/paquetes, WAC
 * prendido) para no reimplementar medio inventory/service.ts — lo que se
 * prueba acá es la transición de estado y la foto de receta, no el motor
 * de WAC (ya cubierto en otros tests).
 */

const BRANCH_ID = "branch-1";
const RECIPE_ID = "recipe-1";
const FINISHED_PRODUCT_ID = "fin-1";
const INPUT_PRODUCT_ID = "ins-1";
const BATCH_ID = "batch-1";

type FakeBalance = { id: string; branchId: string; productId: string; quantityOnHand: Prisma.Decimal; closedPackageQuantity: Prisma.Decimal; looseUnitQuantity: Prisma.Decimal; weightedAverageCost: Prisma.Decimal; inventoryValue: Prisma.Decimal };

function createFakeStore(opts: {
  batchStatus?: string;
  batchInputs: Array<{ id: string; inputProductId: string; plannedQuantity: number; actualQuantity: number | null; unit: string }>;
  recipeInputs: Array<{ inputProductId: string; quantity: number; unit: string }>;
  insumoWac?: number;
  insumoStock?: number;
  finishedProductBalance?: { quantityOnHand: number; weightedAverageCost: number } | null;
  producedGoodQuantity?: number | null;
  producedBadQuantity?: number | null;
  unitCost?: number | null;
}) {
  const batch = {
    id: BATCH_ID,
    batchNumber: "PROD-2026-01-001",
    status: opts.batchStatus ?? "PLANNED",
    plannedQuantity: 100,
    producedGoodQuantity: opts.producedGoodQuantity ?? null,
    producedBadQuantity: opts.producedBadQuantity ?? null,
    branchId: BRANCH_ID,
    recipeId: RECIPE_ID,
    pricePolicy: "KEEP_CURRENT",
    startedAt: null as Date | null,
    completedAt: null as Date | null,
    cancelledAt: null as Date | null,
    reversedAt: null as Date | null,
    reversedByUserId: null as string | null,
    reversalReason: null as string | null,
    materialsCost: null as Prisma.Decimal | null,
    laborCost: null as Prisma.Decimal | null,
    overheadCost: null as Prisma.Decimal | null,
    totalCost: null as Prisma.Decimal | null,
    unitCost: opts.unitCost != null ? new Prisma.Decimal(opts.unitCost) : (null as Prisma.Decimal | null),
    suggestedPrice: null as Prisma.Decimal | null,
    standardUnitCost: null as Prisma.Decimal | null,
    standardMaterialsCost: null as Prisma.Decimal | null,
    priceApprovalRequired: false,
    laborEntries: null as unknown,
  };

  const batchInputs = opts.batchInputs.map((bi) => ({
    ...bi,
    batchId: BATCH_ID,
    reservedQuantity: new Prisma.Decimal(bi.plannedQuantity),
    // En un COMPLETED real, completeBatchTx ya dejó esto seteado (consumption
    // loop) — los fixtures que arrancan directo en COMPLETED (tests de
    // reverseBatchTx) lo necesitan para no disparar ZERO_COST_INBOUND al
    // devolver el insumo.
    unitCost: bi.actualQuantity != null ? new Prisma.Decimal(opts.insumoWac ?? 10) : (null as Prisma.Decimal | null),
    totalCost: bi.actualQuantity != null ? new Prisma.Decimal(bi.actualQuantity * (opts.insumoWac ?? 10)) : (null as Prisma.Decimal | null),
    inputProduct: { id: bi.inputProductId, name: `Insumo ${bi.inputProductId}`, sku: bi.inputProductId.toUpperCase() },
  }));

  const recipe = {
    id: RECIPE_ID,
    finishedProductId: FINISHED_PRODUCT_ID,
    expectedQuantity: 100,
    overheadMode: "NONE",
    processingCostPerBatch: null as Prisma.Decimal | null,
    laborEnabled: false,
    laborCostPerBatch: null as Prisma.Decimal | null,
    targetMarginPct: new Prisma.Decimal(0.3),
    updatedAt: new Date("2026-01-01"),
    finishedProduct: { id: FINISHED_PRODUCT_ID, sku: "FIN", name: "Producto Terminado", unit: "UNIDAD" },
    inputs: opts.recipeInputs.map((ri) => ({
      inputProductId: ri.inputProductId,
      quantity: ri.quantity,
      unit: ri.unit,
      inputProduct: { id: ri.inputProductId, name: `Insumo ${ri.inputProductId}`, sku: ri.inputProductId.toUpperCase() },
    })),
  };

  const balances = new Map<string, FakeBalance>();
  balances.set(INPUT_PRODUCT_ID, {
    id: "bal-ins-1",
    branchId: BRANCH_ID,
    productId: INPUT_PRODUCT_ID,
    quantityOnHand: new Prisma.Decimal(opts.insumoStock ?? 1000),
    closedPackageQuantity: new Prisma.Decimal(0),
    looseUnitQuantity: new Prisma.Decimal(0),
    weightedAverageCost: new Prisma.Decimal(opts.insumoWac ?? 10),
    inventoryValue: new Prisma.Decimal((opts.insumoStock ?? 1000) * (opts.insumoWac ?? 10)),
  });
  if (opts.finishedProductBalance) {
    balances.set(FINISHED_PRODUCT_ID, {
      id: "bal-fin-1",
      branchId: BRANCH_ID,
      productId: FINISHED_PRODUCT_ID,
      quantityOnHand: new Prisma.Decimal(opts.finishedProductBalance.quantityOnHand),
      closedPackageQuantity: new Prisma.Decimal(0),
      looseUnitQuantity: new Prisma.Decimal(0),
      weightedAverageCost: new Prisma.Decimal(opts.finishedProductBalance.weightedAverageCost),
      inventoryValue: new Prisma.Decimal(opts.finishedProductBalance.quantityOnHand * opts.finishedProductBalance.weightedAverageCost),
    });
  }

  const products = new Map<string, { id: string; standardSalePrice: Prisma.Decimal | null }>([
    [FINISHED_PRODUCT_ID, { id: FINISHED_PRODUCT_ID, standardSalePrice: new Prisma.Decimal(12) }],
    [INPUT_PRODUCT_ID, { id: INPUT_PRODUCT_ID, standardSalePrice: new Prisma.Decimal(1) }],
  ]);
  const branchProductSettings = new Map<string, { branchCost: Prisma.Decimal | null; branchPrice: Prisma.Decimal | null }>();

  const movements: Array<{ id: string; productId: string; movementType: string; quantity: Prisma.Decimal; unitCost: Prisma.Decimal }> = [];
  const auditLogs: Array<{ action: string; entityType: string; entityId: string; branchId?: string | null; occurredAt: Date; metadataJson: unknown }> = [];
  let auditSeq = 0;
  let movementSeq = 0;

  const tx = {
    $queryRaw: async () => [],
    productionBatch: {
      findUnique: async () => (batch.status === "__deleted__" ? null : { ...batch, recipe, inputs: batchInputs }),
      findUniqueOrThrow: async () => ({ ...batch, recipe, inputs: batchInputs }),
      updateMany: async ({ where, data }: { where: { id: string; status: string }; data: Record<string, unknown> }) => {
        if (where.id !== batch.id || where.status !== batch.status) return { count: 0 };
        Object.assign(batch, data);
        return { count: 1 };
      },
    },
    productionBatchInput: {
      update: async ({ where, data }: { where: { id: string }; data: Record<string, unknown> }) => {
        const row = batchInputs.find((bi) => bi.id === where.id);
        if (row) Object.assign(row, data);
        return row;
      },
      updateMany: async ({ data }: { data: Record<string, unknown> }) => {
        for (const row of batchInputs) Object.assign(row, data);
        return { count: batchInputs.length };
      },
      findMany: async () => [], // nadie más reservó este insumo
    },
    productionPricingConfig: {
      findFirst: async () => null, // usa DEFAULT_PRODUCTION_PRICING_CONFIG
    },
    systemSetting: {
      findUnique: async () => ({ value: "true" }), // WAC prendido: getInputWacTx usa el balance directo, sin cost-chain
    },
    productStockGroupMember: {
      findFirst: async () => null, // sin fusión para ningún producto de este fixture
    },
    inventoryBalance: {
      findUnique: async ({ where }: { where: { branchId_productId: { productId: string } } }) =>
        balances.get(where.branchId_productId.productId) ?? null,
      upsert: async ({ where, create }: { where: { branchId_productId: { productId: string } }; create: Record<string, unknown> }) => {
        const existing = balances.get(where.branchId_productId.productId);
        if (existing) return existing;
        const fresh: FakeBalance = {
          id: `bal-${where.branchId_productId.productId}`,
          branchId: BRANCH_ID,
          productId: where.branchId_productId.productId,
          quantityOnHand: new Prisma.Decimal(0),
          closedPackageQuantity: new Prisma.Decimal(0),
          looseUnitQuantity: new Prisma.Decimal(0),
          weightedAverageCost: new Prisma.Decimal(0),
          inventoryValue: new Prisma.Decimal(0),
        };
        void create;
        balances.set(where.branchId_productId.productId, fresh);
        return fresh;
      },
      update: async ({ where, data }: { where: { id: string }; data: Record<string, unknown> }) => {
        const row = [...balances.values()].find((b) => b.id === where.id);
        if (!row) throw new Error("balance not found");
        Object.assign(row, data);
        return row;
      },
    },
    inventoryMovement: {
      create: async ({ data }: { data: { productId: string; movementType: string; quantity: Prisma.Decimal; unitCost: Prisma.Decimal } }) => {
        movementSeq += 1;
        const row = { id: `mv-${movementSeq}`, productId: data.productId, movementType: data.movementType, quantity: data.quantity, unitCost: data.unitCost };
        movements.push(row);
        return row;
      },
    },
    product: {
      findUnique: async ({ where }: { where: { id: string } }) => products.get(where.id) ?? null,
      update: async ({ where, data }: { where: { id: string }; data: { standardSalePrice?: Prisma.Decimal } }) => {
        const row = products.get(where.id);
        if (row && data.standardSalePrice !== undefined) row.standardSalePrice = data.standardSalePrice;
        return row;
      },
    },
    branchProductSetting: {
      findUnique: async ({ where }: { where: { branchId_productId: { productId: string } } }) =>
        branchProductSettings.get(where.branchId_productId.productId) ?? null,
      upsert: async ({ where, create, update }: { where: { branchId_productId: { productId: string } }; create: Record<string, unknown>; update: Record<string, unknown> }) => {
        const key = where.branchId_productId.productId;
        const existing = branchProductSettings.get(key);
        const next = (existing ? { ...existing, ...update } : { branchCost: null, branchPrice: null, ...create }) as { branchCost: Prisma.Decimal | null; branchPrice: Prisma.Decimal | null };
        branchProductSettings.set(key, next);
        return next;
      },
    },
    auditLog: {
      create: async ({ data }: { data: Record<string, unknown> }) => {
        auditSeq += 1;
        const row = { id: `audit-${auditSeq}`, occurredAt: new Date(2026, 0, 1, 0, 0, auditSeq), ...data } as unknown as { action: string; entityType: string; entityId: string; branchId?: string | null; occurredAt: Date; metadataJson: unknown };
        auditLogs.push(row);
        return row;
      },
      findFirst: async (args: { where: Record<string, unknown>; orderBy?: { occurredAt: "asc" | "desc" } }) => {
        const matches = auditLogs.filter((log) => {
          for (const [key, value] of Object.entries(args.where)) {
            if (key === "metadataJson") {
              const filter = value as { path: string[]; equals: unknown };
              const meta = log.metadataJson as Record<string, unknown>;
              if (meta?.[filter.path[0]] !== filter.equals) return false;
            } else if (key === "occurredAt") {
              const filter = value as { gt: Date };
              if (!(log.occurredAt > filter.gt)) return false;
            } else if ((log as unknown as Record<string, unknown>)[key] !== value) {
              return false;
            }
          }
          return true;
        });
        const sorted = args.orderBy?.occurredAt === "desc" ? [...matches].sort((a, b) => b.occurredAt.getTime() - a.occurredAt.getTime()) : matches;
        return sorted[0] ?? null;
      },
    },
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
  } as any;

  return { tx: tx as Prisma.TransactionClient, batch, batchInputs, movements, auditLogs, balances };
}

test("LA QUE IMPORTA — doble completeBatch (doble click/reintento): el segundo falla y solo hay un consumo", async () => {
  const { tx, movements } = createFakeStore({
    batchInputs: [{ id: "bi-1", inputProductId: INPUT_PRODUCT_ID, plannedQuantity: 5, actualQuantity: null, unit: "KILO" }],
    recipeInputs: [{ inputProductId: INPUT_PRODUCT_ID, quantity: 5, unit: "KILO" }],
  });

  const completeInput = { producedGoodQuantity: 100, producedBadQuantity: 0, laborEntries: [], expectedHash: "", actorUserId: "user-1" };

  // Primer llamado: necesita el hash real del preview — se calcula pidiendo
  // el preview primero (como hace la ruta real: injection-preview -> complete).
  const { buildProductionInjectionPreview } = await import("@/modules/production/service");
  const preview1 = await buildProductionInjectionPreview(tx, { batchId: BATCH_ID, producedGoodQuantity: 100, producedBadQuantity: 0 });

  const first = await completeBatchTx(tx, BATCH_ID, { ...completeInput, expectedHash: preview1.hash });
  assert.equal(first.ok, true);
  assert.equal(first.statusAfter, "COMPLETED");
  const consumeMovements = movements.filter((m) => m.movementType === "PRODUCTION_CONSUME");
  const outputMovements = movements.filter((m) => m.movementType === "PRODUCTION_OUTPUT");
  assert.equal(consumeMovements.length, 1, "un insumo -> un movimiento de consumo");
  assert.equal(outputMovements.length, 1);

  // Segundo llamado (doble click/reintento): mismo id, el estado ya es
  // COMPLETED — debe rechazarse SIN crear ningún movimiento nuevo.
  await assert.rejects(
    () => completeBatchTx(tx, BATCH_ID, { ...completeInput, expectedHash: preview1.hash }),
    /BATCH_ALREADY_PROCESSED/,
  );
  assert.equal(movements.filter((m) => m.movementType === "PRODUCTION_CONSUME").length, 1, "el segundo intento no consume de nuevo");
  assert.equal(movements.filter((m) => m.movementType === "PRODUCTION_OUTPUT").length, 1, "el segundo intento no produce de nuevo");
});

test("LA QUE IMPORTA — el lote consume según SU PROPIA foto de insumos, no la receta editada después", async () => {
  const { tx, movements } = createFakeStore({
    // La foto del lote (congelada al crear): 5 kilos para 100 unidades.
    batchInputs: [{ id: "bi-1", inputProductId: INPUT_PRODUCT_ID, plannedQuantity: 5, actualQuantity: null, unit: "KILO" }],
    // La receta HOY ya no dice 5 — alguien la editó a 8 después de crear el lote.
    recipeInputs: [{ inputProductId: INPUT_PRODUCT_ID, quantity: 8, unit: "KILO" }],
  });

  const { buildProductionInjectionPreview } = await import("@/modules/production/service");
  const preview = await buildProductionInjectionPreview(tx, { batchId: BATCH_ID, producedGoodQuantity: 100, producedBadQuantity: 0 });

  // Con la foto (5) y multiplicador 100/100=1, se consume 5 — NUNCA 8.
  assert.equal(preview.lines[0].neededQuantity, 5, "el preview ya calcula sobre la foto, no sobre la receta editada");

  await completeBatchTx(tx, BATCH_ID, { producedGoodQuantity: 100, producedBadQuantity: 0, laborEntries: [], expectedHash: preview.hash, actorUserId: "user-1" });

  const consumed = movements.find((m) => m.movementType === "PRODUCTION_CONSUME");
  assert.equal(consumed?.quantity.toNumber(), 5, "el consumo real también usa la foto (5), no la receta actual (8)");
});

test("un lote SIN foto de insumos (legacy) cae a la receta actual, con advertencia", async () => {
  const { tx } = createFakeStore({
    batchInputs: [], // lote viejo, creado antes de esta corrección
    recipeInputs: [{ inputProductId: INPUT_PRODUCT_ID, quantity: 8, unit: "KILO" }],
  });
  const { buildProductionInjectionPreview } = await import("@/modules/production/service");
  const preview = await buildProductionInjectionPreview(tx, { batchId: BATCH_ID, producedGoodQuantity: 100, producedBadQuantity: 0 });
  assert.equal(preview.lines[0].neededQuantity, 8, "sin foto, usa la receta actual (8)");
  assert.ok(preview.warnings.some((w) => w.includes("no tiene una foto de insumos")), "advierte que está usando el fallback");
});

test("LA QUE IMPORTA — doble reversión: el segundo falla", async () => {
  const { tx } = createFakeStore({
    batchStatus: "COMPLETED",
    batchInputs: [{ id: "bi-1", inputProductId: INPUT_PRODUCT_ID, plannedQuantity: 5, actualQuantity: 5, unit: "KILO" }],
    recipeInputs: [{ inputProductId: INPUT_PRODUCT_ID, quantity: 5, unit: "KILO" }],
    producedGoodQuantity: 100,
    producedBadQuantity: 0,
    unitCost: 0.5,
    finishedProductBalance: { quantityOnHand: 100, weightedAverageCost: 0.5 },
  });

  const first = await reverseBatchTx(tx, BATCH_ID, { reason: "Cerrado con cantidades equivocadas", actorUserId: "user-1" });
  assert.equal(first.status, "REVERSED");

  await assert.rejects(
    () => reverseBatchTx(tx, BATCH_ID, { reason: "Segundo intento", actorUserId: "user-1" }),
    /ONLY_COMPLETED_BATCHES_CAN_BE_REVERSED/,
  );
});

test("reversión SIN lotes posteriores restaura costo y precio al valor de antes del lote", async () => {
  const { tx } = createFakeStore({
    batchStatus: "COMPLETED",
    batchInputs: [{ id: "bi-1", inputProductId: INPUT_PRODUCT_ID, plannedQuantity: 5, actualQuantity: 5, unit: "KILO" }],
    recipeInputs: [{ inputProductId: INPUT_PRODUCT_ID, quantity: 5, unit: "KILO" }],
    producedGoodQuantity: 100,
    producedBadQuantity: 0,
    unitCost: 0.5,
    finishedProductBalance: { quantityOnHand: 100, weightedAverageCost: 0.5 },
  });

  // Simula que ESTE lote ya había inyectado antes (antes→12, después→0.5),
  // tal como completeBatchTx lo deja marcado con batchId.
  await (tx as unknown as { auditLog: { create: (args: { data: Record<string, unknown> }) => Promise<unknown> } }).auditLog.create({
    data: {
      module: "production",
      action: "PRODUCTION_COST_INJECTED",
      entityType: "Product",
      entityId: FINISHED_PRODUCT_ID,
      branchId: BRANCH_ID,
      metadataJson: { before: { standardSalePrice: 12, branchCost: 11, branchPrice: 12 }, after: { standardSalePrice: 0.5, branchCost: 0.5, branchPrice: 0.5 }, batchId: BATCH_ID },
    },
  });

  const result = await reverseBatchTx(tx, BATCH_ID, { reason: "Cerrado con cantidades equivocadas", actorUserId: "user-1" });
  assert.equal(result.warnings.length, 0, "sin lotes posteriores, se restaura sin advertencia");

  const product = await (tx as unknown as { product: { findUnique: (args: { where: { id: string } }) => Promise<{ standardSalePrice: Prisma.Decimal } | null> } }).product.findUnique({ where: { id: FINISHED_PRODUCT_ID } });
  assert.equal(product?.standardSalePrice.toNumber(), 12, "standardSalePrice vuelve al valor de antes de este lote");
});

test("reversión CON un lote posterior que ya inyectó: no toca el costo/precio, advierte", async () => {
  const { tx } = createFakeStore({
    batchStatus: "COMPLETED",
    batchInputs: [{ id: "bi-1", inputProductId: INPUT_PRODUCT_ID, plannedQuantity: 5, actualQuantity: 5, unit: "KILO" }],
    recipeInputs: [{ inputProductId: INPUT_PRODUCT_ID, quantity: 5, unit: "KILO" }],
    producedGoodQuantity: 100,
    producedBadQuantity: 0,
    unitCost: 0.5,
    finishedProductBalance: { quantityOnHand: 100, weightedAverageCost: 0.5 },
  });

  const auditApi = (tx as unknown as { auditLog: { create: (args: { data: Record<string, unknown> }) => Promise<{ occurredAt: Date }> } }).auditLog;
  await auditApi.create({
    data: {
      module: "production",
      action: "PRODUCTION_COST_INJECTED",
      entityType: "Product",
      entityId: FINISHED_PRODUCT_ID,
      branchId: BRANCH_ID,
      metadataJson: { before: { standardSalePrice: 12, branchCost: 11, branchPrice: 12 }, after: { standardSalePrice: 0.5, branchCost: 0.5, branchPrice: 0.5 }, batchId: BATCH_ID },
    },
  });
  // Un lote DISTINTO (otro batchId) inyectó DESPUÉS sobre el mismo producto.
  await auditApi.create({
    data: {
      module: "production",
      action: "PRODUCTION_COST_INJECTED",
      entityType: "Product",
      entityId: FINISHED_PRODUCT_ID,
      branchId: BRANCH_ID,
      metadataJson: { before: { standardSalePrice: 0.5, branchCost: 0.5, branchPrice: 0.5 }, after: { standardSalePrice: 0.8, branchCost: 0.8, branchPrice: 0.8 }, batchId: "batch-OTRO" },
    },
  });

  const result = await reverseBatchTx(tx, BATCH_ID, { reason: "Cerrado con cantidades equivocadas", actorUserId: "user-1" });
  assert.equal(result.warnings.length, 1);
  assert.match(result.warnings[0], /no restaurado: hubo lotes posteriores/);

  const product = await (tx as unknown as { product: { findUnique: (args: { where: { id: string } }) => Promise<{ standardSalePrice: Prisma.Decimal } | null> } }).product.findUnique({ where: { id: FINISHED_PRODUCT_ID } });
  assert.equal(product?.standardSalePrice.toNumber(), 12, "nunca se llama a product.update — el valor queda en el default del fixture, no en ninguno de los 'before' de los dos eventos");
});
