import { Prisma, ProductionBatchStatus, PrismaClient } from "@prisma/client";
import { createHash } from "crypto";
import { prisma } from "@/lib/prisma";
import { logAuditEvent } from "@/modules/audit/service";
import { createInventoryMovementTx } from "@/modules/inventory/service";
import {
  convertBaseQtyToSaleQty,
  convertBaseUnitCostToSaleUnitCost,
  getProductStockConversion,
  getSharedInventoryBalance,
} from "@/modules/inventory/unit-conversion";
import { buildProductSearchWhere } from "@/modules/catalog/product-search";
import { resolveGlobalCostWriteTarget } from "@/modules/catalog/service";
import { calculateBatchCosts, calculateTargetMarginPrice, computeBatchCostSummary } from "./calculations";
import { reserveBatchInputsTx, releaseBatchInputsTx, getProductionReservedBaseQtyTx, type ReservationResult } from "./reservations";
import type {
  CreateRecipeInput,
  UpdateRecipeInput,
  CreateBatchInput,
  UpdateBatchInput,
  CompleteBatchInput,
  CalculateCostInput,
  ReverseBatchInput,
} from "./validators";

type DbClient = PrismaClient | Prisma.TransactionClient;

// ═══════════════════════════════════════════════════════════════════════════
// PRICING CONFIG (Producción v2 Fase 3 — configuración como datos)
// ═══════════════════════════════════════════════════════════════════════════

export type ProductionPricingConfig = {
  defaultTargetMarginPct: Prisma.Decimal;
  priceApprovalDeltaPct: Prisma.Decimal;
  priceRoundingMultiple: Prisma.Decimal;
};

const DEFAULT_PRODUCTION_PRICING_CONFIG: ProductionPricingConfig = {
  defaultTargetMarginPct: new Prisma.Decimal(0.3),
  priceApprovalDeltaPct: new Prisma.Decimal(0.15),
  priceRoundingMultiple: new Prisma.Decimal(1),
};

export async function getProductionPricingConfig(): Promise<ProductionPricingConfig> {
  const cfg = await prisma.productionPricingConfig.findFirst({ orderBy: { updatedAt: "desc" } });
  if (!cfg) return DEFAULT_PRODUCTION_PRICING_CONFIG;
  return {
    defaultTargetMarginPct: cfg.defaultTargetMarginPct,
    priceApprovalDeltaPct: cfg.priceApprovalDeltaPct,
    priceRoundingMultiple: cfg.priceRoundingMultiple,
  };
}

// ═══════════════════════════════════════════════════════════════════════════
// UNIT VALIDATION (Producción v2 Fase 1.3)
// ═══════════════════════════════════════════════════════════════════════════

/**
 * La cantidad de un insumo de receta SIEMPRE se interpreta en la unidad de
 * venta propia del producto (así es como createInventoryMovementTx convierte
 * a base internamente). Antes `unit` era texto libre nunca verificado — un
 * insumo cargado con una unidad que no coincide con su unidad real de venta
 * producía un descuadre silencioso de inventario sin ningún error. Se
 * rechaza aquí, al guardar la receta, no en cada cierre de lote.
 */
export async function validateRecipeInputUnitTx(
  db: DbClient,
  input: { inputProductId: string; unit: string },
): Promise<void> {
  const product = await db.product.findUnique({
    where: { id: input.inputProductId },
    select: { unit: true, name: true, sku: true },
  });
  if (!product) throw new Error(`INVALID_INPUT: Producto de insumo ${input.inputProductId} no encontrado.`);

  const conversion = await getProductStockConversion(db, input.inputProductId);
  const expectedUnit = (conversion?.saleUnit ?? product.unit).trim().toUpperCase();
  const providedUnit = input.unit.trim().toUpperCase();
  if (expectedUnit !== providedUnit) {
    throw new Error(
      `INVALID_INPUT: La unidad "${input.unit}" no coincide con la unidad de venta de ${product.sku} (${product.name}): "${conversion?.saleUnit ?? product.unit}".`,
    );
  }
}

// ═══════════════════════════════════════════════════════════════════════════
// RECIPES
// ═══════════════════════════════════════════════════════════════════════════

export async function getRecipes(params: { isActive?: boolean; q?: string; recipeType?: string; recipeFamily?: string }) {
  const where: Prisma.ProductionRecipeWhereInput = {};
  if (params.isActive !== undefined) where.isActive = params.isActive;
  if (params.recipeType) where.recipeType = params.recipeType;
  if (params.recipeFamily) where.recipeFamily = params.recipeFamily;
  if (params.q) {
    Object.assign(where, buildProductSearchWhere<Prisma.ProductionRecipeWhereInput>(params.q, ["name", "code"]));
  }

  return prisma.productionRecipe.findMany({
    where,
    include: {
      finishedProduct: { select: { id: true, sku: true, name: true, unit: true } },
      inputs: {
        include: {
          inputProduct: { select: { id: true, sku: true, name: true, unit: true } },
        },
      },
      createdBy: { select: { id: true, fullName: true } },
      _count: { select: { batches: true } },
    },
    orderBy: [{ isActive: "desc" }, { name: "asc" }],
  });
}

export async function getRecipeById(id: string) {
  const recipe = await prisma.productionRecipe.findUnique({
    where: { id },
    include: {
      finishedProduct: { select: { id: true, sku: true, name: true, unit: true } },
      inputs: {
        include: {
          inputProduct: { select: { id: true, sku: true, name: true, unit: true } },
        },
      },
      createdBy: { select: { id: true, fullName: true } },
      batches: {
        take: 10,
        orderBy: { createdAt: "desc" },
        select: {
          id: true,
          batchNumber: true,
          status: true,
          plannedQuantity: true,
          producedGoodQuantity: true,
          totalCost: true,
          unitCost: true,
          standardUnitCost: true,
          createdAt: true,
        },
      },
    },
  });
  if (!recipe) throw new Error("RECIPE_NOT_FOUND");
  return recipe;
}

export async function createRecipe(input: CreateRecipeInput & { actorUserId: string }) {
  const product = await prisma.product.findUnique({ where: { id: input.finishedProductId } });
  if (!product) throw new Error("INVALID_INPUT: Producto terminado no encontrado");

  const inputProductIds = input.inputs.map((i) => i.inputProductId);
  const inputProducts = await prisma.product.findMany({
    where: { id: { in: inputProductIds } },
    select: { id: true },
  });
  if (inputProducts.length !== inputProductIds.length) {
    throw new Error("INVALID_INPUT: Uno o más productos de insumo no existen");
  }

  for (const i of input.inputs) {
    await validateRecipeInputUnitTx(prisma, { inputProductId: i.inputProductId, unit: i.unit });
  }

  const recipe = await prisma.productionRecipe.create({
    data: {
      name: input.name.trim(),
      code: input.code,
      description: input.description ?? null,
      finishedProductId: input.finishedProductId,
      expectedQuantity: input.expectedQuantity,
      expectedUnit: input.expectedUnit.trim(),
      recipeType: input.recipeType,
      recipeFamily: input.recipeFamily,
      targetMarginPct: input.targetMarginPct ?? null,
      yieldPercent: input.yieldPercent ?? null,
      wastePercent: input.wastePercent ?? null,
      laborEnabled: input.laborEnabled,
      laborCostPerBatch: input.laborCostPerBatch ?? null,
      overheadMode: input.overheadMode,
      processingCostPerBatch: input.processingCostPerBatch ?? null,
      notes: input.notes ?? null,
      createdByUserId: input.actorUserId,
      inputs: {
        create: input.inputs.map((i) => ({
          inputProductId: i.inputProductId,
          quantity: i.quantity,
          unit: i.unit.trim(),
          notes: i.notes ?? null,
        })),
      },
    },
    include: {
      finishedProduct: { select: { id: true, sku: true, name: true } },
      inputs: {
        include: {
          inputProduct: { select: { id: true, sku: true, name: true } },
        },
      },
    },
  });

  await logAuditEvent({
    actorUserId: input.actorUserId,
    module: "production",
    action: "RECIPE_CREATE",
    entityType: "ProductionRecipe",
    entityId: recipe.id,
  });

  return recipe;
}

export async function updateRecipe(
  id: string,
  input: UpdateRecipeInput & { actorUserId: string },
) {
  const existing = await prisma.productionRecipe.findUnique({ where: { id } });
  if (!existing) throw new Error("RECIPE_NOT_FOUND");

  if (input.inputs) {
    for (const i of input.inputs) {
      await validateRecipeInputUnitTx(prisma, { inputProductId: i.inputProductId, unit: i.unit });
    }
  }

  const recipe = await prisma.$transaction(async (tx) => {
    if (input.inputs) {
      await tx.productionRecipeInput.deleteMany({ where: { recipeId: id } });
      await tx.productionRecipeInput.createMany({
        data: input.inputs.map((i) => ({
          recipeId: id,
          inputProductId: i.inputProductId,
          quantity: i.quantity,
          unit: i.unit.trim(),
          notes: i.notes ?? null,
        })),
      });
    }

    return tx.productionRecipe.update({
      where: { id },
      data: {
        name: input.name?.trim(),
        description: input.description,
        expectedQuantity: input.expectedQuantity,
        expectedUnit: input.expectedUnit?.trim(),
        recipeType: input.recipeType,
        recipeFamily: input.recipeFamily,
        targetMarginPct: input.targetMarginPct,
        yieldPercent: input.yieldPercent,
        wastePercent: input.wastePercent,
        laborEnabled: input.laborEnabled,
        laborCostPerBatch: input.laborCostPerBatch,
        overheadMode: input.overheadMode,
        processingCostPerBatch: input.processingCostPerBatch,
        isActive: input.isActive,
        notes: input.notes,
      },
      include: {
        finishedProduct: { select: { id: true, sku: true, name: true } },
        inputs: {
          include: {
            inputProduct: { select: { id: true, sku: true, name: true } },
          },
        },
      },
    });
  });

  await logAuditEvent({
    actorUserId: input.actorUserId,
    module: "production",
    action: "RECIPE_UPDATE",
    entityType: "ProductionRecipe",
    entityId: recipe.id,
  });

  return recipe;
}

// ═══════════════════════════════════════════════════════════════════════════
// STANDARD MATERIALS COST — núcleo compartido entre el preview de
// planificación (calculateCost), el preview de inyección al cerrar
// (buildProductionInjectionPreview) y el cierre real (completeBatch). Una
// sola función que lee el WAC del sistema por insumo — nunca un costo
// enviado por el cliente (Producción v2 Fase 1).
// ═══════════════════════════════════════════════════════════════════════════

async function getInputWacTx(
  db: DbClient,
  params: { branchId: string; productId: string; excludeBatchId?: string },
): Promise<{ wacSaleUnit: Prisma.Decimal; stockSaleUnit: Prisma.Decimal }> {
  const shared = await getSharedInventoryBalance(db, params);
  const wacSaleUnit = shared.balance
    ? shared.conversion
      ? convertBaseUnitCostToSaleUnitCost({ baseUnitCost: shared.balance.weightedAverageCost, conversionFactor: shared.conversion.conversionFactor })
      : shared.balance.weightedAverageCost
    : new Prisma.Decimal(0);
  const physicalStockSaleUnit = shared.balance
    ? shared.conversion
      ? convertBaseQtyToSaleQty({ baseQuantity: shared.balance.quantityOnHand, conversionFactor: shared.conversion.conversionFactor })
      : shared.balance.quantityOnHand
    : new Prisma.Decimal(0);
  // Producción v2 Fase 2: lo reservado por OTROS lotes PLANNED/IN_PROGRESS no
  // está disponible para este — así como el POS ve menos stock, un segundo
  // lote no puede planificar sobre lo que el primero ya apartó.
  const reservedByOthersBaseQty = await getProductionReservedBaseQtyTx(db as Prisma.TransactionClient, {
    branchId: params.branchId,
    productId: params.productId,
    excludeBatchId: params.excludeBatchId,
  });
  const reservedByOthersSaleQty = shared.conversion
    ? convertBaseQtyToSaleQty({ baseQuantity: reservedByOthersBaseQty, conversionFactor: shared.conversion.conversionFactor })
    : reservedByOthersBaseQty;
  const stockSaleUnit = Prisma.Decimal.max(0, physicalStockSaleUnit.sub(reservedByOthersSaleQty));
  return { wacSaleUnit, stockSaleUnit };
}

export type MaterialLine = {
  inputProductId: string;
  productName: string;
  productSku: string;
  recipeQtyPerBatch: number;
  neededQuantity: Prisma.Decimal;
  unit: string;
  wacSaleUnit: Prisma.Decimal;
  stockSaleUnit: Prisma.Decimal;
  lineCost: Prisma.Decimal;
  hasEnoughStock: boolean;
};

async function computeStandardMaterialsLinesTx(
  db: DbClient,
  params: {
    branchId: string;
    multiplier: Prisma.Decimal;
    recipeInputs: Array<{ inputProductId: string; quantity: number; unit: string; inputProduct: { name: string; sku: string } }>;
    /** Excluye la propia reserva del lote que se está previsualizando (no cuenta contra sí mismo). */
    excludeBatchId?: string;
  },
): Promise<{ lines: MaterialLine[]; totalCost: Prisma.Decimal }> {
  const lines: MaterialLine[] = [];
  for (const ri of params.recipeInputs) {
    const { wacSaleUnit, stockSaleUnit } = await getInputWacTx(db, { branchId: params.branchId, productId: ri.inputProductId, excludeBatchId: params.excludeBatchId });
    const neededQuantity = new Prisma.Decimal(ri.quantity).mul(params.multiplier);
    const lineCost = neededQuantity.mul(wacSaleUnit);
    lines.push({
      inputProductId: ri.inputProductId,
      productName: ri.inputProduct.name,
      productSku: ri.inputProduct.sku,
      recipeQtyPerBatch: ri.quantity,
      neededQuantity,
      unit: ri.unit,
      wacSaleUnit,
      stockSaleUnit,
      lineCost,
      hasEnoughStock: stockSaleUnit.gte(neededQuantity),
    });
  }
  const totalCost = lines.reduce((sum, l) => sum.add(l.lineCost), new Prisma.Decimal(0));
  return { lines, totalCost };
}

/** Mano de obra (fija, informativa por defecto) + overhead (según recipe.overheadMode) del lote. */
function computeLaborAndOverhead(
  recipe: { laborEnabled: boolean; laborCostPerBatch: Prisma.Decimal | null; overheadMode: string; processingCostPerBatch: Prisma.Decimal | null },
  materialsCost: Prisma.Decimal,
): { laborCost: Prisma.Decimal; overheadCost: Prisma.Decimal } {
  const laborCost = recipe.laborEnabled && recipe.laborCostPerBatch != null
    ? new Prisma.Decimal(recipe.laborCostPerBatch)
    : new Prisma.Decimal(0);

  let overheadCost = new Prisma.Decimal(0);
  if (recipe.overheadMode === "FIXED" && recipe.processingCostPerBatch != null) {
    overheadCost = new Prisma.Decimal(recipe.processingCostPerBatch);
  } else if (recipe.overheadMode === "PCT_MAT" && recipe.processingCostPerBatch != null) {
    overheadCost = materialsCost.mul(new Prisma.Decimal(recipe.processingCostPerBatch));
  }
  return { laborCost, overheadCost };
}

// ═══════════════════════════════════════════════════════════════════════════
// BATCHES
// ═══════════════════════════════════════════════════════════════════════════

async function generateBatchNumber(): Promise<string> {
  const now = new Date();
  const year = now.getFullYear();
  const month = String(now.getMonth() + 1).padStart(2, "0");
  const prefix = `PROD-${year}-${month}-`;

  const lastBatch = await prisma.productionBatch.findFirst({
    where: { batchNumber: { startsWith: prefix } },
    orderBy: { batchNumber: "desc" },
    select: { batchNumber: true },
  });

  let seq = 1;
  if (lastBatch) {
    const parts = lastBatch.batchNumber.split("-");
    const last = parseInt(parts[parts.length - 1], 10);
    if (!isNaN(last)) seq = last + 1;
  }

  return `${prefix}${String(seq).padStart(3, "0")}`;
}

export async function getBatches(params: {
  status?: ProductionBatchStatus;
  branchId?: string;
  recipeId?: string;
  limit?: number;
}) {
  const where: Prisma.ProductionBatchWhereInput = {};
  if (params.status) where.status = params.status;
  if (params.branchId) where.branchId = params.branchId;
  if (params.recipeId) where.recipeId = params.recipeId;

  return prisma.productionBatch.findMany({
    where,
    include: {
      recipe: { select: { id: true, name: true, code: true } },
      branch: { select: { id: true, code: true, name: true } },
      createdBy: { select: { id: true, fullName: true } },
      _count: { select: { inputs: true } },
    },
    orderBy: { createdAt: "desc" },
    take: params.limit ?? 50,
  });
}

export async function getBatchById(id: string) {
  const batch = await prisma.productionBatch.findUnique({
    where: { id },
    include: {
      recipe: {
        include: {
          finishedProduct: { select: { id: true, sku: true, name: true, unit: true } },
          inputs: {
            include: {
              inputProduct: { select: { id: true, sku: true, name: true, unit: true } },
            },
          },
        },
      },
      branch: { select: { id: true, code: true, name: true } },
      createdBy: { select: { id: true, fullName: true } },
      inputs: {
        include: {
          inputProduct: { select: { id: true, sku: true, name: true, unit: true } },
        },
      },
    },
  });
  if (!batch) throw new Error("BATCH_NOT_FOUND");
  return batch;
}

export async function createBatch(input: CreateBatchInput & { actorUserId: string }) {
  const recipe = await prisma.productionRecipe.findUnique({
    where: { id: input.recipeId },
    include: { inputs: true },
  });
  if (!recipe) throw new Error("INVALID_INPUT: Receta no encontrada");
  if (!recipe.isActive) throw new Error("INVALID_INPUT: Receta inactiva");

  const branch = await prisma.branch.findUnique({ where: { id: input.branchId } });
  if (!branch) throw new Error("INVALID_INPUT: Sucursal no encontrada");

  const batchNumber = await generateBatchNumber();
  const multiplier = new Prisma.Decimal(input.plannedQuantity).div(recipe.expectedQuantity);

  const batch = await prisma.productionBatch.create({
    data: {
      batchNumber,
      recipeId: input.recipeId,
      branchId: input.branchId,
      plannedQuantity: input.plannedQuantity,
      notes: input.notes ?? null,
      createdByUserId: input.actorUserId,
      inputs: {
        create: recipe.inputs.map((ri) => ({
          inputProductId: ri.inputProductId,
          plannedQuantity: new Prisma.Decimal(ri.quantity).mul(multiplier).toNumber(),
          unit: ri.unit,
        })),
      },
    },
    include: {
      recipe: { select: { id: true, name: true, code: true } },
      branch: { select: { id: true, code: true, name: true } },
      inputs: {
        include: {
          inputProduct: { select: { id: true, sku: true, name: true } },
        },
      },
    },
  });

  await logAuditEvent({
    actorUserId: input.actorUserId,
    module: "production",
    action: "BATCH_CREATE",
    entityType: "ProductionBatch",
    entityId: batch.id,
    metadataJson: { batchNumber, recipeId: input.recipeId, branchId: input.branchId },
  });

  return batch;
}

export async function updateBatch(
  id: string,
  input: UpdateBatchInput & { actorUserId: string },
) {
  const existing = await prisma.productionBatch.findUnique({ where: { id } });
  if (!existing) throw new Error("BATCH_NOT_FOUND");

  if (existing.status === "COMPLETED" || existing.status === "CANCELLED" || existing.status === "REVERSED") {
    throw new Error("INVALID_TRANSITION");
  }

  if (input.status) {
    const validTransitions: Record<string, string[]> = {
      DRAFT: ["PLANNED", "IN_PROGRESS", "CANCELLED"],
      PLANNED: ["IN_PROGRESS", "CANCELLED"],
      IN_PROGRESS: ["CANCELLED"],
    };
    const allowed = validTransitions[existing.status] ?? [];
    if (!allowed.includes(input.status)) {
      throw new Error("INVALID_TRANSITION");
    }
  }

  // Producción v2 Fase 2: entrar a PLANNED reserva lo disponible de cada
  // insumo (el faltante no bloquea, solo se reporta). Cancelar libera.
  let reservation: ReservationResult[] | null = null;
  if (input.status === "PLANNED" || (input.status === "IN_PROGRESS" && existing.status === "DRAFT")) {
    reservation = await prisma.$transaction((tx) => reserveBatchInputsTx(tx, { batchId: id, branchId: existing.branchId }));
  }
  if (input.status === "CANCELLED") {
    await prisma.$transaction((tx) => releaseBatchInputsTx(tx, id));
  }

  const updateData: Prisma.ProductionBatchUpdateInput = {};
  if (input.plannedQuantity !== undefined) updateData.plannedQuantity = input.plannedQuantity;
  if (input.notes !== undefined) updateData.notes = input.notes;
  if (input.pricePolicy !== undefined) updateData.pricePolicy = input.pricePolicy;

  if (input.status) {
    updateData.status = input.status;
    if (input.status === "IN_PROGRESS") updateData.startedAt = new Date();
    if (input.status === "CANCELLED") updateData.cancelledAt = new Date();
  }

  const batch = await prisma.productionBatch.update({
    where: { id },
    data: updateData,
    include: {
      recipe: { select: { id: true, name: true, code: true } },
      branch: { select: { id: true, code: true, name: true } },
    },
  });

  await logAuditEvent({
    actorUserId: input.actorUserId,
    module: "production",
    action: "BATCH_UPDATE",
    entityType: "ProductionBatch",
    entityId: batch.id,
    metadataJson: { status: batch.status, reservation },
  });

  return { ...batch, reservation };
}

// ═══════════════════════════════════════════════════════════════════════════
// COST INJECTION (Producción v2 Fase 3 — "nadie inyecta sin ver")
// ═══════════════════════════════════════════════════════════════════════════

export type ProductionCostInjectionSnapshot = {
  unitCost: number | null;
  standardSalePrice: number | null;
  branchCost: number | null;
  branchPrice: number | null;
};

/**
 * Resuelve el precio siguiente según la política del lote — función pura,
 * sin acceso a datos, para que el preview (solo lectura) y la aplicación
 * real (applyProductionCostsTx) calculen exactamente lo mismo sin duplicar
 * la lógica de política.
 *   RECALC_TARGET_MARGIN → costo / (1 − margen), redondeado hacia arriba.
 *   KEEP_CURRENT          → conserva el precio actual, solo actualiza costo.
 *   APPROVAL_IF_DELTA     → si el precio recalculado se desvía más de X% del
 *                           actual, no se aplica hasta aprobación explícita
 *                           (priceOverrideReason) — el lote queda marcado.
 */
export function resolveProductionPricing(input: {
  pricePolicy: string;
  unitCost: Prisma.Decimal;
  currentPrice: Prisma.Decimal | null;
  targetMarginPct: Prisma.Decimal | null;
  roundingMultiple: Prisma.Decimal;
  priceApprovalDeltaPct: Prisma.Decimal;
  priceOverrideReason?: string | null;
}): { nextPrice: Prisma.Decimal; priceApprovalRequired: boolean } {
  if (input.pricePolicy === "KEEP_CURRENT") {
    return { nextPrice: input.currentPrice ?? input.unitCost, priceApprovalRequired: false };
  }

  const recalculated = input.targetMarginPct != null
    ? calculateTargetMarginPrice(input.unitCost, input.targetMarginPct, input.roundingMultiple)
    : input.unitCost;

  if (input.pricePolicy === "APPROVAL_IF_DELTA" && input.currentPrice != null && input.currentPrice.gt(0)) {
    const deltaPct = recalculated.sub(input.currentPrice).abs().div(input.currentPrice);
    if (deltaPct.gt(input.priceApprovalDeltaPct) && !input.priceOverrideReason?.trim()) {
      return { nextPrice: input.currentPrice, priceApprovalRequired: true };
    }
  }

  return { nextPrice: recalculated, priceApprovalRequired: false };
}

/**
 * Escribe SIEMPRE los destinos del costo/precio del producto terminado — el
 * costo (WAC vía el movimiento, y branchCost) se actualiza incondicionalmente;
 * el precio (standardSalePrice/branchPrice) solo si la política lo permite.
 * Este es el corazón del fix de Fase 3: antes, completeBatch calculaba
 * costs.unitCost y solo emitía advertencias — Product.standardSalePrice y
 * BranchProductSetting.branchCost/branchPrice nunca se tocaban.
 */
export async function applyProductionCostsTx(
  tx: Prisma.TransactionClient,
  input: {
    actorUserId?: string;
    branchId: string;
    finishedProductId: string;
    unitCostSaleUnit: Prisma.Decimal;
    pricePolicy: string;
    targetMarginPct: Prisma.Decimal | null;
    roundingMultiple: Prisma.Decimal;
    priceApprovalDeltaPct: Prisma.Decimal;
    priceOverrideReason?: string | null;
  },
): Promise<{ before: ProductionCostInjectionSnapshot; after: ProductionCostInjectionSnapshot; priceApprovalRequired: boolean }> {
  const [productBefore, branchSettingBefore] = await Promise.all([
    tx.product.findUnique({ where: { id: input.finishedProductId }, select: { standardSalePrice: true } }),
    tx.branchProductSetting.findUnique({
      where: { branchId_productId: { branchId: input.branchId, productId: input.finishedProductId } },
      select: { branchCost: true, branchPrice: true },
    }),
  ]);

  const before: ProductionCostInjectionSnapshot = {
    unitCost: branchSettingBefore?.branchCost?.toNumber() ?? null,
    standardSalePrice: productBefore?.standardSalePrice?.toNumber() ?? null,
    branchCost: branchSettingBefore?.branchCost?.toNumber() ?? null,
    branchPrice: branchSettingBefore?.branchPrice?.toNumber() ?? null,
  };

  const currentPrice = branchSettingBefore?.branchPrice ?? productBefore?.standardSalePrice ?? null;
  const { nextPrice, priceApprovalRequired } = resolveProductionPricing({
    pricePolicy: input.pricePolicy,
    unitCost: input.unitCostSaleUnit,
    currentPrice,
    targetMarginPct: input.targetMarginPct,
    roundingMultiple: input.roundingMultiple,
    priceApprovalDeltaPct: input.priceApprovalDeltaPct,
    priceOverrideReason: input.priceOverrideReason,
  });

  if (!priceApprovalRequired) {
    await tx.product.update({
      where: { id: input.finishedProductId },
      data: { standardSalePrice: nextPrice },
    });
  }

  // "revisa todo... para evitar bugs" — si el producto terminado es un
  // miembro DERIVADO de una fusión, escribir branchCost en su propia fila
  // quedaba ignorado (resolveEffectivePricing solo lee la del canónico)
  // — dato fantasma. El precio SÍ se queda siempre en finishedProductId
  // (los precios de venta por presentación son individuales).
  const finishedConversion = await getProductStockConversion(tx, input.finishedProductId);
  const costTarget = resolveGlobalCostWriteTarget({
    requestedProductId: input.finishedProductId,
    enteredCost: input.unitCostSaleUnit.toNumber(),
    conversion: finishedConversion,
  });
  const branchCostForTarget = new Prisma.Decimal(costTarget.costForTarget);

  await tx.branchProductSetting.upsert({
    where: { branchId_productId: { branchId: input.branchId, productId: input.finishedProductId } },
    create: {
      branchId: input.branchId,
      productId: input.finishedProductId,
      branchPrice: nextPrice,
      priceSource: "PRODUCTION_BATCH",
      lastPriceUpdateAt: new Date(),
      priceUpdatedByUserId: input.actorUserId,
      ...(costTarget.redirected ? {} : { branchCost: branchCostForTarget }),
    },
    update: priceApprovalRequired
      ? (costTarget.redirected ? {} : { branchCost: branchCostForTarget })
      : {
          priceSource: "PRODUCTION_BATCH",
          lastPriceUpdateAt: new Date(),
          priceUpdatedByUserId: input.actorUserId,
          branchPrice: nextPrice,
          ...(costTarget.redirected ? {} : { branchCost: branchCostForTarget }),
        },
  });
  if (costTarget.redirected) {
    await tx.branchProductSetting.upsert({
      where: { branchId_productId: { branchId: input.branchId, productId: costTarget.targetProductId } },
      create: { branchId: input.branchId, productId: costTarget.targetProductId, branchCost: branchCostForTarget },
      update: { branchCost: branchCostForTarget },
    });
  }

  const after: ProductionCostInjectionSnapshot = {
    unitCost: input.unitCostSaleUnit.toNumber(),
    standardSalePrice: priceApprovalRequired ? before.standardSalePrice : nextPrice.toNumber(),
    branchCost: input.unitCostSaleUnit.toNumber(),
    branchPrice: priceApprovalRequired ? before.branchPrice : nextPrice.toNumber(),
  };

  await tx.auditLog.create({
    data: {
      actorUserId: input.actorUserId,
      branchId: input.branchId,
      module: "production",
      action: "PRODUCTION_COST_INJECTED",
      entityType: "Product",
      entityId: input.finishedProductId,
      metadataJson: { before, after, pricePolicy: input.pricePolicy, priceApprovalRequired } as unknown as Prisma.InputJsonValue,
    },
  });

  return { before, after, priceApprovalRequired };
}

export type ProductionInjectionPreview = {
  batchId: string;
  batchNumber: string;
  pricePolicy: string;
  lines: Array<{
    inputProductId: string;
    productName: string;
    productSku: string;
    neededQuantity: number;
    unit: string;
    wacSaleUnit: number;
    stockSaleUnit: number;
    lineCost: number;
    hasEnoughStock: boolean;
  }>;
  materialsCost: number;
  laborCost: number;
  overheadCost: number;
  totalCost: number;
  unitCost: number;
  standardMaterialsCost: number;
  standardUnitCost: number;
  variancePct: number | null;
  yieldPct: number | null;
  warnings: string[];
  inject: { before: ProductionCostInjectionSnapshot; after: ProductionCostInjectionSnapshot; priceApprovalRequired: boolean };
  hash: string;
};

/**
 * Preview de inyección (Producción v2 Fase 3) — costo/precio proyectados
 * ANTES→DESPUÉS del producto terminado, SIN escribir nada. completeBatch
 * exige el hash de un preview fresco para aplicar: si el WAC de algún
 * insumo cambió entre medias (otra venta, otro lote), el hash no coincide y
 * el cierre se rechaza en vez de inyectar un costo obsoleto.
 */
export async function buildProductionInjectionPreview(
  db: DbClient,
  params: { batchId: string; producedGoodQuantity: number; producedBadQuantity: number },
): Promise<ProductionInjectionPreview> {
  const batch = await db.productionBatch.findUnique({
    where: { id: params.batchId },
    include: {
      recipe: { include: { finishedProduct: true, inputs: { include: { inputProduct: true } } } },
    },
  });
  if (!batch) throw new Error("BATCH_NOT_FOUND");

  // WAC/stock actual de cada insumo, sin escalar (multiplicador=1) — el
  // núcleo puro computeBatchCostSummary aplica los multiplicadores
  // real/estándar sobre esta misma lectura, una sola vez.
  const resolved = await computeStandardMaterialsLinesTx(db, {
    branchId: batch.branchId,
    multiplier: new Prisma.Decimal(1),
    recipeInputs: batch.recipe.inputs,
    excludeBatchId: batch.id,
  });

  const laborCostValue = batch.recipe.laborEnabled && batch.recipe.laborCostPerBatch != null
    ? batch.recipe.laborCostPerBatch
    : new Prisma.Decimal(0);

  const summary = computeBatchCostSummary({
    recipeExpectedQuantity: batch.recipe.expectedQuantity,
    plannedQuantity: batch.plannedQuantity,
    producedGoodQuantity: params.producedGoodQuantity,
    producedBadQuantity: params.producedBadQuantity,
    inputLines: resolved.lines.map((l) => ({ quantity: l.recipeQtyPerBatch, wacSaleUnit: l.wacSaleUnit })),
    laborCost: laborCostValue,
    overheadMode: batch.recipe.overheadMode,
    overheadValue: batch.recipe.processingCostPerBatch,
    targetMarginPct: batch.recipe.targetMarginPct,
  });

  const totalAttempted = params.producedGoodQuantity + params.producedBadQuantity;
  const realMultiplier = new Prisma.Decimal(batch.recipe.expectedQuantity).gt(0)
    ? new Prisma.Decimal(totalAttempted).div(batch.recipe.expectedQuantity)
    : new Prisma.Decimal(0);

  const lines = resolved.lines.map((l) => {
    const neededQuantity = new Prisma.Decimal(l.recipeQtyPerBatch).mul(realMultiplier);
    return {
      inputProductId: l.inputProductId,
      productName: l.productName,
      productSku: l.productSku,
      neededQuantity: neededQuantity.toNumber(),
      unit: l.unit,
      wacSaleUnit: l.wacSaleUnit.toNumber(),
      stockSaleUnit: l.stockSaleUnit.toNumber(),
      lineCost: neededQuantity.mul(l.wacSaleUnit).toNumber(),
      hasEnoughStock: l.stockSaleUnit.gte(neededQuantity),
    };
  });

  const warnings: string[] = [];
  for (const line of lines) {
    if (!line.hasEnoughStock) {
      warnings.push(`Stock insuficiente de ${line.productSku} para el consumo estándar (${line.neededQuantity.toFixed(2)} ${line.unit}).`);
    }
  }

  const pricingConfig = await getProductionPricingConfig();
  const [productBefore, branchSettingBefore] = await Promise.all([
    db.product.findUnique({ where: { id: batch.recipe.finishedProductId }, select: { standardSalePrice: true } }),
    db.branchProductSetting.findUnique({
      where: { branchId_productId: { branchId: batch.branchId, productId: batch.recipe.finishedProductId } },
      select: { branchCost: true, branchPrice: true },
    }),
  ]);
  const before: ProductionCostInjectionSnapshot = {
    unitCost: branchSettingBefore?.branchCost?.toNumber() ?? null,
    standardSalePrice: productBefore?.standardSalePrice?.toNumber() ?? null,
    branchCost: branchSettingBefore?.branchCost?.toNumber() ?? null,
    branchPrice: branchSettingBefore?.branchPrice?.toNumber() ?? null,
  };
  const currentPrice = branchSettingBefore?.branchPrice ?? productBefore?.standardSalePrice ?? null;
  const { nextPrice, priceApprovalRequired } = resolveProductionPricing({
    pricePolicy: batch.pricePolicy,
    unitCost: summary.unitCost,
    currentPrice,
    targetMarginPct: batch.recipe.targetMarginPct,
    roundingMultiple: pricingConfig.priceRoundingMultiple,
    priceApprovalDeltaPct: pricingConfig.priceApprovalDeltaPct,
  });
  const after: ProductionCostInjectionSnapshot = {
    unitCost: summary.unitCost.toNumber(),
    standardSalePrice: priceApprovalRequired ? before.standardSalePrice : nextPrice.toNumber(),
    branchCost: summary.unitCost.toNumber(),
    branchPrice: priceApprovalRequired ? before.branchPrice : nextPrice.toNumber(),
  };

  const hashPayload = {
    lines,
    materialsCost: summary.materialsCost.toNumber(),
    laborCost: summary.laborCost.toNumber(),
    overheadCost: summary.overheadCost.toNumber(),
    unitCost: summary.unitCost.toNumber(),
    before,
    after,
    producedGoodQuantity: params.producedGoodQuantity,
    producedBadQuantity: params.producedBadQuantity,
  };
  const hash = createHash("sha256").update(JSON.stringify(hashPayload)).digest("hex");

  return {
    batchId: batch.id,
    batchNumber: batch.batchNumber,
    pricePolicy: batch.pricePolicy,
    lines,
    materialsCost: summary.materialsCost.toNumber(),
    laborCost: summary.laborCost.toNumber(),
    overheadCost: summary.overheadCost.toNumber(),
    totalCost: summary.totalCost.toNumber(),
    unitCost: summary.unitCost.toNumber(),
    standardMaterialsCost: summary.standardMaterialsCost.toNumber(),
    standardUnitCost: summary.standardUnitCost.toNumber(),
    variancePct: summary.variancePct?.toNumber() ?? null,
    yieldPct: summary.yieldPct?.toNumber() ?? null,
    warnings,
    inject: { before, after, priceApprovalRequired },
    hash,
  };
}

export async function getBatchInjectionPreview(
  batchId: string,
  input: { producedGoodQuantity: number; producedBadQuantity: number },
): Promise<ProductionInjectionPreview> {
  return buildProductionInjectionPreview(prisma, { batchId, ...input });
}

/**
 * Completa un lote de producción:
 * 1. Exige el hash de un preview de inyección fresco ("nadie inyecta sin ver").
 * 2. Consume estándar de cada insumo (receta × multiplicador, al WAC del
 *    sistema — nunca un costo/cantidad enviado por el cliente).
 * 3. Libera la reserva del lote (se convierte en consumo real).
 * 4. Crea PRODUCTION_OUTPUT e inyecta costo/precio SIEMPRE (Fase 3).
 * 5. Congela costo estándar vs real para la variancia (Fase 5).
 */
export async function completeBatch(
  id: string,
  input: CompleteBatchInput & { actorUserId: string },
) {
  const batch = await prisma.productionBatch.findUnique({
    where: { id },
    include: { recipe: { include: { finishedProduct: true, inputs: true } }, inputs: true },
  });
  if (!batch) throw new Error("BATCH_NOT_FOUND");
  if (batch.status !== "IN_PROGRESS" && batch.status !== "DRAFT" && batch.status !== "PLANNED") {
    throw new Error("INVALID_TRANSITION");
  }

  const preview = await buildProductionInjectionPreview(prisma, {
    batchId: id,
    producedGoodQuantity: input.producedGoodQuantity,
    producedBadQuantity: input.producedBadQuantity,
  });

  if (preview.hash !== input.expectedHash) {
    throw new Error("INJECTION_PREVIEW_STALE");
  }
  // Auditoría 2026-07-22 (ALTO Producción): con producedGoodQuantity=0
  // (pérdida total) el costo unitario es 0 a propósito (no hay unidad buena
  // a la que repartirle costo) — eso es válido. Solo es inválido reclamar
  // unidades buenas (>0) a costo cero (WAC de algún insumo es 0).
  if (input.producedGoodQuantity > 0 && preview.unitCost <= 0) {
    throw new Error("INVALID_INPUT: El costo unitario producido debe ser mayor a 0.");
  }

  const pricingConfig = await getProductionPricingConfig();

  const result = await prisma.$transaction(async (tx) => {
    const warnings = [...preview.warnings];
    let inputsConsumed = 0;

    for (const line of preview.lines) {
      const existingInput = batch.inputs.find((bi) => bi.inputProductId === line.inputProductId);
      if (existingInput) {
        await tx.productionBatchInput.update({
          where: { id: existingInput.id },
          data: {
            actualQuantity: line.neededQuantity,
            unitCost: line.wacSaleUnit,
            totalCost: line.lineCost,
          },
        });
      }
      if (line.neededQuantity > 0) {
        await createInventoryMovementTx(tx, {
          actorUserId: input.actorUserId,
          branchId: batch.branchId,
          productId: line.inputProductId,
          movementType: "PRODUCTION_CONSUME",
          quantity: line.neededQuantity,
          unitCost: line.wacSaleUnit,
          referenceType: "ProductionBatch",
          referenceId: batch.id,
          notes: `Consumo estándar lote ${batch.batchNumber}`,
        });
        inputsConsumed += 1;
      }
    }

    // La reserva planificada se convierte en consumo real — se libera.
    await releaseBatchInputsTx(tx, batch.id);

    let outputsCreated = 0;
    let injection = preview.inject;
    if (input.producedGoodQuantity > 0) {
      await createInventoryMovementTx(tx, {
        actorUserId: input.actorUserId,
        branchId: batch.branchId,
        productId: batch.recipe.finishedProductId,
        movementType: "PRODUCTION_OUTPUT",
        quantity: input.producedGoodQuantity,
        unitCost: preview.unitCost,
        referenceType: "ProductionBatch",
        referenceId: batch.id,
        notes: `Producción lote ${batch.batchNumber}`,
      });
      outputsCreated += 1;

      injection = await applyProductionCostsTx(tx, {
        actorUserId: input.actorUserId,
        branchId: batch.branchId,
        finishedProductId: batch.recipe.finishedProductId,
        unitCostSaleUnit: new Prisma.Decimal(preview.unitCost),
        pricePolicy: batch.pricePolicy,
        targetMarginPct: batch.recipe.targetMarginPct,
        roundingMultiple: pricingConfig.priceRoundingMultiple,
        priceApprovalDeltaPct: pricingConfig.priceApprovalDeltaPct,
        priceOverrideReason: input.priceOverrideReason,
      });
      if (injection.priceApprovalRequired) {
        warnings.push("El precio recalculado se desvía del actual más del umbral configurado — requiere aprobación.");
      }
    } else {
      warnings.push("Lote completado con pérdida total: insumos consumidos, sin producto terminado.");
    }

    const updatedBatch = await tx.productionBatch.update({
      where: { id },
      data: {
        status: "COMPLETED",
        producedGoodQuantity: input.producedGoodQuantity,
        producedBadQuantity: input.producedBadQuantity,
        materialsCost: preview.materialsCost,
        laborCost: preview.laborCost,
        overheadCost: preview.overheadCost,
        totalCost: preview.totalCost,
        unitCost: preview.unitCost,
        suggestedPrice: injection.after.branchPrice,
        standardMaterialsCost: preview.standardMaterialsCost,
        standardUnitCost: preview.standardUnitCost,
        priceApprovalRequired: injection.priceApprovalRequired,
        laborEntries: input.laborEntries.length > 0 ? (input.laborEntries as unknown as Prisma.InputJsonValue) : Prisma.JsonNull,
        completedAt: new Date(),
        startedAt: batch.startedAt ?? new Date(),
      },
      include: {
        recipe: { include: { finishedProduct: { select: { id: true, sku: true, name: true } } } },
        branch: { select: { id: true, code: true, name: true } },
        inputs: { include: { inputProduct: { select: { id: true, sku: true, name: true } } } },
      },
    });

    return {
      ok: true,
      batchId: updatedBatch.id,
      statusAfter: updatedBatch.status,
      producedQuantity: input.producedGoodQuantity,
      totalInputCost: preview.materialsCost,
      unitCost: preview.unitCost,
      standardUnitCost: preview.standardUnitCost,
      variancePct: preview.variancePct,
      yieldPct: preview.yieldPct,
      inventoryMovements: { inputsConsumed, outputsCreated },
      injection,
      warnings,
      batch: updatedBatch,
    };
  });

  await logAuditEvent({
    actorUserId: input.actorUserId,
    module: "production",
    action: "BATCH_COMPLETE",
    entityType: "ProductionBatch",
    entityId: batch.id,
    metadataJson: {
      batchNumber: batch.batchNumber,
      producedGood: input.producedGoodQuantity,
      producedBad: input.producedBadQuantity,
      totalCost: preview.totalCost,
      unitCost: preview.unitCost,
      variancePct: preview.variancePct,
    },
  });
  if (input.producedBadQuantity > 0) {
    await logAuditEvent({
      actorUserId: input.actorUserId,
      module: "production",
      action: "BATCH_WASTE",
      entityType: "ProductionBatch",
      entityId: batch.id,
      metadataJson: { wasteQuantity: input.producedBadQuantity, batchNumber: batch.batchNumber },
    });
  }
  if (input.producedGoodQuantity <= 0) {
    await logAuditEvent({
      actorUserId: input.actorUserId,
      module: "production",
      action: "BATCH_TOTAL_LOSS",
      entityType: "ProductionBatch",
      entityId: batch.id,
      metadataJson: { batchNumber: batch.batchNumber },
    });
  }

  return result;
}

// ═══════════════════════════════════════════════════════════════════════════
// REVERSAL (Producción v2 Fase 4)
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Revierte un lote COMPLETED: devuelve los insumos consumidos al inventario
 * y retira el producto terminado, con movimientos inversos auditados. El
 * WAC se recalcula de forma consistente (createInventoryMovementTx ya hace
 * esto en cada movimiento). No afecta lotes posteriores. Si el terminado ya
 * se vendió y no hay stock para retirar, falla con un error no destructivo
 * en vez de dejar el inventario en negativo silenciosamente.
 */
/** Solo un lote COMPLETED puede revertirse — guard puro, sin acceso a datos. */
export function assertBatchReversible(status: string): void {
  if (status !== "COMPLETED") throw new Error("ONLY_COMPLETED_BATCHES_CAN_BE_REVERSED");
}

export async function reverseBatch(
  id: string,
  input: ReverseBatchInput & { actorUserId: string },
) {
  const batch = await prisma.productionBatch.findUnique({
    where: { id },
    include: { recipe: { include: { finishedProduct: true } }, inputs: true },
  });
  if (!batch) throw new Error("BATCH_NOT_FOUND");
  assertBatchReversible(batch.status);

  const result = await prisma.$transaction(async (tx) => {
    // 1. Retirar el producto terminado que se había agregado.
    if (batch.producedGoodQuantity != null && new Prisma.Decimal(batch.producedGoodQuantity).gt(0)) {
      const finishedShared = await getSharedInventoryBalance(tx, {
        branchId: batch.branchId,
        productId: batch.recipe.finishedProductId,
      });
      const availableSaleQty = finishedShared.conversion && finishedShared.balance
        ? convertBaseQtyToSaleQty({ baseQuantity: finishedShared.balance.quantityOnHand, conversionFactor: finishedShared.conversion.conversionFactor })
        : (finishedShared.balance?.quantityOnHand ?? new Prisma.Decimal(0));
      if (availableSaleQty.lt(batch.producedGoodQuantity)) {
        throw new Error("INSUFFICIENT_STOCK_TO_REVERSE: El producto terminado ya no tiene suficiente stock para revertir (fue vendido o trasladado).");
      }
      await createInventoryMovementTx(tx, {
        actorUserId: input.actorUserId,
        branchId: batch.branchId,
        productId: batch.recipe.finishedProductId,
        movementType: "PRODUCTION_REVERSAL_OUT",
        quantity: batch.producedGoodQuantity,
        unitCost: batch.unitCost ? Number(batch.unitCost) : 0,
        referenceType: "ProductionBatch",
        referenceId: batch.id,
        notes: `Reversión lote ${batch.batchNumber}: retiro de producto terminado`,
      });
    }

    // 2. Devolver los insumos consumidos.
    for (const bi of batch.inputs) {
      if (bi.actualQuantity == null || new Prisma.Decimal(bi.actualQuantity).lte(0)) continue;
      await createInventoryMovementTx(tx, {
        actorUserId: input.actorUserId,
        branchId: batch.branchId,
        productId: bi.inputProductId,
        movementType: "PRODUCTION_REVERSAL_IN",
        quantity: bi.actualQuantity,
        unitCost: bi.unitCost ? Number(bi.unitCost) : 0,
        referenceType: "ProductionBatch",
        referenceId: batch.id,
        notes: `Reversión lote ${batch.batchNumber}: devolución de insumo`,
      });
    }

    const updated = await tx.productionBatch.update({
      where: { id },
      data: {
        status: "REVERSED",
        reversedAt: new Date(),
        reversedByUserId: input.actorUserId,
        reversalReason: input.reason,
      },
      include: {
        recipe: { select: { id: true, name: true, code: true } },
        branch: { select: { id: true, code: true, name: true } },
      },
    });

    await tx.auditLog.create({
      data: {
        actorUserId: input.actorUserId,
        branchId: batch.branchId,
        module: "production",
        action: "BATCH_REVERSED",
        entityType: "ProductionBatch",
        entityId: batch.id,
        metadataJson: {
          batchNumber: batch.batchNumber,
          reason: input.reason,
          producedGoodQuantity: batch.producedGoodQuantity,
          inputsReturned: batch.inputs.length,
        } as unknown as Prisma.InputJsonValue,
      },
    });

    return updated;
  });

  return result;
}

// ═══════════════════════════════════════════════════════════════════════════
// COST CALCULATION (preview de planificación, no muta nada)
// ═══════════════════════════════════════════════════════════════════════════

export async function calculateCost(input: CalculateCostInput) {
  const recipe = await prisma.productionRecipe.findUnique({
    where: { id: input.recipeId },
    include: { inputs: { include: { inputProduct: true } } },
  });
  if (!recipe) throw new Error("INVALID_INPUT: Receta no encontrada");

  const multiplier = new Prisma.Decimal(input.plannedQuantity).div(recipe.expectedQuantity);
  const { lines, totalCost } = await computeStandardMaterialsLinesTx(prisma, {
    branchId: input.branchId,
    multiplier,
    recipeInputs: recipe.inputs,
  });
  const { laborCost, overheadCost } = computeLaborAndOverhead(recipe, totalCost);
  const grandTotalCost = totalCost.add(laborCost).add(overheadCost);
  const estimatedUnitCost = input.plannedQuantity > 0 ? grandTotalCost.div(input.plannedQuantity) : new Prisma.Decimal(0);
  const suggestedPrice = recipe.targetMarginPct != null
    ? calculateTargetMarginPrice(estimatedUnitCost, recipe.targetMarginPct, new Prisma.Decimal(1))
    : null;

  return {
    recipe: { id: recipe.id, name: recipe.name, code: recipe.code },
    plannedQuantity: input.plannedQuantity,
    multiplier: multiplier.toNumber(),
    inputs: lines.map((l) => ({
      productId: l.inputProductId,
      productName: l.productName,
      productSku: l.productSku,
      recipeQtyPerBatch: l.recipeQtyPerBatch,
      neededQuantity: l.neededQuantity.toNumber(),
      unit: l.unit,
      currentWac: l.wacSaleUnit.toNumber(),
      currentStock: l.stockSaleUnit.toNumber(),
      estimatedCost: l.lineCost.toNumber(),
      hasEnoughStock: l.hasEnoughStock,
    })),
    totalMaterialsCost: totalCost.toNumber(),
    laborCost: laborCost.toNumber(),
    overheadCost: overheadCost.toNumber(),
    estimatedUnitCost: estimatedUnitCost.toNumber(),
    allInputsAvailable: lines.every((l) => l.hasEnoughStock),
    targetMarginPct: recipe.targetMarginPct,
    suggestedPrice: suggestedPrice != null ? suggestedPrice.toNumber() : null,
  };
}
