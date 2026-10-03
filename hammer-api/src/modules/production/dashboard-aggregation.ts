/**
 * prompt-produccion-materiales.md Fase 3 — núcleo puro del dashboard: dado
 * los datos YA CARGADOS (lotes, insumos consumidos, reservas, recetas),
 * calcula todo acá, sin tocar la base — testeable sin mocks de Prisma.
 *
 * El bug que mata: el dashboard viejo promediaba `unitCost` de lotes de
 * PRODUCTOS DISTINTOS sin ponderar por cantidad. La ponderación correcta de
 * "costo unitario promedio" por producto es Σ(totalCost) / Σ(buenas) — NO
 * el promedio simple de unitCost_i — porque unitCost_i × buenas_i == totalCost_i
 * exactamente (así se definió al cerrar cada lote), así que sumar costos
 * totales y dividir por buenas totales YA es el promedio ponderado por
 * cantidad, sin necesitar un peso aparte. Lo mismo aplica al rendimiento:
 * Σ(buenas) / Σ(intentadas) es el rendimiento ponderado, no el promedio de
 * yieldPct_i por lote.
 */

export type DashboardBatch = {
  status: string;
  finishedProductId: string;
  finishedProductName: string;
  finishedProductSku?: string;
  finishedProductUnit?: string | null;
  producedGoodQuantity: number | null;
  producedBadQuantity: number | null;
  totalCost: number | null;
  recipeYieldPercent: number | null;
};

export function aggregateBatchesByStatus(batches: Array<{ status: string }>): Record<string, number> {
  const counts: Record<string, number> = {};
  for (const batch of batches) {
    counts[batch.status] = (counts[batch.status] ?? 0) + 1;
  }
  return counts;
}

export type ProducedByProduct = {
  productId: string;
  productName: string;
  sku: string;
  unit: string | null;
  goodQuantity: number;
  badQuantity: number;
  /** Σ(buenas) / Σ(intentadas) de ESTE producto — null si no se intentó nada. */
  weightedYieldPct: number | null;
  /** Σ(totalCost) / Σ(buenas) de ESTE producto — null sin unidades buenas. */
  weightedUnitCost: number | null;
  /** Meta de rendimiento de la receta (yieldPercent) — null si ninguna receta de este producto la tiene, o si hay varias recetas con metas distintas (se deja null para no inventar un promedio de metas). */
  targetYieldPct: number | null;
  batchCount: number;
};

export function aggregateProducedByProduct(batches: DashboardBatch[]): ProducedByProduct[] {
  const completed = batches.filter((b) => b.status === "COMPLETED");
  const byProduct = new Map<string, {
    productName: string;
    sku: string;
    unit: string | null;
    goodQuantity: number;
    badQuantity: number;
    totalCost: number;
    batchCount: number;
    targetYieldPcts: Set<number>;
  }>();

  for (const batch of completed) {
    const row = byProduct.get(batch.finishedProductId) ?? {
      productName: batch.finishedProductName,
      sku: batch.finishedProductSku ?? "",
      unit: batch.finishedProductUnit ?? null,
      goodQuantity: 0,
      badQuantity: 0,
      totalCost: 0,
      batchCount: 0,
      targetYieldPcts: new Set<number>(),
    };
    row.goodQuantity += batch.producedGoodQuantity ?? 0;
    row.badQuantity += batch.producedBadQuantity ?? 0;
    row.totalCost += batch.totalCost ?? 0;
    row.batchCount += 1;
    if (batch.recipeYieldPercent != null) row.targetYieldPcts.add(batch.recipeYieldPercent);
    byProduct.set(batch.finishedProductId, row);
  }

  return Array.from(byProduct.entries()).map(([productId, row]) => {
    const totalAttempted = row.goodQuantity + row.badQuantity;
    return {
      productId,
      productName: row.productName,
      sku: row.sku,
      unit: row.unit,
      goodQuantity: row.goodQuantity,
      badQuantity: row.badQuantity,
      weightedYieldPct: totalAttempted > 0 ? row.goodQuantity / totalAttempted : null,
      weightedUnitCost: row.goodQuantity > 0 ? row.totalCost / row.goodQuantity : null,
      targetYieldPct: row.targetYieldPcts.size === 1 ? [...row.targetYieldPcts][0] : null,
      batchCount: row.batchCount,
    };
  }).sort((a, b) => b.goodQuantity - a.goodQuantity);
}

export type InputConsumption = {
  productId: string;
  productName: string;
  totalQuantity: number;
  totalCost: number;
};

export function aggregateInputConsumption(
  inputs: Array<{ inputProductId: string; inputProductName: string; actualQuantity: number | null; totalCost: number | null }>,
): InputConsumption[] {
  const byProduct = new Map<string, { productName: string; totalQuantity: number; totalCost: number }>();
  for (const line of inputs) {
    const row = byProduct.get(line.inputProductId) ?? { productName: line.inputProductName, totalQuantity: 0, totalCost: 0 };
    row.totalQuantity += line.actualQuantity ?? 0;
    row.totalCost += line.totalCost ?? 0;
    byProduct.set(line.inputProductId, row);
  }
  return Array.from(byProduct.entries())
    .map(([productId, row]) => ({ productId, ...row }))
    .sort((a, b) => b.totalCost - a.totalCost);
}

export type BlockingInput = {
  productId: string;
  productName: string;
  shortfall: number;
  batchCount: number;
};

/** insumos que bloquean lotes PLANNED/IN_PROGRESS: reservado < necesario (plannedQuantity). */
export function findBlockingInputs(
  inputs: Array<{ inputProductId: string; inputProductName: string; plannedQuantity: number; reservedQuantity: number }>,
): BlockingInput[] {
  const byProduct = new Map<string, { productName: string; shortfall: number; batchCount: number }>();
  for (const line of inputs) {
    const shortfall = line.plannedQuantity - line.reservedQuantity;
    if (shortfall <= 0.0001) continue;
    const row = byProduct.get(line.inputProductId) ?? { productName: line.inputProductName, shortfall: 0, batchCount: 0 };
    row.shortfall += shortfall;
    row.batchCount += 1;
    byProduct.set(line.inputProductId, row);
  }
  return Array.from(byProduct.entries())
    .map(([productId, row]) => ({ productId, ...row }))
    .sort((a, b) => b.shortfall - a.shortfall);
}

export type PeriodValueTotals = {
  /** Σ costo total de los lotes COMPLETED del período (C$). */
  producedValue: number;
  /** Σ costo × malas/intentadas, por lote — valor que representó la merma (C$). */
  lossValue: number;
  /** Promedio del rendimiento POR LOTE (buenas/intentadas) — complementa aggregateProducedByProduct, que pondera por producto, no por lote. null sin lotes con intentos. */
  avgYieldPct: number | null;
};

/**
 * Reconciliación con hub-produccion.patch (UI adoptada, backend propio) —
 * "Valor producido"/"Perdido en unidades malas"/"Rendimiento promedio" de la
 * banda de resumen: tres números que NO se obtienen de aggregateProducedByProduct
 * (que agrupa por producto) sino de los mismos lotes del período, sin agrupar.
 */
export function computePeriodValueTotals(batches: DashboardBatch[]): PeriodValueTotals {
  const completed = batches.filter((b) => b.status === "COMPLETED");
  let producedValue = 0;
  let lossValue = 0;
  let yieldSum = 0;
  let yieldCount = 0;
  for (const batch of completed) {
    const good = Math.max(0, batch.producedGoodQuantity ?? 0);
    const bad = Math.max(0, batch.producedBadQuantity ?? 0);
    const attempted = good + bad;
    const cost = batch.totalCost ?? 0;
    producedValue += cost;
    if (attempted > 0) {
      lossValue += cost * (bad / attempted);
      yieldSum += good / attempted;
      yieldCount += 1;
    }
  }
  return {
    producedValue,
    lossValue,
    avgYieldPct: yieldCount > 0 ? yieldSum / yieldCount : null,
  };
}

export type ShortInput = { productId: string; productName: string; unit: string; planned: number; reserved: number; missing: number };

/**
 * Insumos sin reservar del todo, para UN lote — mismo criterio de faltante
 * que findBlockingInputs (plannedQuantity − reservedQuantity), sin agregar
 * entre lotes: esto alimenta el feed "Necesita atención" por lote (adoptado
 * de hub-produccion.patch), findBlockingInputs sigue siendo la vista
 * agregada por insumo.
 */
export function shortInputsForBatch(
  inputs: Array<{ inputProductId: string; inputProductName: string; plannedQuantity: number; reservedQuantity: number; unit: string }>,
): ShortInput[] {
  return inputs
    .map((i) => ({
      productId: i.inputProductId,
      productName: i.inputProductName,
      unit: i.unit,
      planned: i.plannedQuantity,
      reserved: i.reservedQuantity,
      missing: Math.max(0, i.plannedQuantity - i.reservedQuantity),
    }))
    .filter((i) => i.missing > 0.0001);
}

export type IncompleteRecipe = {
  recipeId: string;
  recipeName: string;
  recipeCode: string;
  reason: "NO_INPUTS" | "INVALID_EXPECTED_QUANTITY" | "ZERO_COST_INPUT";
};

/**
 * Recetas incompletas: sin insumos, expectedQuantity <= 0, o un insumo con
 * costo 0 EN ESTA SUCURSAL (costPerInput ya viene resuelto por el llamador
 * — getInputWacTx/resolveCostChain, mismo criterio que el resto del módulo,
 * nunca recalculado acá).
 */
export function findIncompleteRecipes(
  recipes: Array<{ id: string; name: string; code: string; expectedQuantity: number; inputs: Array<{ costInBranch: number }> }>,
): IncompleteRecipe[] {
  const results: IncompleteRecipe[] = [];
  for (const recipe of recipes) {
    if (recipe.inputs.length === 0) {
      results.push({ recipeId: recipe.id, recipeName: recipe.name, recipeCode: recipe.code, reason: "NO_INPUTS" });
    } else if (recipe.expectedQuantity <= 0) {
      results.push({ recipeId: recipe.id, recipeName: recipe.name, recipeCode: recipe.code, reason: "INVALID_EXPECTED_QUANTITY" });
    } else if (recipe.inputs.some((i) => i.costInBranch <= 0)) {
      results.push({ recipeId: recipe.id, recipeName: recipe.name, recipeCode: recipe.code, reason: "ZERO_COST_INPUT" });
    }
  }
  return results;
}
