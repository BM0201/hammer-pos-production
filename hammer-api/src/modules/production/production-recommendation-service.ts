import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { createBatch } from "@/modules/production/service";
import {
  convertBaseQtyToSaleQty,
  convertBaseUnitCostToSaleUnitCost,
  getSharedInventoryBalance,
} from "@/modules/inventory/unit-conversion";

const DEFAULT_REORDER_POINT = 0;
const DEFAULT_TARGET_STOCK = 0;

type Priority = "LOW" | "MEDIUM" | "HIGH" | "URGENT";
type RecommendationType =
  | "PRODUCE_FROM_EXCESS"
  | "PRODUCE_FROM_AVAILABLE_STOCK"
  | "BUY_INSTEAD"
  | "NOT_ENOUGH_INPUTS"
  | "REVIEW_RECIPE";

export type ProductionRecommendation = {
  id: string;
  branchId: string;
  targetProductId: string;
  targetProductName: string;
  targetSku: string;
  targetStockOnHand: number;
  targetReorderPoint?: number | null;
  targetShortageQty: number;
  recipeId: string;
  recipeName: string;
  recipeType: string;
  recipeFamily: string;
  inputSummary: Array<{
    productId: string;
    productName: string;
    sku: string;
    availableStock: number;
    requiredQtyPerBatch: number;
    excessQty: number;
    maxBatchesFromExcess: number;
    willRemainAfterProduction: number;
  }>;
  suggestedBatches: number;
  expectedOutputQty: number;
  estimatedInputCost: number | null;
  estimatedProcessingCost: number | null;
  estimatedUnitCost: number | null;
  priority: Priority;
  recommendationType: RecommendationType;
  message: string;
  warnings: string[];
  recommendedActions: string[];
};

function number(value: Prisma.Decimal | number | string | null | undefined) {
  if (value == null) return 0;
  return Number(value);
}

function round2(value: number) {
  return Math.round(value * 100) / 100;
}

function ceilPositive(value: number) {
  return Math.max(1, Math.ceil(value));
}

function priorityFor(stock: number, reorderPoint: number): Priority {
  if (reorderPoint <= 0) return "LOW";
  if (stock <= reorderPoint * 0.25) return "URGENT";
  if (stock <= reorderPoint * 0.5) return "HIGH";
  if (stock <= reorderPoint) return "MEDIUM";
  return "LOW";
}

async function getPolicy(branchId: string, productId: string) {
  const [reorderPolicy, branchSetting] = await Promise.all([
    prisma.stockReorderPolicy.findUnique({
      where: { branchId_productId: { branchId, productId } },
      select: { minQuantity: true, reorderPoint: true, targetQuantity: true, safetyStock: true, isActive: true },
    }),
    prisma.branchProductSetting.findUnique({
      where: { branchId_productId: { branchId, productId } },
      select: { minStock: true, maxStock: true, reorderPoint: true },
    }),
  ]);

  if (reorderPolicy?.isActive) {
    return {
      minStock: number(reorderPolicy.minQuantity),
      reorderPoint: number(reorderPolicy.reorderPoint),
      targetStock: number(reorderPolicy.targetQuantity) + number(reorderPolicy.safetyStock),
    };
  }

  const reorderPoint = Math.max(number(branchSetting?.reorderPoint), number(branchSetting?.minStock), DEFAULT_REORDER_POINT);
  const targetStock = Math.max(number(branchSetting?.maxStock), reorderPoint, DEFAULT_TARGET_STOCK);
  return { minStock: number(branchSetting?.minStock), reorderPoint, targetStock };
}

async function getSaleStockAndCost(branchId: string, productId: string) {
  const shared = await getSharedInventoryBalance(prisma, { branchId, productId });
  const stock = shared.balance
    ? Number(shared.conversion
        ? convertBaseQtyToSaleQty({
            baseQuantity: shared.balance.quantityOnHand,
            conversionFactor: shared.conversion.conversionFactor,
          })
        : shared.balance.quantityOnHand)
    : 0;
  const unitCost = shared.balance
    ? Number(shared.conversion
        ? convertBaseUnitCostToSaleUnitCost({
            baseUnitCost: shared.balance.weightedAverageCost,
            conversionFactor: shared.conversion.conversionFactor,
          })
        : shared.balance.weightedAverageCost)
    : 0;
  return { stock, unitCost };
}

export async function evaluateRecipeAvailability(input: { branchId: string; recipeId: string; suggestedBatches?: number }) {
  const recipe = await prisma.productionRecipe.findUnique({
    where: { id: input.recipeId },
    include: {
      finishedProduct: { select: { id: true, sku: true, name: true } },
      inputs: { include: { inputProduct: { select: { id: true, sku: true, name: true } } } },
    },
  });
  if (!recipe) throw new Error("INVALID_INPUT: Receta no encontrada");

  const batches = input.suggestedBatches ?? 1;
  const inputSummary = await Promise.all(recipe.inputs.map(async (recipeInput) => {
    const [{ stock, unitCost }, policy] = await Promise.all([
      getSaleStockAndCost(input.branchId, recipeInput.inputProductId),
      getPolicy(input.branchId, recipeInput.inputProductId),
    ]);
    const requiredQtyPerBatch = recipeInput.quantity;
    const requiredTotal = requiredQtyPerBatch * batches;
    const targetStock = Math.max(policy.targetStock, policy.reorderPoint, policy.minStock);
    const excessQty = Math.max(0, stock - targetStock);
    return {
      productId: recipeInput.inputProductId,
      productName: recipeInput.inputProduct.name,
      sku: recipeInput.inputProduct.sku,
      availableStock: round2(stock),
      requiredQtyPerBatch: round2(requiredQtyPerBatch),
      requiredTotal: round2(requiredTotal),
      unitCost: round2(unitCost),
      excessQty: round2(excessQty),
      maxBatchesFromExcess: requiredQtyPerBatch > 0 ? Math.floor(excessQty / requiredQtyPerBatch) : 0,
      maxBatchesFromAvailableStock: requiredQtyPerBatch > 0 ? Math.floor(stock / requiredQtyPerBatch) : 0,
      willRemainAfterProduction: round2(stock - requiredTotal),
      wouldDropBelowReorderPoint: stock - requiredTotal < policy.reorderPoint,
    };
  }));

  const estimatedInputCost = inputSummary.reduce((sum, row) => sum + row.requiredTotal * row.unitCost, 0);
  return {
    recipe,
    inputSummary,
    estimatedInputCost: round2(estimatedInputCost),
    allInputsAvailable: inputSummary.every((row) => row.maxBatchesFromAvailableStock >= batches),
    allInputsFromExcess: inputSummary.every((row) => row.maxBatchesFromExcess >= batches),
  };
}

export async function findProductionOpportunitiesForProduct(input: { branchId: string; productId: string }): Promise<ProductionRecommendation[]> {
  const [targetProduct, targetPolicy, targetStock] = await Promise.all([
    prisma.product.findUnique({
      where: { id: input.productId },
      select: { id: true, sku: true, name: true },
    }),
    getPolicy(input.branchId, input.productId),
    getSaleStockAndCost(input.branchId, input.productId),
  ]);
  if (!targetProduct) return [];

  const threshold = Math.max(targetPolicy.reorderPoint, targetPolicy.minStock);
  if (threshold > 0 && targetStock.stock > threshold) return [];

  const targetStockLevel = Math.max(targetPolicy.targetStock, targetPolicy.reorderPoint, targetPolicy.minStock);
  const shortageQty = Math.max(0, targetStockLevel - targetStock.stock);
  if (shortageQty <= 0) return [];

  const recipes = await prisma.productionRecipe.findMany({
    where: { isActive: true, finishedProductId: input.productId },
    include: {
      finishedProduct: { select: { id: true, sku: true, name: true } },
      inputs: { include: { inputProduct: { select: { id: true, sku: true, name: true } } } },
    },
    orderBy: [{ recipeFamily: "asc" }, { name: "asc" }],
    take: 20,
  });

  const recommendations: ProductionRecommendation[] = [];

  for (const recipe of recipes) {
    const warnings: string[] = [];
    if (recipe.inputs.length === 0 || recipe.expectedQuantity <= 0) {
      recommendations.push({
        id: `${input.branchId}:${input.productId}:${recipe.id}`,
        branchId: input.branchId,
        targetProductId: targetProduct.id,
        targetProductName: targetProduct.name,
        targetSku: targetProduct.sku,
        targetStockOnHand: round2(targetStock.stock),
        targetReorderPoint: targetPolicy.reorderPoint,
        targetShortageQty: round2(shortageQty),
        recipeId: recipe.id,
        recipeName: recipe.name,
        recipeType: recipe.recipeType,
        recipeFamily: recipe.recipeFamily,
        inputSummary: [],
        suggestedBatches: 0,
        expectedOutputQty: 0,
        estimatedInputCost: null,
        estimatedProcessingCost: null,
        estimatedUnitCost: null,
        priority: "HIGH",
        recommendationType: "REVIEW_RECIPE",
        message: `Revisar receta ${recipe.code}: no tiene insumos o rendimiento valido.`,
        warnings: ["Receta incompleta."],
        recommendedActions: ["REVIEW_RECIPE"],
      });
      continue;
    }

    const neededBatches = ceilPositive(shortageQty / recipe.expectedQuantity);
    const availability = await evaluateRecipeAvailability({
      branchId: input.branchId,
      recipeId: recipe.id,
      suggestedBatches: neededBatches,
    });
    const minFromExcess = Math.min(...availability.inputSummary.map((row) => row.maxBatchesFromExcess));
    const minFromStock = Math.min(...availability.inputSummary.map((row) => row.maxBatchesFromAvailableStock));
    const suggestedFromExcess = Math.min(neededBatches, Math.max(0, minFromExcess));
    const suggestedFromStock = Math.min(neededBatches, Math.max(0, minFromStock));
    const recommendedBatches = suggestedFromExcess > 0 ? suggestedFromExcess : suggestedFromStock;
    const expectedOutputQty = recommendedBatches * recipe.expectedQuantity;

    let recommendationType: RecommendationType = "NOT_ENOUGH_INPUTS";
    if (recommendedBatches <= 0) recommendationType = "NOT_ENOUGH_INPUTS";
    else if (suggestedFromExcess > 0) recommendationType = "PRODUCE_FROM_EXCESS";
    else recommendationType = "PRODUCE_FROM_AVAILABLE_STOCK";

    if (availability.inputSummary.some((row) => row.wouldDropBelowReorderPoint)) {
      warnings.push("Consumir todos los insumos sugeridos podria dejar un producto origen bajo reorden.");
    }
    if (availability.inputSummary.some((row) => row.unitCost <= 0)) {
      warnings.push("Uno o mas insumos no tienen costo efectivo.");
    }

    const processingCost = number(recipe.processingCostPerBatch) + number(recipe.laborCostPerBatch);
    const scaledInputCost = neededBatches > 0 && recommendedBatches > 0
      ? availability.estimatedInputCost * (recommendedBatches / neededBatches)
      : null;
    const estimatedProcessingCost = recommendedBatches > 0 ? processingCost * recommendedBatches : null;
    const estimatedTotal = scaledInputCost == null ? null : scaledInputCost + (estimatedProcessingCost ?? 0);
    const estimatedUnitCost = estimatedTotal != null && expectedOutputQty > 0 ? estimatedTotal / expectedOutputQty : null;

    recommendations.push({
      id: `${input.branchId}:${input.productId}:${recipe.id}`,
      branchId: input.branchId,
      targetProductId: targetProduct.id,
      targetProductName: targetProduct.name,
      targetSku: targetProduct.sku,
      targetStockOnHand: round2(targetStock.stock),
      targetReorderPoint: targetPolicy.reorderPoint,
      targetShortageQty: round2(shortageQty),
      recipeId: recipe.id,
      recipeName: recipe.name,
      recipeType: recipe.recipeType,
      recipeFamily: recipe.recipeFamily,
      inputSummary: availability.inputSummary.map((row) => ({
        productId: row.productId,
        productName: row.productName,
        sku: row.sku,
        availableStock: row.availableStock,
        requiredQtyPerBatch: row.requiredQtyPerBatch,
        excessQty: row.excessQty,
        maxBatchesFromExcess: row.maxBatchesFromExcess,
        willRemainAfterProduction: recommendedBatches > 0
          ? round2(row.availableStock - row.requiredQtyPerBatch * recommendedBatches)
          : row.availableStock,
      })),
      suggestedBatches: recommendedBatches,
      expectedOutputQty: round2(expectedOutputQty),
      estimatedInputCost: scaledInputCost == null ? null : round2(scaledInputCost),
      estimatedProcessingCost: estimatedProcessingCost == null ? null : round2(estimatedProcessingCost),
      estimatedUnitCost: estimatedUnitCost == null ? null : round2(estimatedUnitCost),
      priority: priorityFor(targetStock.stock, targetPolicy.reorderPoint),
      recommendationType,
      message: recommendationType === "PRODUCE_FROM_EXCESS"
        ? `Producir ${round2(expectedOutputQty)} de ${targetProduct.name} usando excedente disponible.`
        : recommendationType === "PRODUCE_FROM_AVAILABLE_STOCK"
          ? `Producir ${round2(expectedOutputQty)} de ${targetProduct.name}; revisar impacto en insumos.`
          : `Comprar o abastecer insumos antes de producir ${targetProduct.name}.`,
      warnings,
      recommendedActions: recommendationType === "NOT_ENOUGH_INPUTS"
        ? ["BUY_INPUTS", "REVIEW_REORDER_POLICY"]
        : ["CREATE_PRODUCTION_BATCH", "REVIEW_REORDER_POLICY"],
    });
  }

  return recommendations;
}

export async function getProductionRecommendationsForBranch(input: { branchId: string }) {
  const policies = await prisma.stockReorderPolicy.findMany({
    where: { branchId: input.branchId, isActive: true },
    select: { productId: true },
    take: 500,
  });
  const settings = await prisma.branchProductSetting.findMany({
    where: {
      branchId: input.branchId,
      OR: [{ reorderPoint: { not: null } }, { minStock: { not: null } }],
    },
    select: { productId: true },
    take: 500,
  });
  const productIds = [...new Set([...policies.map((row) => row.productId), ...settings.map((row) => row.productId)])];

  const recommendations = (await Promise.all(
    productIds.map((productId) => findProductionOpportunitiesForProduct({ branchId: input.branchId, productId })),
  )).flat().sort((a, b) => {
    const rank: Record<Priority, number> = { URGENT: 4, HIGH: 3, MEDIUM: 2, LOW: 1 };
    return rank[b.priority] - rank[a.priority];
  });

  return {
    recommendations,
    summary: {
      total: recommendations.length,
      urgent: recommendations.filter((item) => item.priority === "URGENT").length,
      producibleFromExcess: recommendations.filter((item) => item.recommendationType === "PRODUCE_FROM_EXCESS").length,
      blockedByInputs: recommendations.filter((item) => item.recommendationType === "NOT_ENOUGH_INPUTS").length,
      estimatedSavings: null,
    },
  };
}

export async function createProductionDraftFromRecommendation(input: {
  branchId: string;
  recipeId: string;
  suggestedBatches: number;
  targetProductId: string;
  notes?: string | null;
  actorUserId: string;
}) {
  if (input.suggestedBatches <= 0) throw new Error("INVALID_INPUT: suggestedBatches debe ser mayor a 0");
  const recipe = await prisma.productionRecipe.findUnique({
    where: { id: input.recipeId },
    select: { id: true, finishedProductId: true, expectedQuantity: true, name: true, code: true },
  });
  if (!recipe) throw new Error("INVALID_INPUT: Receta no encontrada");
  if (recipe.finishedProductId !== input.targetProductId) {
    throw new Error("INVALID_INPUT: La receta no produce el producto objetivo.");
  }

  return createBatch({
    recipeId: input.recipeId,
    branchId: input.branchId,
    plannedQuantity: recipe.expectedQuantity * input.suggestedBatches,
    notes: input.notes ?? `Lote sugerido por recomendacion de produccion (${recipe.code}).`,
    actorUserId: input.actorUserId,
  });
}
