import { Prisma, PrismaClient } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { createBatch } from "@/modules/production/service";
import {
  convertBaseQtyToSaleQty,
  convertBaseUnitCostToSaleUnitCost,
  getSharedInventoryBalance,
  getProductStockConversionsBatch,
} from "@/modules/inventory/unit-conversion";
import { resolveCostChain } from "@/modules/catalog/effective-pricing";
import { isWacDrivesCostChainEnabled } from "@/modules/catalog/cost-chain-config";
import { getProductionDemandConfig } from "@/modules/production/production-demand-config";
import { buildRecommendations, type EngineProductInput, type EngineRecipeInput } from "@/modules/production/recommendation-engine";
export type { ProductionRecommendation } from "@/modules/production/recommendation-engine";

type DbClient = PrismaClient | Prisma.TransactionClient;

const DEFAULT_REORDER_POINT = 0;
const DEFAULT_TARGET_STOCK = 0;
/** prompt-produccion-materiales.md Fase 4 — ventana de venta diaria: ~4 semanas, mismo criterio que getSalesMaps (replenishment-service.ts) usa para su ventana de 30 días. */
const SALES_VELOCITY_WINDOW_DAYS = 30;

function number(value: Prisma.Decimal | number | string | null | undefined) {
  if (value == null) return 0;
  return Number(value);
}

function round2(value: number) {
  return Math.round(value * 100) / 100;
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

/**
 * WAC apagado (docs/WAC-DESACTIVADO.md) — mismo patrón exacto que
 * production/service.ts::getInputWacTx (5dfaa22): con el flag apagado, el
 * costo se resuelve con resolveCostChain (branchCost > averageCost >
 * globalCost > lastPurchaseCost) sobre el producto canónico, no con
 * weightedAverageCost directo — sin esto, un WAC contaminado sesgaba la
 * recomendación "producir vs comprar". Con el flag prendido, sin cambios.
 * `db` opcional (default: el singleton `prisma`) para poder testear con un
 * db falso. Utilidad de un solo producto — getProductionRecommendationsForBranch
 * (Fase 4) resuelve esto mismo en bloque para N productos sin repetir esta
 * consulta por cada uno; el mismo criterio de WAC on/off vive en los dos
 * sitios, cubierto por separado (production-wac-gate-*.test.ts acá,
 * recommendation-batch.test.ts para el camino en bloque).
 */
export async function getSaleStockAndCost(branchId: string, productId: string, db: DbClient = prisma) {
  const shared = await getSharedInventoryBalance(db, { branchId, productId });
  const stock = shared.balance
    ? Number(shared.conversion
        ? convertBaseQtyToSaleQty({
            baseQuantity: shared.balance.quantityOnHand,
            conversionFactor: shared.conversion.conversionFactor,
          })
        : shared.balance.quantityOnHand)
    : 0;

  const wacEnabled = await isWacDrivesCostChainEnabled(db);
  let unitCost: number;
  if (wacEnabled) {
    unitCost = shared.balance
      ? Number(shared.conversion
          ? convertBaseUnitCostToSaleUnitCost({
              baseUnitCost: shared.balance.weightedAverageCost,
              conversionFactor: shared.conversion.conversionFactor,
            })
          : shared.balance.weightedAverageCost)
      : 0;
  } else {
    const [inputProduct, branchSetting] = await Promise.all([
      db.product.findUnique({
        where: { id: shared.inventoryProductId },
        select: { averageCost: true, globalCost: true, lastPurchaseCost: true },
      }),
      db.branchProductSetting.findUnique({
        where: { branchId_productId: { branchId, productId: shared.inventoryProductId } },
        select: { branchCost: true },
      }),
    ]);
    const { cost } = resolveCostChain(
      {
        branchCost: branchSetting?.branchCost ?? null,
        averageCost: inputProduct?.averageCost ?? null,
        globalCost: inputProduct?.globalCost ?? null,
        lastPurchaseCost: inputProduct?.lastPurchaseCost ?? null,
        weightedAverageCost: null,
      },
      false,
    );
    const baseUnitCost = cost ?? new Prisma.Decimal(0);
    unitCost = Number(shared.conversion
      ? convertBaseUnitCostToSaleUnitCost({ baseUnitCost, conversionFactor: shared.conversion.conversionFactor })
      : baseUnitCost);
  }

  return { stock, unitCost };
}

/**
 * prompt-produccion-materiales.md Fase 4 (fix Bug 6 + rendimiento) — todo
 * cargado en bloque, UNA vez, nunca por producto/receta/insumo: antes,
 * encontrar esto mismo costaba 2+ consultas por insumo por receta por
 * producto (evaluateRecipeAvailability + findProductionOpportunitiesForProduct,
 * ahora eliminadas). Las 9 consultas de abajo son fijas sin importar cuántos
 * productos o recetas haya — buildRecommendations (recommendation-engine.ts)
 * hace toda la aritmética en memoria, sin tocar la base.
 *
 * Candidatos: TODO producto terminado de una receta activa (antes solo
 * entraban productos con política de reorden configurada — un producto sin
 * política pero que SÍ se vende todos los días quedaba invisible; ahora la
 * demanda real lo saca a la luz igual, ver computeShortageQty).
 */
export async function getProductionRecommendationsForBranch(input: { branchId: string }, db: DbClient = prisma) {
  const [recipes, demandConfig] = await Promise.all([
    db.productionRecipe.findMany({
      where: { isActive: true },
      include: {
        finishedProduct: { select: { id: true, sku: true, name: true } },
        inputs: { include: { inputProduct: { select: { id: true, sku: true, name: true } } } },
      },
    }), // 1
    getProductionDemandConfig(db), // 2
  ]);

  const finishedProductIds = [...new Set(recipes.map((r) => r.finishedProductId))];
  const insumoIds = [...new Set(recipes.flatMap((r) => r.inputs.map((i) => i.inputProductId)))];
  const allProductIds = [...new Set([...finishedProductIds, ...insumoIds])];

  if (allProductIds.length === 0) {
    return { recommendations: [], summary: { total: 0, urgent: 0, producibleFromExcess: 0, blockedByInputs: 0, estimatedSavings: null } };
  }

  const [reorderPolicies, branchSettings, salesRows, conversions, wacEnabled] = await Promise.all([
    db.stockReorderPolicy.findMany({
      where: { branchId: input.branchId, productId: { in: allProductIds } },
      select: { productId: true, minQuantity: true, reorderPoint: true, targetQuantity: true, safetyStock: true, isActive: true },
    }), // 3
    db.branchProductSetting.findMany({
      where: { branchId: input.branchId, productId: { in: allProductIds } },
      select: { productId: true, minStock: true, maxStock: true, reorderPoint: true, branchCost: true },
    }), // 4
    db.saleOrderLine.groupBy({
      by: ["productId"],
      where: {
        productId: { in: finishedProductIds },
        saleOrder: { branchId: input.branchId, status: { in: ["PAID", "DISPATCH_PENDING", "DISPATCHED"] }, createdAt: { gte: new Date(Date.now() - SALES_VELOCITY_WINDOW_DAYS * 86_400_000) } },
      },
      _sum: { quantity: true },
    }), // 5 — mismo criterio que getSalesMaps (replenishment-service.ts): SaleOrderLine, mismos 3 estados, ventana de días.
    getProductStockConversionsBatch(db, allProductIds), // 6
    isWacDrivesCostChainEnabled(db), // 7
  ]);

  const canonicalIdByProduct = new Map(allProductIds.map((id) => [id, conversions.get(id)?.canonicalProductId ?? id]));
  const canonicalIds = [...new Set([...canonicalIdByProduct.values()])];

  const [balances, costProducts] = await Promise.all([
    db.inventoryBalance.findMany({ where: { branchId: input.branchId, productId: { in: canonicalIds } } }), // 8
    db.product.findMany({ where: { id: { in: canonicalIds } }, select: { id: true, averageCost: true, globalCost: true, lastPurchaseCost: true } }), // 9
  ]);

  const policyByProduct = new Map(reorderPolicies.map((p) => [p.productId, p]));
  const settingByProduct = new Map(branchSettings.map((s) => [s.productId, s]));
  const salesByProduct = new Map(salesRows.map((r) => [r.productId, number(r._sum.quantity) / SALES_VELOCITY_WINDOW_DAYS]));
  const balanceByCanonical = new Map(balances.map((b) => [b.productId, b]));
  const costByCanonical = new Map(costProducts.map((p) => [p.id, p]));

  const resolvePolicy = (productId: string): { minStock: number; reorderPoint: number; targetStock: number } => {
    const reorderPolicy = policyByProduct.get(productId);
    if (reorderPolicy?.isActive) {
      return {
        minStock: number(reorderPolicy.minQuantity),
        reorderPoint: number(reorderPolicy.reorderPoint),
        targetStock: number(reorderPolicy.targetQuantity) + number(reorderPolicy.safetyStock),
      };
    }
    const branchSetting = settingByProduct.get(productId);
    const reorderPoint = Math.max(number(branchSetting?.reorderPoint), number(branchSetting?.minStock), DEFAULT_REORDER_POINT);
    const targetStock = Math.max(number(branchSetting?.maxStock), reorderPoint, DEFAULT_TARGET_STOCK);
    return { minStock: number(branchSetting?.minStock), reorderPoint, targetStock };
  };

  const resolveStockAndCost = (productId: string): { stock: number; unitCost: number } => {
    const conversion = conversions.get(productId) ?? null;
    const canonicalId = canonicalIdByProduct.get(productId) ?? productId;
    const balance = balanceByCanonical.get(canonicalId) ?? null;
    const stock = balance
      ? Number(conversion ? convertBaseQtyToSaleQty({ baseQuantity: balance.quantityOnHand, conversionFactor: conversion.conversionFactor }) : balance.quantityOnHand)
      : 0;

    let unitCost: number;
    if (wacEnabled) {
      unitCost = balance
        ? Number(conversion ? convertBaseUnitCostToSaleUnitCost({ baseUnitCost: balance.weightedAverageCost, conversionFactor: conversion.conversionFactor }) : balance.weightedAverageCost)
        : 0;
    } else {
      const costProduct = costByCanonical.get(canonicalId);
      const branchSetting = settingByProduct.get(canonicalId);
      const { cost } = resolveCostChain(
        {
          branchCost: branchSetting?.branchCost ?? null,
          averageCost: costProduct?.averageCost ?? null,
          globalCost: costProduct?.globalCost ?? null,
          lastPurchaseCost: costProduct?.lastPurchaseCost ?? null,
          weightedAverageCost: null,
        },
        false,
      );
      const baseUnitCost = cost ?? new Prisma.Decimal(0);
      unitCost = Number(conversion ? convertBaseUnitCostToSaleUnitCost({ baseUnitCost, conversionFactor: conversion.conversionFactor }) : baseUnitCost);
    }
    return { stock: round2(stock), unitCost: round2(unitCost) };
  };

  const products: EngineProductInput[] = finishedProductIds.map((productId) => {
    const recipe = recipes.find((r) => r.finishedProductId === productId)!;
    const policy = resolvePolicy(productId);
    const { stock } = resolveStockAndCost(productId);
    const canonicalId = canonicalIdByProduct.get(productId) ?? productId;
    return {
      productId,
      productName: recipe.finishedProduct.name,
      sku: recipe.finishedProduct.sku,
      branchId: input.branchId,
      stockOnHand: stock,
      reorderPoint: Math.max(policy.reorderPoint, policy.minStock),
      targetStock: policy.targetStock,
      minStock: policy.minStock,
      dailySalesVelocity: salesByProduct.get(productId) ?? 0,
      lastPurchaseCost: costByCanonical.get(canonicalId)?.lastPurchaseCost != null ? Number(costByCanonical.get(canonicalId)!.lastPurchaseCost) : null,
    };
  });

  const recipesByProduct = new Map<string, EngineRecipeInput[]>();
  for (const recipe of recipes) {
    const list = recipesByProduct.get(recipe.finishedProductId) ?? [];
    list.push({
      recipeId: recipe.id,
      recipeName: recipe.name,
      recipeCode: recipe.code,
      recipeType: recipe.recipeType,
      recipeFamily: recipe.recipeFamily,
      finishedProductId: recipe.finishedProductId,
      expectedQuantity: recipe.expectedQuantity,
      wastePercent: recipe.wastePercent != null ? Number(recipe.wastePercent) : null,
      laborCostPerBatch: recipe.laborEnabled && recipe.laborCostPerBatch != null ? Number(recipe.laborCostPerBatch) : null,
      processingCostPerBatch: recipe.processingCostPerBatch != null ? Number(recipe.processingCostPerBatch) : null,
      inputs: recipe.inputs.map((ri) => {
        const policy = resolvePolicy(ri.inputProductId);
        const { stock, unitCost } = resolveStockAndCost(ri.inputProductId);
        return {
          productId: ri.inputProductId,
          productName: ri.inputProduct.name,
          sku: ri.inputProduct.sku,
          quantityPerBatch: ri.quantity,
          unit: ri.unit,
          stockOnHand: stock,
          targetStock: Math.max(policy.targetStock, policy.reorderPoint, policy.minStock),
          unitCost,
        };
      }),
    });
    recipesByProduct.set(recipe.finishedProductId, list);
  }

  const recommendations = buildRecommendations({ products, recipesByProduct, coverageDays: demandConfig.coverageDays });

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
