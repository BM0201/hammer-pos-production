import { prisma } from "@/lib/prisma";
import { getInputWacTx } from "@/modules/production/service";
import {
  aggregateBatchesByStatus,
  aggregateProducedByProduct,
  aggregateInputConsumption,
  findBlockingInputs,
  findIncompleteRecipes,
  type ProducedByProduct,
  type InputConsumption,
  type BlockingInput,
  type IncompleteRecipe,
} from "@/modules/production/dashboard-aggregation";

export type ProducedByProductWithPrice = ProducedByProduct & { currentPrice: number | null; marginAtCurrentPrice: number | null };

export type ProductionDashboard = {
  period: { from: Date; to: Date };
  branchId: string;
  batchesByStatus: Record<string, number>;
  producedByProduct: ProducedByProductWithPrice[];
  materialVarianceCostTotal: number;
  inputConsumption: InputConsumption[];
  blockingInputs: BlockingInput[];
  incompleteRecipes: IncompleteRecipe[];
};

/**
 * prompt-produccion-materiales.md Fase 3 — todo se calcula ACÁ, en el
 * servidor, con una ventana de fecha explícita — no en el cliente con "los
 * últimos 80 lotes" (el bug viejo: ni siquiera garantizaba cubrir el
 * período que el usuario creía estar viendo).
 *
 * Filtro de fecha uniforme: TODO lo que es "de este período" se filtra por
 * ProductionBatch.createdAt — una sola regla, no una mezcla de createdAt
 * para unas métricas y completedAt para otras. Las dos excepciones son
 * deliberadas y adelante se explica cada una: insumos que bloquean (estado
 * ACTUAL, no histórico) y recetas incompletas (configuración, no datos del
 * período).
 */
export async function getProductionDashboard(input: { branchId: string; from: Date; to: Date }): Promise<ProductionDashboard> {
  const periodWhere = { branchId: input.branchId, createdAt: { gte: input.from, lte: input.to } };

  const [batches, inputRows, blockingRows, activeRecipes] = await Promise.all([
    prisma.productionBatch.findMany({
      where: periodWhere,
      select: {
        status: true,
        producedGoodQuantity: true,
        producedBadQuantity: true,
        totalCost: true,
        materialVarianceCost: true,
        recipe: { select: { yieldPercent: true, finishedProductId: true, finishedProduct: { select: { id: true, name: true } } } },
      },
    }),
    // Consumo de insumos del período: solo de lotes COMPLETED (actualQuantity
    // ya es el consumo de verdad, real o estándar — ver Fase 2).
    prisma.productionBatchInput.findMany({
      where: { batch: { ...periodWhere, status: "COMPLETED" } },
      select: { actualQuantity: true, totalCost: true, inputProduct: { select: { id: true, name: true } } },
    }),
    // Insumos que bloquean: estado ACTUAL de lotes PLANNED/IN_PROGRESS de la
    // sucursal — "bloquea" es un hecho de HOY, no algo que tenga sentido
    // acotar a un rango de fechas (un lote abierto desde antes del período
    // sigue bloqueado hoy, y seguirlo sin mostrar porque "se creó antes"
    // sería mentirle a quien mira el dashboard).
    prisma.productionBatchInput.findMany({
      where: { batch: { branchId: input.branchId, status: { in: ["PLANNED", "IN_PROGRESS"] } } },
      select: { plannedQuantity: true, reservedQuantity: true, inputProduct: { select: { id: true, name: true } } },
    }),
    // Recetas incompletas: configuración global, no datos del período.
    prisma.productionRecipe.findMany({
      where: { isActive: true },
      select: {
        id: true, name: true, code: true, expectedQuantity: true,
        inputs: { select: { inputProductId: true } },
      },
    }),
  ]);

  const batchesByStatus = aggregateBatchesByStatus(batches);

  const producedByProduct = aggregateProducedByProduct(
    batches.map((b) => ({
      status: b.status,
      finishedProductId: b.recipe.finishedProduct.id,
      finishedProductName: b.recipe.finishedProduct.name,
      producedGoodQuantity: b.producedGoodQuantity,
      producedBadQuantity: b.producedBadQuantity,
      totalCost: b.totalCost != null ? Number(b.totalCost) : null,
      recipeYieldPercent: b.recipe.yieldPercent != null ? Number(b.recipe.yieldPercent) : null,
    })),
  );

  const materialVarianceCostTotal = batches.reduce((sum, b) => sum + (b.materialVarianceCost != null ? Number(b.materialVarianceCost) : 0), 0);

  // Precio actual (branchPrice de esta sucursal, o standardSalePrice si no
  // hay override) por producto — para el margen vs. el costo ponderado.
  const [branchSettings, products] = await Promise.all([
    prisma.branchProductSetting.findMany({
      where: { branchId: input.branchId, productId: { in: producedByProduct.map((p) => p.productId) } },
      select: { productId: true, branchPrice: true },
    }),
    prisma.product.findMany({
      where: { id: { in: producedByProduct.map((p) => p.productId) } },
      select: { id: true, standardSalePrice: true },
    }),
  ]);
  const branchPriceById = new Map(branchSettings.map((s) => [s.productId, s.branchPrice != null ? Number(s.branchPrice) : null]));
  const standardPriceById = new Map(products.map((p) => [p.id, Number(p.standardSalePrice)]));
  const producedByProductWithPrice: ProducedByProductWithPrice[] = producedByProduct.map((p) => {
    const currentPrice = branchPriceById.get(p.productId) ?? standardPriceById.get(p.productId) ?? null;
    const marginAtCurrentPrice = currentPrice != null && currentPrice > 0 && p.weightedUnitCost != null
      ? (currentPrice - p.weightedUnitCost) / currentPrice
      : null;
    return { ...p, currentPrice, marginAtCurrentPrice };
  });

  const inputConsumption = aggregateInputConsumption(
    inputRows.map((r) => ({
      inputProductId: r.inputProduct.id,
      inputProductName: r.inputProduct.name,
      actualQuantity: r.actualQuantity,
      totalCost: r.totalCost != null ? Number(r.totalCost) : null,
    })),
  );

  const blockingInputs = findBlockingInputs(
    blockingRows.map((r) => ({
      inputProductId: r.inputProduct.id,
      inputProductName: r.inputProduct.name,
      plannedQuantity: r.plannedQuantity,
      reservedQuantity: Number(r.reservedQuantity),
    })),
  );

  // Costo por insumo EN ESTA SUCURSAL (mismo resolve que el resto del
  // módulo — getInputWacTx) — una sola vez por insumo único, no por cada
  // aparición en cada receta.
  const uniqueInputIds = [...new Set(activeRecipes.flatMap((r) => r.inputs.map((i) => i.inputProductId)))];
  const costByInputId = new Map<string, number>();
  for (const productId of uniqueInputIds) {
    const { wacSaleUnit } = await getInputWacTx(prisma, { branchId: input.branchId, productId });
    costByInputId.set(productId, wacSaleUnit.toNumber());
  }
  const incompleteRecipes = findIncompleteRecipes(
    activeRecipes.map((r) => ({
      id: r.id,
      name: r.name,
      code: r.code,
      expectedQuantity: r.expectedQuantity,
      inputs: r.inputs.map((i) => ({ costInBranch: costByInputId.get(i.inputProductId) ?? 0 })),
    })),
  );

  return {
    period: { from: input.from, to: input.to },
    branchId: input.branchId,
    batchesByStatus,
    producedByProduct: producedByProductWithPrice,
    materialVarianceCostTotal,
    inputConsumption,
    blockingInputs,
    incompleteRecipes,
  };
}
