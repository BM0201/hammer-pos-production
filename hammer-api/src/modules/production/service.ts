import { Prisma, ProductionBatchStatus } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { logAuditEvent } from "@/modules/audit/service";
import { createInventoryMovementTx } from "@/modules/inventory/service";
import {
  convertBaseQtyToSaleQty,
  convertBaseUnitCostToSaleUnitCost,
  getSharedInventoryBalance,
} from "@/modules/inventory/unit-conversion";
import { calculateBatchCosts, estimateMaterialCost } from "./calculations";
import type {
  CreateRecipeInput,
  UpdateRecipeInput,
  CreateBatchInput,
  UpdateBatchInput,
  CompleteBatchInput,
  CalculateCostInput,
} from "./validators";

// ═══════════════════════════════════════════════════════════════════════════
// RECIPES
// ═══════════════════════════════════════════════════════════════════════════

export async function getRecipes(params: { isActive?: boolean; q?: string; recipeType?: string; recipeFamily?: string }) {
  const where: Prisma.ProductionRecipeWhereInput = {};
  if (params.isActive !== undefined) where.isActive = params.isActive;
  if (params.recipeType) where.recipeType = params.recipeType;
  if (params.recipeFamily) where.recipeFamily = params.recipeFamily;
  if (params.q) {
    where.OR = [
      { name: { contains: params.q, mode: "insensitive" } },
      { code: { contains: params.q, mode: "insensitive" } },
    ];
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
          createdAt: true,
        },
      },
    },
  });
  if (!recipe) throw new Error("RECIPE_NOT_FOUND");
  return recipe;
}

export async function createRecipe(input: CreateRecipeInput & { actorUserId: string }) {
  // Validate finished product exists
  const product = await prisma.product.findUnique({ where: { id: input.finishedProductId } });
  if (!product) throw new Error("INVALID_INPUT: Producto terminado no encontrado");

  // Validate all input products exist
  const inputProductIds = input.inputs.map((i) => i.inputProductId);
  const inputProducts = await prisma.product.findMany({
    where: { id: { in: inputProductIds } },
    select: { id: true },
  });
  if (inputProducts.length !== inputProductIds.length) {
    throw new Error("INVALID_INPUT: Uno o más productos de insumo no existen");
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
      processingCostPerBatch: input.processingCostPerBatch ?? null,
      laborCostPerBatch: input.laborCostPerBatch ?? null,
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

  const recipe = await prisma.$transaction(async (tx) => {
    // If inputs are being replaced, delete old ones and create new
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
        processingCostPerBatch: input.processingCostPerBatch,
        laborCostPerBatch: input.laborCostPerBatch,
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
  // Validate recipe exists and is active
  const recipe = await prisma.productionRecipe.findUnique({
    where: { id: input.recipeId },
    include: { inputs: true },
  });
  if (!recipe) throw new Error("INVALID_INPUT: Receta no encontrada");
  if (!recipe.isActive) throw new Error("INVALID_INPUT: Receta inactiva");

  // Validate branch exists
  const branch = await prisma.branch.findUnique({ where: { id: input.branchId } });
  if (!branch) throw new Error("INVALID_INPUT: Sucursal no encontrada");

  const batchNumber = await generateBatchNumber();

  // Calculate planned inputs proportionally from recipe
  const multiplier = input.plannedQuantity / recipe.expectedQuantity;

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
          plannedQuantity: Math.round(ri.quantity * multiplier * 100) / 100,
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

  // Only allow updates on DRAFT or PLANNED batches (status changes are an exception)
  if (existing.status === "COMPLETED" || existing.status === "CANCELLED") {
    throw new Error("INVALID_TRANSITION");
  }

  // Validate status transitions
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

  const updateData: Prisma.ProductionBatchUpdateInput = {};
  if (input.plannedQuantity !== undefined) updateData.plannedQuantity = input.plannedQuantity;
  if (input.notes !== undefined) updateData.notes = input.notes;
  if (input.laborCost !== undefined) updateData.laborCost = input.laborCost;
  if (input.overheadCost !== undefined) updateData.overheadCost = input.overheadCost;

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
    metadataJson: { status: batch.status },
  });

  return batch;
}

/**
 * Complete a production batch:
 * 1. Update batch quantities & costs
 * 2. Create PRODUCTION_CONSUME movements (deduct inputs from inventory)
 * 3. Create PRODUCTION_OUTPUT movement (add finished product to inventory)
 * 4. If waste > 0, create PRODUCTION_WASTE movement
 * 5. Calculate final costs and suggested price
 */
export async function completeBatch(
  id: string,
  input: CompleteBatchInput & { actorUserId: string },
) {
  const batch = await prisma.productionBatch.findUnique({
    where: { id },
    include: {
      recipe: {
        include: {
          finishedProduct: true,
          inputs: true,
        },
      },
      inputs: true,
    },
  });

  if (!batch) throw new Error("BATCH_NOT_FOUND");
  if (batch.status !== "IN_PROGRESS" && batch.status !== "DRAFT" && batch.status !== "PLANNED") {
    throw new Error("INVALID_TRANSITION");
  }
  if (input.inputs.length !== batch.inputs.length) {
    throw new Error("INVALID_INPUT: Debes confirmar todos los insumos del lote.");
  }
  for (const batchInput of input.inputs) {
    const existingInput = batch.inputs.find((bi) => bi.inputProductId === batchInput.inputProductId);
    if (!existingInput) throw new Error("INVALID_INPUT: Insumo no pertenece al lote.");
  }

  // Calculate costs
  const costInputs = input.inputs.map((i) => ({
    actualQuantity: i.actualQuantity,
    unitCost: i.unitCost,
  }));

  const costs = calculateBatchCosts({
    inputs: costInputs,
    laborCost: input.laborCost,
    overheadCost: input.overheadCost,
    producedGoodQuantity: input.producedGoodQuantity,
    targetMarginPct: batch.recipe.targetMarginPct,
  });
  if (costs.unitCost <= 0) {
    throw new Error("INVALID_INPUT: El costo unitario producido debe ser mayor a 0.");
  }

  const result = await prisma.$transaction(async (tx) => {
    const warnings: string[] = [];
    let inputsConsumed = 0;
    let outputsCreated = 0;

    for (const batchInput of input.inputs) {
      const shared = await getSharedInventoryBalance(tx, {
        branchId: batch.branchId,
        productId: batchInput.inputProductId,
      });
      const availableSaleQty = shared.conversion && shared.balance
        ? convertBaseQtyToSaleQty({
            baseQuantity: shared.balance.quantityOnHand,
            conversionFactor: shared.conversion.conversionFactor,
          })
        : (shared.balance?.quantityOnHand ?? new Prisma.Decimal(0));
      if (availableSaleQty.lt(batchInput.actualQuantity)) {
        throw new Error("INSUFFICIENT_STOCK");
      }
      if (batchInput.unitCost <= 0) {
        warnings.push(`Insumo ${batchInput.inputProductId} sin costo unitario real.`);
      }
    }

    // 1. Update batch input actuals
    for (const batchInput of input.inputs) {
      const existingInput = batch.inputs.find(
        (bi) => bi.inputProductId === batchInput.inputProductId,
      );
      if (existingInput) {
        await tx.productionBatchInput.update({
          where: { id: existingInput.id },
          data: {
            actualQuantity: batchInput.actualQuantity,
            unitCost: batchInput.unitCost,
            totalCost: Math.round(batchInput.actualQuantity * batchInput.unitCost * 100) / 100,
          },
        });
      }
    }

    // 2. Create PRODUCTION_CONSUME inventory movements (deduct inputs)
    for (const batchInput of input.inputs) {
      await createInventoryMovementTx(tx, {
        actorUserId: input.actorUserId,
        branchId: batch.branchId,
        productId: batchInput.inputProductId,
        movementType: "PRODUCTION_CONSUME",
        quantity: batchInput.actualQuantity,
        unitCost: batchInput.unitCost,
        referenceType: "ProductionBatch",
        referenceId: batch.id,
        notes: `Consumo lote ${batch.batchNumber}`,
      });
      inputsConsumed += 1;
    }

    // 3. Create PRODUCTION_OUTPUT movement (add finished product)
    await createInventoryMovementTx(tx, {
      actorUserId: input.actorUserId,
      branchId: batch.branchId,
      productId: batch.recipe.finishedProductId,
      movementType: "PRODUCTION_OUTPUT",
      quantity: input.producedGoodQuantity,
      unitCost: costs.unitCost,
      referenceType: "ProductionBatch",
      referenceId: batch.id,
      notes: `Producción lote ${batch.batchNumber}`,
    });

    outputsCreated += 1;

    const finishedPricing = await tx.product.findUnique({
      where: { id: batch.recipe.finishedProductId },
      select: {
        standardSalePrice: true,
        branchProductSettings: {
          where: { branchId: batch.branchId },
          select: { branchPrice: true },
          take: 1,
        },
      },
    });
    const effectivePrice = Number(
      finishedPricing?.branchProductSettings[0]?.branchPrice ?? finishedPricing?.standardSalePrice ?? 0,
    );
    const finishedShared = await getSharedInventoryBalance(tx, {
      branchId: batch.branchId,
      productId: batch.recipe.finishedProductId,
    });
    const producedSaleUnitCost = finishedShared.conversion
      ? Number(convertBaseUnitCostToSaleUnitCost({
          baseUnitCost: costs.unitCost,
          conversionFactor: finishedShared.conversion.conversionFactor,
        }))
      : costs.unitCost;
    if (effectivePrice <= 0) {
      warnings.push("Producto terminado sin precio efectivo.");
    } else if (effectivePrice < producedSaleUnitCost) {
      warnings.push("Precio actual por debajo del costo producido; revisar precio.");
    } else if (batch.recipe.targetMarginPct != null && batch.recipe.targetMarginPct > 0) {
      const margin = (effectivePrice - producedSaleUnitCost) / effectivePrice;
      if (margin < batch.recipe.targetMarginPct) {
        warnings.push("Margen estimado por debajo del margen objetivo de la receta.");
      }
    }

    // 4. If there's waste, log it (no inventory impact, just audit)
    if (input.producedBadQuantity > 0) {
      await logAuditEvent({
        actorUserId: input.actorUserId,
        module: "production",
        action: "BATCH_WASTE",
        entityType: "ProductionBatch",
        entityId: batch.id,
        metadataJson: {
          wasteQuantity: input.producedBadQuantity,
          batchNumber: batch.batchNumber,
        },
      });
    }

    // 5. Update the batch record with final data
    const updatedBatch = await tx.productionBatch.update({
      where: { id },
      data: {
        status: "COMPLETED",
        producedGoodQuantity: input.producedGoodQuantity,
        producedBadQuantity: input.producedBadQuantity,
        materialsCost: costs.materialsCost,
        laborCost: costs.laborCost,
        overheadCost: costs.overheadCost,
        totalCost: costs.totalCost,
        unitCost: costs.unitCost,
        suggestedPrice: costs.suggestedPrice,
        completedAt: new Date(),
        startedAt: batch.startedAt ?? new Date(),
      },
      include: {
        recipe: {
          include: {
            finishedProduct: { select: { id: true, sku: true, name: true } },
          },
        },
        branch: { select: { id: true, code: true, name: true } },
        inputs: {
          include: {
            inputProduct: { select: { id: true, sku: true, name: true } },
          },
        },
      },
    });

    return {
      ok: true,
      batchId: updatedBatch.id,
      statusAfter: updatedBatch.status,
      producedQuantity: input.producedGoodQuantity,
      totalInputCost: costs.materialsCost,
      unitCost: costs.unitCost,
      inventoryMovements: {
        inputsConsumed,
        outputsCreated,
      },
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
      totalCost: costs.totalCost,
      unitCost: costs.unitCost,
    },
  });

  return result;
}

// ═══════════════════════════════════════════════════════════════════════════
// COST CALCULATION (preview, no DB mutation)
// ═══════════════════════════════════════════════════════════════════════════

export async function calculateCost(input: CalculateCostInput) {
  const recipe = await prisma.productionRecipe.findUnique({
    where: { id: input.recipeId },
    include: { inputs: { include: { inputProduct: true } } },
  });
  if (!recipe) throw new Error("INVALID_INPUT: Receta no encontrada");

  const multiplier = input.plannedQuantity / recipe.expectedQuantity;

  // Get current WAC for each input from the target branch
  const inputCosts = await Promise.all(
    recipe.inputs.map(async (ri) => {
      const shared = await getSharedInventoryBalance(prisma, {
        branchId: input.branchId,
        productId: ri.inputProductId,
      });
      const wac = shared.balance
        ? Number(shared.conversion
            ? convertBaseUnitCostToSaleUnitCost({
                baseUnitCost: shared.balance.weightedAverageCost,
                conversionFactor: shared.conversion.conversionFactor,
              })
            : shared.balance.weightedAverageCost)
        : 0;
      const stock = shared.balance
        ? Number(shared.conversion
            ? convertBaseQtyToSaleQty({
                baseQuantity: shared.balance.quantityOnHand,
                conversionFactor: shared.conversion.conversionFactor,
              })
            : shared.balance.quantityOnHand)
        : 0;
      const neededQty = Math.round(ri.quantity * multiplier * 100) / 100;

      return {
        productId: ri.inputProductId,
        productName: ri.inputProduct.name,
        productSku: ri.inputProduct.sku,
        recipeQtyPerBatch: ri.quantity,
        neededQuantity: neededQty,
        unit: ri.unit,
        currentWac: wac,
        currentStock: stock,
        stockConversion: shared.conversion
          ? {
              stockGroupId: shared.conversion.stockGroupId,
              baseUnit: shared.conversion.baseUnit,
              saleUnit: shared.conversion.saleUnit,
              conversionFactor: shared.conversion.conversionFactor.toString(),
            }
          : null,
        estimatedCost: Math.round(neededQty * wac * 100) / 100,
        hasEnoughStock: stock >= neededQty,
      };
    }),
  );

  const totalMaterialsCost = inputCosts.reduce((s, i) => s + i.estimatedCost, 0);
  const estimatedUnitCost =
    input.plannedQuantity > 0 ? Math.round((totalMaterialsCost / input.plannedQuantity) * 100) / 100 : 0;

  return {
    recipe: { id: recipe.id, name: recipe.name, code: recipe.code },
    plannedQuantity: input.plannedQuantity,
    multiplier: Math.round(multiplier * 100) / 100,
    inputs: inputCosts,
    totalMaterialsCost: Math.round(totalMaterialsCost * 100) / 100,
    estimatedUnitCost,
    allInputsAvailable: inputCosts.every((i) => i.hasEnoughStock),
    targetMarginPct: recipe.targetMarginPct,
    suggestedPrice:
      recipe.targetMarginPct != null && recipe.targetMarginPct > 0
        ? Math.round((estimatedUnitCost / (1 - recipe.targetMarginPct)) * 100) / 100
        : null,
  };
}
