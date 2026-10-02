import assert from "node:assert/strict";
import test from "node:test";
import { Prisma } from "@prisma/client";
import { completeBatchTx, buildProductionInjectionPreview } from "@/modules/production/service";
import { applyWasteFactor } from "@/modules/production/calculations";

/**
 * prompt-produccion-materiales.md Fase 2 — consumo real al cerrar
 * (actualInputs), merma esperada en la planificación (applyWasteFactor) y
 * segunda calidad. Mismo fake mínimo (sin fusión, WAC prendido) que
 * batch-atomicity.test.ts — ver ese archivo para el porqué de cada pieza.
 */

const BRANCH_ID = "branch-1";
const RECIPE_ID = "recipe-1";
const FINISHED_PRODUCT_ID = "fin-1";
const INPUT_PRODUCT_ID = "ins-1";
const SECOND_GRADE_PRODUCT_ID = "seg-1";
const BATCH_ID = "batch-1";

type FakeBalance = { id: string; branchId: string; productId: string; quantityOnHand: Prisma.Decimal; closedPackageQuantity: Prisma.Decimal; looseUnitQuantity: Prisma.Decimal; weightedAverageCost: Prisma.Decimal; inventoryValue: Prisma.Decimal };

function createFakeStore(opts: {
  recipeInputs: Array<{ inputProductId: string; quantity: number; unit: string }>;
  secondGradeProductId?: string | null;
  insumoWac?: number;
  insumoStock?: number;
}) {
  const batch = {
    id: BATCH_ID,
    batchNumber: "PROD-2026-01-001",
    status: "PLANNED",
    plannedQuantity: 100,
    producedGoodQuantity: null as number | null,
    producedBadQuantity: null as number | null,
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
    unitCost: null as Prisma.Decimal | null,
    suggestedPrice: null as Prisma.Decimal | null,
    standardUnitCost: null as Prisma.Decimal | null,
    standardMaterialsCost: null as Prisma.Decimal | null,
    priceApprovalRequired: false,
    laborEntries: null as unknown,
    consumptionMode: "STANDARD",
    materialVarianceCost: null as Prisma.Decimal | null,
    yieldVariancePct: null as Prisma.Decimal | null,
  };

  const batchInputs = opts.recipeInputs.map((ri, idx) => ({
    id: `bi-${idx + 1}`,
    batchId: BATCH_ID,
    inputProductId: ri.inputProductId,
    plannedQuantity: ri.quantity, // 1 batch, expectedQuantity=100=plannedQuantity -> multiplier=1
    actualQuantity: null as number | null,
    standardQuantity: null as number | null,
    unit: ri.unit,
    reservedQuantity: new Prisma.Decimal(ri.quantity),
    unitCost: null as Prisma.Decimal | null,
    totalCost: null as Prisma.Decimal | null,
    inputProduct: { id: ri.inputProductId, name: `Insumo ${ri.inputProductId}`, sku: ri.inputProductId.toUpperCase() },
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
    yieldPercent: null as Prisma.Decimal | null,
    secondGradeProductId: opts.secondGradeProductId ?? null,
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
    id: "bal-ins-1", branchId: BRANCH_ID, productId: INPUT_PRODUCT_ID,
    quantityOnHand: new Prisma.Decimal(opts.insumoStock ?? 1000),
    closedPackageQuantity: new Prisma.Decimal(0), looseUnitQuantity: new Prisma.Decimal(0),
    weightedAverageCost: new Prisma.Decimal(opts.insumoWac ?? 10),
    inventoryValue: new Prisma.Decimal((opts.insumoStock ?? 1000) * (opts.insumoWac ?? 10)),
  });

  const products = new Map<string, { id: string; standardSalePrice: Prisma.Decimal | null }>([
    [FINISHED_PRODUCT_ID, { id: FINISHED_PRODUCT_ID, standardSalePrice: new Prisma.Decimal(12) }],
    [INPUT_PRODUCT_ID, { id: INPUT_PRODUCT_ID, standardSalePrice: new Prisma.Decimal(1) }],
    [SECOND_GRADE_PRODUCT_ID, { id: SECOND_GRADE_PRODUCT_ID, standardSalePrice: new Prisma.Decimal(5) }],
  ]);
  const branchProductSettings = new Map<string, { branchCost: Prisma.Decimal | null; branchPrice: Prisma.Decimal | null }>();

  const movements: Array<{ id: string; productId: string; movementType: string; quantity: Prisma.Decimal; unitCost: Prisma.Decimal }> = [];
  const auditLogs: Array<{ action: string; entityType: string; entityId: string; branchId?: string | null; occurredAt: Date; metadataJson: unknown }> = [];
  let auditSeq = 0;
  let movementSeq = 0;

  const tx = {
    $queryRaw: async () => [],
    productionBatch: {
      findUnique: async () => ({ ...batch, recipe, inputs: batchInputs }),
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
      findMany: async () => [],
    },
    productionPricingConfig: { findFirst: async () => null },
    systemSetting: { findUnique: async () => ({ value: "true" }) },
    productStockGroupMember: { findFirst: async () => null },
    inventoryBalance: {
      findUnique: async ({ where }: { where: { branchId_productId: { productId: string } } }) => balances.get(where.branchId_productId.productId) ?? null,
      upsert: async ({ where }: { where: { branchId_productId: { productId: string } } }) => {
        const existing = balances.get(where.branchId_productId.productId);
        if (existing) return existing;
        const fresh: FakeBalance = {
          id: `bal-${where.branchId_productId.productId}`, branchId: BRANCH_ID, productId: where.branchId_productId.productId,
          quantityOnHand: new Prisma.Decimal(0), closedPackageQuantity: new Prisma.Decimal(0), looseUnitQuantity: new Prisma.Decimal(0),
          weightedAverageCost: new Prisma.Decimal(0), inventoryValue: new Prisma.Decimal(0),
        };
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
      findUnique: async ({ where }: { where: { branchId_productId: { productId: string } } }) => branchProductSettings.get(where.branchId_productId.productId) ?? null,
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
            } else if ((log as unknown as Record<string, unknown>)[key] !== value) {
              return false;
            }
          }
          return true;
        });
        return matches[0] ?? null;
      },
    },
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
  } as any;

  return { tx: tx as Prisma.TransactionClient, batch, batchInputs, movements, auditLogs };
}

test("LA QUE IMPORTA — con actualInputs, el cierre consume lo REAL y materialVarianceCost refleja la diferencia", async () => {
  const { tx, batch, movements } = createFakeStore({
    recipeInputs: [{ inputProductId: INPUT_PRODUCT_ID, quantity: 5, unit: "KILO" }],
    insumoWac: 10,
  });

  const preview = await buildProductionInjectionPreview(tx, {
    batchId: BATCH_ID,
    producedGoodQuantity: 100,
    producedBadQuantity: 0,
    actualInputs: [{ inputProductId: INPUT_PRODUCT_ID, actualQuantity: 6 }],
  });

  assert.equal(preview.lines[0].standardQuantity, 5, "el estándar sigue siendo 5 (receta x multiplicador)");
  assert.equal(preview.lines[0].neededQuantity, 6, "lo que se va a consumir es lo REAL (6), no el estándar");
  assert.equal(preview.materialVarianceCost, 10, "(6-5)*10 de WAC = 10 de variancia de materiales");

  await completeBatchTx(tx, BATCH_ID, {
    producedGoodQuantity: 100, producedBadQuantity: 0, laborEntries: [], expectedHash: preview.hash,
    secondGradeQuantity: 0, actualInputs: [{ inputProductId: INPUT_PRODUCT_ID, actualQuantity: 6 }], actorUserId: "user-1",
  });

  const consumed = movements.find((m) => m.movementType === "PRODUCTION_CONSUME");
  assert.equal(consumed?.quantity.toNumber(), 6, "el movimiento de inventario consume lo real (6), no el estándar (5)");
  assert.equal(batch.consumptionMode, "ACTUAL");
  assert.equal(Number(batch.materialVarianceCost), 10);
});

test("sin actualInputs, todo da idéntico a antes de esta fase: consumptionMode=STANDARD, materialVarianceCost=null", async () => {
  const { tx, batch, movements } = createFakeStore({
    recipeInputs: [{ inputProductId: INPUT_PRODUCT_ID, quantity: 5, unit: "KILO" }],
    insumoWac: 10,
  });

  const preview = await buildProductionInjectionPreview(tx, { batchId: BATCH_ID, producedGoodQuantity: 100, producedBadQuantity: 0 });
  assert.equal(preview.lines[0].neededQuantity, 5);
  assert.equal(preview.materialVarianceCost, 0, "sin ninguna línea con actualQuantity, la variancia de materiales es 0");

  await completeBatchTx(tx, BATCH_ID, {
    producedGoodQuantity: 100, producedBadQuantity: 0, laborEntries: [], expectedHash: preview.hash, secondGradeQuantity: 0, actorUserId: "user-1",
  });

  const consumed = movements.find((m) => m.movementType === "PRODUCTION_CONSUME");
  assert.equal(consumed?.quantity.toNumber(), 5);
  assert.equal(batch.consumptionMode, "STANDARD");
  assert.equal(batch.materialVarianceCost, null, "sin consumo real, no se guarda variancia de materiales (null, no 0 engañoso)");
});

test("merma esperada — applyWasteFactor: 5% de merma pide 1/0.95 más de cada insumo", () => {
  const result = applyWasteFactor(new Prisma.Decimal(1), 0.05);
  assert.ok(result.sub(1 / 0.95).abs().lt(0.0001), `esperaba ~${1 / 0.95}, dio ${result.toNumber()}`);
});

test("merma esperada — sin wastePercent configurado, el multiplicador no cambia", () => {
  const result = applyWasteFactor(new Prisma.Decimal(2.5), null);
  assert.equal(result.toNumber(), 2.5);
});

test("merma esperada — wastePercent fuera de (0,1) (dato corrupto) no se aplica", () => {
  assert.equal(applyWasteFactor(new Prisma.Decimal(1), 1).toNumber(), 1, "wastePercent=1 dividiría por 0 — se ignora");
  assert.equal(applyWasteFactor(new Prisma.Decimal(1), -0.1).toNumber(), 1, "negativo no tiene sentido — se ignora");
});

test("LA QUE IMPORTA — segunda calidad: entra stock del producto de segunda y el costo unitario de las buenas NO cambia", async () => {
  const { tx, movements, auditLogs } = createFakeStore({
    recipeInputs: [{ inputProductId: INPUT_PRODUCT_ID, quantity: 5, unit: "KILO" }],
    insumoWac: 10,
    secondGradeProductId: SECOND_GRADE_PRODUCT_ID,
  });

  // El preview NUNCA sabe de segundaCalidad — unitCost sale solo de
  // materialsCost/producedGoodQuantity, así que ya es, por construcción,
  // independiente de cuántas "malas" se reclasifiquen como segunda.
  const preview = await buildProductionInjectionPreview(tx, { batchId: BATCH_ID, producedGoodQuantity: 100, producedBadQuantity: 10 });

  await completeBatchTx(tx, BATCH_ID, {
    producedGoodQuantity: 100, producedBadQuantity: 10, laborEntries: [], expectedHash: preview.hash,
    secondGradeQuantity: 4, actorUserId: "user-1",
  });

  const secondGradeMovement = movements.find((m) => m.productId === SECOND_GRADE_PRODUCT_ID);
  assert.ok(secondGradeMovement, "debe crear un PRODUCTION_OUTPUT del producto de segunda");
  assert.equal(secondGradeMovement?.quantity.toNumber(), 4);

  const finishedMovement = movements.find((m) => m.productId === FINISHED_PRODUCT_ID && m.movementType === "PRODUCTION_OUTPUT");
  assert.equal(finishedMovement?.unitCost.toNumber(), preview.unitCost, "el costo unitario de las buenas es el mismo que sin segunda calidad");

  assert.ok(auditLogs.some((l) => l.action === "BATCH_SECOND_GRADE"), "debe auditar BATCH_SECOND_GRADE");
});

test("segunda calidad: rechaza si secondGradeQuantity supera las unidades malas declaradas", async () => {
  const { tx } = createFakeStore({
    recipeInputs: [{ inputProductId: INPUT_PRODUCT_ID, quantity: 5, unit: "KILO" }],
    secondGradeProductId: SECOND_GRADE_PRODUCT_ID,
  });
  const preview = await buildProductionInjectionPreview(tx, { batchId: BATCH_ID, producedGoodQuantity: 100, producedBadQuantity: 3 });
  await assert.rejects(
    () => completeBatchTx(tx, BATCH_ID, { producedGoodQuantity: 100, producedBadQuantity: 3, laborEntries: [], expectedHash: preview.hash, secondGradeQuantity: 5, actorUserId: "user-1" }),
    /no pueden superar las unidades malas/,
  );
});

test("segunda calidad: rechaza si la receta no tiene secondGradeProductId configurado", async () => {
  const { tx } = createFakeStore({
    recipeInputs: [{ inputProductId: INPUT_PRODUCT_ID, quantity: 5, unit: "KILO" }],
    secondGradeProductId: null,
  });
  const preview = await buildProductionInjectionPreview(tx, { batchId: BATCH_ID, producedGoodQuantity: 100, producedBadQuantity: 3 });
  await assert.rejects(
    () => completeBatchTx(tx, BATCH_ID, { producedGoodQuantity: 100, producedBadQuantity: 3, laborEntries: [], expectedHash: preview.hash, secondGradeQuantity: 2, actorUserId: "user-1" }),
    /no tiene un producto de segunda calidad configurado/,
  );
});
