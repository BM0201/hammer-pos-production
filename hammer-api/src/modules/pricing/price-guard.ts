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
