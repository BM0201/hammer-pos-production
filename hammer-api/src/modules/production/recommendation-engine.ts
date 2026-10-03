import { Prisma } from "@prisma/client";
import { applyWasteFactor } from "@/modules/production/calculations";

/**
 * prompt-produccion-materiales.md Fase 4 — núcleo puro del motor de
 * recomendaciones: dado TODO lo necesario ya cargado en memoria (productos,
 * recetas, con stock/costo/venta ya resueltos), decide qué recomendar sin
 * ninguna consulta nueva. Antes, encontrar esto mismo costaba 2+ consultas
 * por insumo por receta por producto (N+1 real); ahora el llamador carga
 * todo en bloque UNA vez y este núcleo solo hace aritmética.
 */

export type Priority = "LOW" | "MEDIUM" | "HIGH" | "URGENT";
export type RecommendationType =
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
  targetReorderPoint: number | null;
  targetShortageQty: number;
  /** Fase 4 — unidades/día de las últimas ~30 días, y el umbral que de ahí sale (coverageDays × venta diaria). */
  dailySalesVelocity: number;
  daysOfStockRemaining: number | null;
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
  /** Fase 4 — solo con recommendationType=BUY_INSTEAD: cuánto cuesta comprarlo en vez de producirlo. */
  buyCost: number | null;
  priority: Priority;
  recommendationType: RecommendationType;
  message: string;
  warnings: string[];
  recommendedActions: string[];
};

export type EngineProductInput = {
  productId: string;
  productName: string;
  sku: string;
  branchId: string;
  stockOnHand: number;
  /** max(reorderPoint, minStock) ya resuelto — la política de ESTE producto. */
  reorderPoint: number;
  targetStock: number;
  minStock: number;
  /** unidades/día, ventana ~30 días. 0 si no hay ventas recientes. */
  dailySalesVelocity: number;
  /** Product.lastPurchaseCost — null si nunca se compró. */
  lastPurchaseCost: number | null;
};

export type EngineInputLine = {
  productId: string;
  productName: string;
  sku: string;
  quantityPerBatch: number;
  unit: string;
  stockOnHand: number;
  /** max(reorderPoint, minStock) del INSUMO — para calcular "excedente" (lo que sobra por encima de su propia política). */
  targetStock: number;
  unitCost: number;
};

export type EngineRecipeInput = {
  recipeId: string;
  recipeName: string;
  recipeCode: string;
  recipeType: string;
  recipeFamily: string;
  finishedProductId: string;
  expectedQuantity: number;
  wastePercent: number | null;
  laborCostPerBatch: number | null;
  processingCostPerBatch: number | null;
  inputs: EngineInputLine[];
};

function priorityFor(stock: number, reorderPoint: number): Priority {
  if (reorderPoint <= 0) return "LOW";
  if (stock <= reorderPoint * 0.25) return "URGENT";
  if (stock <= reorderPoint * 0.5) return "HIGH";
  if (stock <= reorderPoint) return "MEDIUM";
  return "LOW";
}

function round2(value: number): number {
  return Math.round(value * 100) / 100;
}

function ceilPositive(value: number): number {
  return Math.max(1, Math.ceil(value));
}

/**
 * Faltante de UN producto: max(reorden, días_cobertura × venta_diaria) −
 * stock. Reemplaza el viejo criterio (solo reorden/targetStock): un
 * producto sin política configurada pero que se vende todos los días ahora
 * sí entra, en vez de quedar invisible por no tener reorderPoint.
 */
export function computeShortageQty(input: { stockOnHand: number; reorderPoint: number; dailySalesVelocity: number; coverageDays: number }): number {
  const demandBasedThreshold = input.coverageDays * input.dailySalesVelocity;
  const effectiveThreshold = Math.max(input.reorderPoint, demandBasedThreshold);
  return Math.max(0, effectiveThreshold - input.stockOnHand);
}

export function buildRecommendations(input: {
  products: EngineProductInput[];
  recipesByProduct: Map<string, EngineRecipeInput[]>;
  coverageDays: number;
}): ProductionRecommendation[] {
  const recommendations: ProductionRecommendation[] = [];

  for (const product of input.products) {
    const shortageQty = computeShortageQty({
      stockOnHand: product.stockOnHand,
      reorderPoint: product.reorderPoint,
      dailySalesVelocity: product.dailySalesVelocity,
      coverageDays: input.coverageDays,
    });
    if (shortageQty <= 0) continue;

    const recipes = input.recipesByProduct.get(product.productId) ?? [];
    const daysOfStockRemaining = product.dailySalesVelocity > 0 ? round2(product.stockOnHand / product.dailySalesVelocity) : null;

    for (const recipe of recipes) {
      const warnings: string[] = [];

      if (recipe.inputs.length === 0 || recipe.expectedQuantity <= 0) {
        recommendations.push({
          id: `${product.branchId}:${product.productId}:${recipe.recipeId}`,
          branchId: product.branchId,
          targetProductId: product.productId,
          targetProductName: product.productName,
          targetSku: product.sku,
          targetStockOnHand: round2(product.stockOnHand),
          targetReorderPoint: product.reorderPoint,
          targetShortageQty: round2(shortageQty),
          dailySalesVelocity: round2(product.dailySalesVelocity),
          daysOfStockRemaining,
          recipeId: recipe.recipeId,
          recipeName: recipe.recipeName,
          recipeType: recipe.recipeType,
          recipeFamily: recipe.recipeFamily,
          inputSummary: [],
          suggestedBatches: 0,
          expectedOutputQty: 0,
          estimatedInputCost: null,
          estimatedProcessingCost: null,
          estimatedUnitCost: null,
          buyCost: null,
          priority: "HIGH",
          recommendationType: "REVIEW_RECIPE",
          message: `Revisar receta ${recipe.recipeCode}: no tiene insumos o rendimiento válido.`,
          warnings: ["Receta incompleta."],
          recommendedActions: ["REVIEW_RECIPE"],
        });
        continue;
      }

      const neededBatches = ceilPositive(shortageQty / recipe.expectedQuantity);
      const inputLines = recipe.inputs.map((line) => {
        // Fase 4 — merma incluida en los insumos requeridos (mismo
        // applyWasteFactor que usan createBatch/calculateCost en Fase 2).
        const requiredQtyPerBatch = applyWasteFactor(new Prisma.Decimal(line.quantityPerBatch), recipe.wastePercent).toNumber();
        const requiredTotal = requiredQtyPerBatch * neededBatches;
        const excessQty = Math.max(0, line.stockOnHand - line.targetStock);
        return {
          productId: line.productId,
          productName: line.productName,
          sku: line.sku,
          availableStock: round2(line.stockOnHand),
          requiredQtyPerBatch: round2(requiredQtyPerBatch),
          requiredTotal: round2(requiredTotal),
          unitCost: line.unitCost,
          excessQty: round2(excessQty),
          maxBatchesFromExcess: requiredQtyPerBatch > 0 ? Math.floor(excessQty / requiredQtyPerBatch) : 0,
          maxBatchesFromAvailableStock: requiredQtyPerBatch > 0 ? Math.floor(line.stockOnHand / requiredQtyPerBatch) : 0,
          willRemainAfterProduction: round2(line.stockOnHand - requiredTotal),
        };
      });

      const estimatedInputCost = inputLines.reduce((sum, l) => sum + l.requiredTotal * l.unitCost, 0);
      const minFromExcess = Math.min(...inputLines.map((l) => l.maxBatchesFromExcess));
      const minFromStock = Math.min(...inputLines.map((l) => l.maxBatchesFromAvailableStock));
      const suggestedFromExcess = Math.min(neededBatches, Math.max(0, minFromExcess));
      const suggestedFromStock = Math.min(neededBatches, Math.max(0, minFromStock));
      const recommendedBatches = suggestedFromExcess > 0 ? suggestedFromExcess : suggestedFromStock;
      const expectedOutputQty = recommendedBatches * recipe.expectedQuantity;

      const processingCostPerBatch = (recipe.processingCostPerBatch ?? 0) + (recipe.laborCostPerBatch ?? 0);
      const scaledInputCost = neededBatches > 0 && recommendedBatches > 0 ? estimatedInputCost * (recommendedBatches / neededBatches) : null;
      const estimatedProcessingCost = recommendedBatches > 0 ? processingCostPerBatch * recommendedBatches : null;
      const estimatedTotal = scaledInputCost == null ? null : scaledInputCost + (estimatedProcessingCost ?? 0);
      const estimatedUnitCost = estimatedTotal != null && expectedOutputQty > 0 ? estimatedTotal / expectedOutputQty : null;

      // Fase 4 — "producir vs comprar": si comprarlo ya hecho sale igual o
      // más barato que fabricarlo (con la merma incluida arriba), se
      // recomienda comprar — ambas cifras quedan a la vista para decidir.
      let recommendationType: RecommendationType;
      if (estimatedUnitCost != null && product.lastPurchaseCost != null && estimatedUnitCost >= product.lastPurchaseCost) {
        recommendationType = "BUY_INSTEAD";
      } else if (recommendedBatches <= 0) {
        recommendationType = "NOT_ENOUGH_INPUTS";
      } else if (suggestedFromExcess > 0) {
        recommendationType = "PRODUCE_FROM_EXCESS";
      } else {
        recommendationType = "PRODUCE_FROM_AVAILABLE_STOCK";
      }

      if (inputLines.some((l) => l.willRemainAfterProduction < 0)) {
        warnings.push("Consumir todos los insumos sugeridos podría dejar un insumo bajo reorden.");
      }
      if (inputLines.some((l) => l.unitCost <= 0)) {
        warnings.push("Uno o más insumos no tienen costo efectivo.");
      }

      recommendations.push({
        id: `${product.branchId}:${product.productId}:${recipe.recipeId}`,
        branchId: product.branchId,
        targetProductId: product.productId,
        targetProductName: product.productName,
        targetSku: product.sku,
        targetStockOnHand: round2(product.stockOnHand),
        targetReorderPoint: product.reorderPoint,
        targetShortageQty: round2(shortageQty),
        dailySalesVelocity: round2(product.dailySalesVelocity),
        daysOfStockRemaining,
        recipeId: recipe.recipeId,
        recipeName: recipe.recipeName,
        recipeType: recipe.recipeType,
        recipeFamily: recipe.recipeFamily,
        inputSummary: inputLines.map((l) => ({
          productId: l.productId,
          productName: l.productName,
          sku: l.sku,
          availableStock: l.availableStock,
          requiredQtyPerBatch: l.requiredQtyPerBatch,
          excessQty: l.excessQty,
          maxBatchesFromExcess: l.maxBatchesFromExcess,
          willRemainAfterProduction: l.willRemainAfterProduction,
        })),
        suggestedBatches: recommendationType === "BUY_INSTEAD" ? 0 : recommendedBatches,
        expectedOutputQty: round2(expectedOutputQty),
        estimatedInputCost: scaledInputCost == null ? null : round2(scaledInputCost),
        estimatedProcessingCost: estimatedProcessingCost == null ? null : round2(estimatedProcessingCost),
        estimatedUnitCost: estimatedUnitCost == null ? null : round2(estimatedUnitCost),
        buyCost: recommendationType === "BUY_INSTEAD" ? product.lastPurchaseCost : null,
        priority: priorityFor(product.stockOnHand, product.reorderPoint),
        recommendationType,
        message: recommendationType === "BUY_INSTEAD"
          ? `Comprar ${product.productName} sale igual o más barato que producirlo.`
          : recommendationType === "PRODUCE_FROM_EXCESS"
            ? `Producir ${round2(expectedOutputQty)} de ${product.productName} usando excedente disponible.`
            : recommendationType === "PRODUCE_FROM_AVAILABLE_STOCK"
              ? `Producir ${round2(expectedOutputQty)} de ${product.productName}; revisar impacto en insumos.`
              : `Comprar o abastecer insumos antes de producir ${product.productName}.`,
        warnings,
        recommendedActions: recommendationType === "NOT_ENOUGH_INPUTS"
          ? ["BUY_INPUTS", "REVIEW_REORDER_POLICY"]
          : recommendationType === "BUY_INSTEAD"
            ? ["BUY_FINISHED_PRODUCT"]
            : ["CREATE_PRODUCTION_BATCH", "REVIEW_REORDER_POLICY"],
      });
    }
  }

  const rank: Record<Priority, number> = { URGENT: 4, HIGH: 3, MEDIUM: 2, LOW: 1 };
  return recommendations.sort((a, b) => rank[b.priority] - rank[a.priority]);
}
