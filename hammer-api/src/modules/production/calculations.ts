/**
 * Production cost & pricing calculations.
 *
 * Producción v2 Fase 0 — reescrito en Decimal (antes operaba en `number` con
 * `Math.round(x*100)/100`, la misma clase de imprecisión de punto flotante
 * que el resto del dinero del proyecto ya evita usando Decimal).
 */
import { Prisma } from "@prisma/client";

export interface CostBreakdown {
  materialsCost: Prisma.Decimal;
  laborCost: Prisma.Decimal;
  overheadCost: Prisma.Decimal;
  totalCost: Prisma.Decimal;
  unitCost: Prisma.Decimal;
  suggestedPrice: Prisma.Decimal | null;
}

/**
 * Calculate the full cost breakdown for a production batch.
 *
 * `materialsCost` ya viene calculado (Producción v2 Fase 1: el estándar de la
 * receta al WAC del sistema, nunca un costo enviado por el cliente).
 */
export function calculateBatchCosts(params: {
  materialsCost: Prisma.Decimal | number;
  laborCost: Prisma.Decimal | number;
  overheadCost: Prisma.Decimal | number;
  producedGoodQuantity: Prisma.Decimal | number;
  targetMarginPct?: Prisma.Decimal | number | null;
}): CostBreakdown {
  const materialsCost = new Prisma.Decimal(params.materialsCost);
  const laborCost = new Prisma.Decimal(params.laborCost);
  const overheadCost = new Prisma.Decimal(params.overheadCost);
  const producedGoodQuantity = new Prisma.Decimal(params.producedGoodQuantity);

  const totalCost = materialsCost.add(laborCost).add(overheadCost);
  const unitCost = producedGoodQuantity.gt(0) ? totalCost.div(producedGoodQuantity) : new Prisma.Decimal(0);

  let suggestedPrice: Prisma.Decimal | null = null;
  if (params.targetMarginPct != null) {
    const targetMarginPct = new Prisma.Decimal(params.targetMarginPct);
    if (targetMarginPct.gt(0) && targetMarginPct.lt(1)) {
      suggestedPrice = unitCost.div(new Prisma.Decimal(1).sub(targetMarginPct));
    }
  }

  return { materialsCost, laborCost, overheadCost, totalCost, unitCost, suggestedPrice };
}

/**
 * Precio de venta a partir de un margen objetivo, redondeado HACIA ARRIBA
 * (nunca al más cercano) al múltiplo configurado — mismo criterio que
 * Madera v2: redondear al más cercano podría dejar el precio bajo el margen
 * garantizado.
 */
export function calculateTargetMarginPrice(
  unitCost: Prisma.Decimal | number,
  targetMarginPct: Prisma.Decimal | number,
  roundingMultiple: Prisma.Decimal | number,
): Prisma.Decimal {
  const cost = new Prisma.Decimal(unitCost);
  const margin = new Prisma.Decimal(targetMarginPct);
  const multiple = new Prisma.Decimal(roundingMultiple);
  if (margin.gte(1) || !multiple.gt(0)) return cost;
  const raw = cost.div(new Prisma.Decimal(1).sub(margin));
  return raw.div(multiple).ceil().mul(multiple);
}

export type RecipeInputLine = { quantity: Prisma.Decimal | number; wacSaleUnit: Prisma.Decimal | number };

export type BatchCostSummary = CostBreakdown & {
  standardMaterialsCost: Prisma.Decimal;
  standardUnitCost: Prisma.Decimal;
  /** (unitCost real / unitCost estándar) − 1 — null si no hay unidades buenas o el estándar es 0. */
  variancePct: Prisma.Decimal | null;
  /** unidadesBuenas / (unidadesBuenas + unidadesMalas) — null si no se intentó nada. */
  yieldPct: Prisma.Decimal | null;
};

/**
 * Núcleo puro del costeo de un lote (Producción v2 Fase 1 + Fase 5) — dado el
 * WAC ya resuelto de cada insumo (nunca un costo enviado por el cliente), sin
 * ningún acceso a base de datos: consumo estándar = cantidadReceta ×
 * multiplicador, valorado al WAC del sistema. El multiplicador REAL usa el
 * total intentado (buenas + malas, todo lo que realmente consumió insumos);
 * el multiplicador ESTÁNDAR usa lo planificado — con el MISMO WAC en ambos,
 * así la variancia queda explicada solo por rendimiento (merma), no por
 * cambios de precio de insumo entre la planificación y el cierre.
 */
export function computeBatchCostSummary(params: {
  recipeExpectedQuantity: Prisma.Decimal | number;
  plannedQuantity: Prisma.Decimal | number;
  producedGoodQuantity: Prisma.Decimal | number;
  producedBadQuantity: Prisma.Decimal | number;
  inputLines: RecipeInputLine[];
  laborCost: Prisma.Decimal | number;
  overheadMode: string;
  /** processingCostPerBatch: monto fijo si overheadMode=FIXED, fracción 0-1 si PCT_MAT. */
  overheadValue: Prisma.Decimal | number | null;
  targetMarginPct?: Prisma.Decimal | number | null;
}): BatchCostSummary {
  const expectedQuantity = new Prisma.Decimal(params.recipeExpectedQuantity);
  const plannedQuantity = new Prisma.Decimal(params.plannedQuantity);
  const producedGoodQuantity = new Prisma.Decimal(params.producedGoodQuantity);
  const producedBadQuantity = new Prisma.Decimal(params.producedBadQuantity);
  const totalAttempted = producedGoodQuantity.add(producedBadQuantity);

  const realMultiplier = expectedQuantity.gt(0) ? totalAttempted.div(expectedQuantity) : new Prisma.Decimal(0);
  const standardMultiplier = expectedQuantity.gt(0) ? plannedQuantity.div(expectedQuantity) : new Prisma.Decimal(0);

  const materialsCost = params.inputLines.reduce(
    (sum, line) => sum.add(new Prisma.Decimal(line.quantity).mul(realMultiplier).mul(line.wacSaleUnit)),
    new Prisma.Decimal(0),
  );
  const standardMaterialsCost = params.inputLines.reduce(
    (sum, line) => sum.add(new Prisma.Decimal(line.quantity).mul(standardMultiplier).mul(line.wacSaleUnit)),
    new Prisma.Decimal(0),
  );

  const laborCost = new Prisma.Decimal(params.laborCost);
  let overheadCost = new Prisma.Decimal(0);
  if (params.overheadMode === "FIXED" && params.overheadValue != null) {
    overheadCost = new Prisma.Decimal(params.overheadValue);
  } else if (params.overheadMode === "PCT_MAT" && params.overheadValue != null) {
    overheadCost = materialsCost.mul(new Prisma.Decimal(params.overheadValue));
  }

  const costs = calculateBatchCosts({
    materialsCost,
    laborCost,
    overheadCost,
    producedGoodQuantity,
    targetMarginPct: params.targetMarginPct ?? null,
  });

  const standardTotalCost = standardMaterialsCost.add(laborCost).add(overheadCost);
  const standardUnitCost = plannedQuantity.gt(0) ? standardTotalCost.div(plannedQuantity) : new Prisma.Decimal(0);

  const variancePct = producedGoodQuantity.gt(0) && standardUnitCost.gt(0)
    ? costs.unitCost.div(standardUnitCost).sub(1)
    : null;
  const yieldPct = totalAttempted.gt(0) ? producedGoodQuantity.div(totalAttempted) : null;

  return { ...costs, standardMaterialsCost, standardUnitCost, variancePct, yieldPct };
}
