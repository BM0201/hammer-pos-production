/**
 * prompt-carga-precios.md Fase 1 — "fórmulas sin duplicar": el cálculo de
 * margen `(price - cost) / price * 100` vivía copiado sin exportar en
 * current-prices-service.ts, branch-price-exception-service.ts y
 * pricing/service.ts (marginForAppliedPrice, privada). Ninguna de las tres
 * estaba exportada para reusar, así que esta es la versión canónica —
 * nueva, no una extracción de una ya existente — para que la carga de
 * precios (y cualquiera después) la importe en vez de copiarla una cuarta
 * vez. Los 3 call sites existentes NO se tocan (fuera de alcance de este
 * doc); documentado acá por si alguien los unifica después.
 */
export function computeMarginPercent(
  cost: number | null | undefined,
  price: number | null | undefined,
): number | null {
  if (cost == null || cost <= 0 || price == null || price <= 0) return null;
  return ((price - cost) / price) * 100;
}

/** Cambio porcentual de `from` a `to` — null si `from` no es positivo (no hay base para comparar). */
export function computePercentChange(
  from: number | null | undefined,
  to: number | null | undefined,
): number | null {
  if (from == null || from <= 0 || to == null) return null;
  return ((to - from) / from) * 100;
}
