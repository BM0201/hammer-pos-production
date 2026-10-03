import { prisma } from "@/lib/prisma";
import { getInputWacTx } from "@/modules/production/service";
import {
  aggregateBatchesByStatus,
  aggregateProducedByProduct,
  aggregateInputConsumption,
  findBlockingInputs,
  findIncompleteRecipes,
  computePeriodValueTotals,
  shortInputsForBatch,
  type ProducedByProduct,
  type InputConsumption,
  type BlockingInput,
  type IncompleteRecipe,
  type ShortInput,
} from "@/modules/production/dashboard-aggregation";

export type ProducedByProductWithPrice = ProducedByProduct & { currentPrice: number | null; marginAtCurrentPrice: number | null };

export type OpenBatchAttention = {
  id: string;
  batchNumber: string;
  status: string;
  plannedQuantity: number;
  createdAt: Date;
  startedAt: Date | null;
  branch: { id: string; name: string };
  recipe: { id: string; name: string };
  product: { id: string; name: string; unit: string | null };
  shortInputs: ShortInput[];
};

export type PriceApproval = {
  id: string;
  batchNumber: string;
  completedAt: Date | null;
  unitCost: number | null;
  suggestedPrice: number | null;
  branch: { id: string; name: string };
  product: { id: string; name: string };
};

export type ProductionDashboard = {
  period: { from: Date; to: Date };
  branchId: string | null;
  totals: {
    completedBatches: number;
    producedValue: number;
    lossValue: number;
    avgYieldPct: number | null;
    reversedBatches: number;
    openBatches: number;
    openBatchesWithShortInputs: number;
  };
  batchesByStatus: Record<string, number>;
  producedByProduct: ProducedByProductWithPrice[];
  materialVarianceCostTotal: number;
  inputConsumption: InputConsumption[];
  blockingInputs: BlockingInput[];
  attention: {
    openBatches: OpenBatchAttention[];
    priceApprovals: PriceApproval[];
    incompleteRecipes: IncompleteRecipe[];
  };
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
export async function getProductionDashboard(input: { branchId?: string | null; from: Date; to: Date }): Promise<ProductionDashboard> {
  const branchId = input.branchId || null;
  const branchFilter = branchId ? { branchId } : {};
  const periodWhere = { ...branchFilter, createdAt: { gte: input.from, lte: input.to } };

  const [batches, inputRows, blockingRows, activeRecipes, openBatchRows, priceApprovalRows] = await Promise.all([
    prisma.productionBatch.findMany({
      where: periodWhere,
      select: {
        status: true,
        producedGoodQuantity: true,
        producedBadQuantity: true,
        totalCost: true,
        materialVarianceCost: true,
        recipe: { select: { yieldPercent: true, finishedProductId: true, finishedProduct: { select: { id: true, name: true, sku: true, unit: true } } } },
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
      where: { batch: { ...branchFilter, status: { in: ["PLANNED", "IN_PROGRESS"] } } },
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
    // Lotes abiertos, con sus propios insumos — feed "Necesita atención" por
    // lote (adoptado de hub-produccion.patch). Estado actual, no del período
    // — mismo motivo que blockingInputs arriba.
    prisma.productionBatch.findMany({
      where: { ...branchFilter, status: { in: ["DRAFT", "PLANNED", "IN_PROGRESS"] } },
      orderBy: { createdAt: "asc" },
      select: {
        id: true, batchNumber: true, status: true, plannedQuantity: true, createdAt: true, startedAt: true,
        branch: { select: { id: true, name: true } },
        recipe: { select: { id: true, name: true, finishedProduct: { select: { id: true, name: true, unit: true } } } },
        inputs: { select: { plannedQuantity: true, reservedQuantity: true, unit: true, inputProduct: { select: { id: true, name: true } } } },
      },
    }),
    // Precios por aprobar: lotes COMPLETED del período con priceApprovalRequired.
    prisma.productionBatch.findMany({
      where: { ...periodWhere, status: "COMPLETED", priceApprovalRequired: true },
      orderBy: { completedAt: "desc" },
      select: {
        id: true, batchNumber: true, completedAt: true, unitCost: true, suggestedPrice: true,
        branch: { select: { id: true, name: true } },
        recipe: { select: { finishedProduct: { select: { id: true, name: true } } } },
      },
    }),
  ]);

  const batchesByStatus = aggregateBatchesByStatus(batches);

  const producedByProduct = aggregateProducedByProduct(
    batches.map((b) => ({
      status: b.status,
      finishedProductId: b.recipe.finishedProduct.id,
      finishedProductName: b.recipe.finishedProduct.name,
      finishedProductSku: b.recipe.finishedProduct.sku,
      finishedProductUnit: b.recipe.finishedProduct.unit,
      producedGoodQuantity: b.producedGoodQuantity,
      producedBadQuantity: b.producedBadQuantity,
      totalCost: b.totalCost != null ? Number(b.totalCost) : null,
      recipeYieldPercent: b.recipe.yieldPercent != null ? Number(b.recipe.yieldPercent) : null,
    })),
  );

  const periodValueTotals = computePeriodValueTotals(
    batches.map((b) => ({
      status: b.status,
      finishedProductId: b.recipe.finishedProductId,
      finishedProductName: b.recipe.finishedProduct.name,
      producedGoodQuantity: b.producedGoodQuantity,
      producedBadQuantity: b.producedBadQuantity,
      totalCost: b.totalCost != null ? Number(b.totalCost) : null,
      recipeYieldPercent: b.recipe.yieldPercent != null ? Number(b.recipe.yieldPercent) : null,
    })),
  );

  const materialVarianceCostTotal = batches.reduce((sum, b) => sum + (b.materialVarianceCost != null ? Number(b.materialVarianceCost) : 0), 0);

  // Precio actual (branchPrice de esta sucursal, o standardSalePrice si no
  // hay override) por producto — para el margen vs. el costo ponderado. Sin
  // sucursal (todas), solo queda el estándar: branchPrice es por definición
  // de UNA sucursal.
  const [branchSettings, products] = await Promise.all([
    branchId
      ? prisma.branchProductSetting.findMany({
          where: { branchId, productId: { in: producedByProduct.map((p) => p.productId) } },
          select: { productId: true, branchPrice: true },
        })
      : Promise.resolve([] as Array<{ productId: string; branchPrice: unknown }>),
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
  // aparición en cada receta. Sin sucursal (todas), "costo 0 en esta
  // sucursal" no tiene una sola respuesta — se deja de chequear, el resto
  // de las razones (sin insumos, cantidad inválida) sigue aplicando igual.
  const uniqueInputIds = [...new Set(activeRecipes.flatMap((r) => r.inputs.map((i) => i.inputProductId)))];
  const costByInputId = new Map<string, number>();
  if (branchId) {
    for (const productId of uniqueInputIds) {
      const { wacSaleUnit } = await getInputWacTx(prisma, { branchId, productId });
      costByInputId.set(productId, wacSaleUnit.toNumber());
    }
  }
  const incompleteRecipes = findIncompleteRecipes(
    activeRecipes.map((r) => ({
      id: r.id,
      name: r.name,
      code: r.code,
      expectedQuantity: r.expectedQuantity,
      inputs: r.inputs.map((i) => ({ costInBranch: branchId ? costByInputId.get(i.inputProductId) ?? 0 : 1 })),
    })),
  );

  const openBatches: OpenBatchAttention[] = openBatchRows.map((batch) => ({
    id: batch.id,
    batchNumber: batch.batchNumber,
    status: batch.status,
    plannedQuantity: batch.plannedQuantity,
    createdAt: batch.createdAt,
    startedAt: batch.startedAt,
    branch: batch.branch,
    recipe: { id: batch.recipe.id, name: batch.recipe.name },
    product: batch.recipe.finishedProduct,
    shortInputs: batch.status === "DRAFT" ? [] : shortInputsForBatch(
      batch.inputs.map((i) => ({
        inputProductId: i.inputProduct.id,
        inputProductName: i.inputProduct.name,
        plannedQuantity: i.plannedQuantity,
        reservedQuantity: Number(i.reservedQuantity),
        unit: i.unit,
      })),
    ),
  }));

  const priceApprovals: PriceApproval[] = priceApprovalRows.map((batch) => ({
    id: batch.id,
    batchNumber: batch.batchNumber,
    completedAt: batch.completedAt,
    unitCost: batch.unitCost != null ? Number(batch.unitCost) : null,
    suggestedPrice: batch.suggestedPrice != null ? Number(batch.suggestedPrice) : null,
    branch: batch.branch,
    product: batch.recipe.finishedProduct,
  }));

  return {
    period: { from: input.from, to: input.to },
    branchId,
    totals: {
      completedBatches: batchesByStatus.COMPLETED ?? 0,
      producedValue: periodValueTotals.producedValue,
      lossValue: periodValueTotals.lossValue,
      avgYieldPct: periodValueTotals.avgYieldPct,
      reversedBatches: batchesByStatus.REVERSED ?? 0,
      openBatches: openBatches.length,
      openBatchesWithShortInputs: openBatches.filter((b) => b.shortInputs.length > 0).length,
    },
    batchesByStatus,
    producedByProduct: producedByProductWithPrice,
    materialVarianceCostTotal,
    inputConsumption,
    blockingInputs,
    attention: { openBatches, priceApprovals, incompleteRecipes },
  };
}
