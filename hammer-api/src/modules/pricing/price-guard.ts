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
  // Bug reportado (prompt: "revisa este bug eliminalo", captura de Precios y
  // costos) — precio 0 no es un precio real fijado a propósito, es "nadie lo
  // puso" (mismo criterio ya aplicado a `cost` dos líneas abajo, y a
  // computeHasNoPrice en catalog-inventory/service.ts). Sin esto, CUALQUIER
  // producto que vive de precios por sucursal (standardSalePrice jamás
  // configurado, efectivamente 0 — el caso normal, no la excepción) bloqueaba
  // TODO intento de fijar un costo de compra positivo desde updateProduct:
  // `0 < costo` siempre da true, así que 0 nunca superaba el early-return de
  // `cost` y el guard reventaba comparando contra un precio que ni existe ni
  // es el que realmente se cobra (ese vive en BranchProductSetting.branchPrice,
  // que este guard no ve). El mismo criterio evita el falso positivo simétrico
  // en la importación Excel (fila con precio 0 = "sin precio general", no
  // "vender gratis").
  if (input.price <= 0) return;
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
