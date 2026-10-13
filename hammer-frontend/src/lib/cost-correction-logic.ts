/**
 * D · Fase 2 (prompt-completo-pendientes-2026-10.md) — lógica pura de la
 * hoja "Revisar y aplicar": sin React ni fetch, para poder probarla con
 * números a mano, mismo principio que pricing-tray-logic.ts.
 */

export type CorrectionMode = "AUTO" | "MANUAL";
export type CostAction = "SET_BRANCH_COST" | "CLEAR_BRANCH_COST" | "SET_GLOBAL_COST" | "SET_AVERAGE_COST";

/** "si sube más de 50%, aviso: 'Sube más del 50%. ¿El costo está bien?'" (modo Automático, 2.2) — distinto del ±30% de requestApply (ese es tras aplicar; este es ANTES, para desconfiar del costo). */
export function shouldWarnSuggestedIncrease(oldPrice: number | null, newPrice: number | null): boolean {
  if (oldPrice === null || oldPrice <= 0 || newPrice === null) return false;
  return (newPrice - oldPrice) / oldPrice > 0.5;
}

/** "en rojo y SIN PODER CONFIRMAR si el precio queda bajo el costo" (2.2, modo Manual). keepPrice nunca se bloquea por precio: no se toca. */
export function canConfirmCorrectionItem(input: { keepPrice: boolean; mode: CorrectionMode; price: number | null; cost: number | null }): boolean {
  if (input.keepPrice) return true;
  if (input.mode === "AUTO") return true; // el precio se recalcula en el servidor con el costo nuevo — nada que bloquear acá.
  if (input.price === null) return false;
  if (input.cost !== null && input.price < input.cost) return false;
  return true;
}

export type CorrectionItemSummaryInput = { removed: boolean; costChanged: boolean; keepPrice: boolean; previousPrice: number | null; newPrice: number | null };
export type CorrectionSummary = { count: number; costCorrectedCount: number; priceUpCount: number; priceDownCount: number; sameCount: number };

/** "2 productos · 1 costo corregido · 1 precio sube · 1 sin cambio" (2.3). */
export function buildCorrectionSummary(items: CorrectionItemSummaryInput[]): CorrectionSummary {
  const active = items.filter((i) => !i.removed);
  let costCorrectedCount = 0;
  let priceUpCount = 0;
  let priceDownCount = 0;
  let sameCount = 0;
  for (const item of active) {
    if (item.costChanged) costCorrectedCount += 1;
    if (item.keepPrice || item.previousPrice === null || item.newPrice === null || item.previousPrice === item.newPrice) {
      sameCount += 1;
      continue;
    }
    if (item.newPrice > item.previousPrice) priceUpCount += 1;
    else priceDownCount += 1;
  }
  return { count: active.length, costCorrectedCount, priceUpCount, priceDownCount, sameCount };
}

export type CorrectionPayloadItem = {
  decisionId: string;
  mode: CorrectionMode;
  cost?: { action: CostAction; value?: number };
  price?: number;
  keepPrice?: boolean;
  alsoBranchIds?: string[];
};

/** Arma el payload de POST /api/master/pricing/tray/correct para UN producto, según su modo. */
export function buildCorrectionPayloadItem(input: {
  decisionId: string;
  mode: CorrectionMode;
  costAction: CostAction | null;
  costValue: number | null;
  price: number | null;
  keepPrice: boolean;
  alsoBranchIds?: string[];
}): CorrectionPayloadItem {
  const item: CorrectionPayloadItem = { decisionId: input.decisionId, mode: input.mode };
  if (input.costAction) {
    item.cost = input.costAction === "CLEAR_BRANCH_COST"
      ? { action: input.costAction }
      : { action: input.costAction, value: input.costValue ?? undefined };
  }
  if (input.keepPrice) {
    item.keepPrice = true;
  } else if (input.mode === "MANUAL" && input.price !== null) {
    item.price = input.price;
  }
  if (input.alsoBranchIds && input.alsoBranchIds.length > 0) item.alsoBranchIds = input.alsoBranchIds;
  return item;
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

function priceForMargin(cost: number, marginPercent: number | null): number | null {
  if (marginPercent === null || marginPercent >= 100) return null;
  return round2(cost / (1 - marginPercent / 100));
}

export type LiveReferencePrices = {
  suggested: number | null;
  policyMin: number | null;
  realizedMargin: number | null;
  keepGainAmount: number | null;
  keepMarginPct: number | null;
};

/**
 * "Precio... recalculados CON EL COSTO DEL INPUT en vivo" (2.2, modo
 * Manual) — mismas fórmulas que price-references.ts (precio = costo / (1 −
 * margen/100); "misma ganancia" = costoNuevo + gananciaVieja), para no
 * esperar un round-trip al servidor en cada tecla. Vista previa para los
 * chips de "usar este" — el número final siempre lo valida el servidor.
 */
export function recalculateReferencePrices(input: {
  newCost: number;
  oldCost: number | null;
  oldPrice: number | null;
  recommendedMarginPercent: number | null;
  minMarginPercent: number | null;
  realizedMarginPct: number | null;
}): LiveReferencePrices {
  const oldMarginPct = input.oldCost !== null && input.oldPrice !== null && input.oldPrice > 0
    ? ((input.oldPrice - input.oldCost) / input.oldPrice) * 100
    : null;
  return {
    suggested: priceForMargin(input.newCost, input.recommendedMarginPercent),
    policyMin: priceForMargin(input.newCost, input.minMarginPercent),
    realizedMargin: priceForMargin(input.newCost, input.realizedMarginPct),
    keepGainAmount: input.oldCost !== null && input.oldPrice !== null ? round2(input.newCost + (input.oldPrice - input.oldCost)) : null,
    keepMarginPct: priceForMargin(input.newCost, oldMarginPct),
  };
}
