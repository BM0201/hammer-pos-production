/**
 * Auditoría 2026-07-22 (ALTO Catálogo): el bloqueo de "precio bajo costo" solo
 * existía en el motor de pricing (applySuggestedPrice) y en checkout
 * (discount-policy.ts) — faltaba en los 3 caminos de edición de catálogo
 * (producto global, precio inline por sucursal, importación Excel), donde un
 * precio menor al costo podía guardarse sin ningún aviso ni bloqueo.
 *
 * A diferencia del checkout (donde SÍ existe un override para Master con
 * justificación, porque puede haber una urgencia real de venta), aquí no hay
 * apuro: quien edita el catálogo puede simplemente corregir el costo y el
 * precio juntos. Por eso el bloqueo aquí es incondicional, sin override.
 */
export function assertPriceNotBelowCost(input: {
  price: number | null | undefined;
  cost: number | null | undefined;
}): void {
  if (input.price === null || input.price === undefined) return;
  if (input.cost === null || input.cost === undefined || input.cost <= 0) return;
  if (input.price < input.cost) {
    const error = new Error("BELOW_COST_NOT_ALLOWED");
    (error as Error & { details?: unknown }).details = { price: input.price, cost: input.cost };
    throw error;
  }
}

/**
 * prompt-costos-precios-fusion.md §2.1: el costo de un miembro DERIVADO de
 * una fusión vive en el canónico, nunca en el miembro. Se rechaza la carga
 * a mano en vez de tolerarla — es exactamente el mecanismo que produjo el
 * desfase de 18.6× del ejemplo de arena (un globalCost de relleno en la
 * LATA le ganaba en prioridad al WAC correcto del canónico). Sin excepción:
 * ni edición de producto, ni importación Excel, pueden escribir costo aquí.
 */
export function assertNotFusionMemberCostWrite(conversion: { isCanonical: boolean } | null | undefined): void {
  if (conversion && !conversion.isCanonical) {
    throw new Error("FUSION_COST_WRITE_NOT_ALLOWED");
  }
}
