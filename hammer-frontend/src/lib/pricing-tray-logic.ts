/**
 * Parte C.4 (prompt-completo-pendientes-2026-10.md) — "la Bandeja como mesa
 * de decisión": toda la lógica pura del rediseño, sin React ni fetch, para
 * poder probarla con números a mano.
 */

export type GainBreakdown = { gainAmount: number | null; marginOnPrice: number | null; markupOnCost: number | null };
export type GainOrderPreference = "cost" | "price";

const GAIN_ORDER_STORAGE_KEY = "hammer_pricing_tray_gain_order";

/** Qué % se muestra primero en "C$ 12.50 · 8.3% s/costo · 7.7% s/precio" — por defecto, sobre costo. */
export function readGainOrderPreference(): GainOrderPreference {
  if (typeof window === "undefined") return "cost";
  try {
    const raw = window.localStorage.getItem(GAIN_ORDER_STORAGE_KEY);
    return raw === "price" ? "price" : "cost";
  } catch {
    return "cost";
  }
}

export function writeGainOrderPreference(pref: GainOrderPreference): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(GAIN_ORDER_STORAGE_KEY, pref);
  } catch {
    /* localStorage no disponible (SSR, privacidad) */
  }
}

export function computeGainBreakdown(price: number | null, cost: number | null): GainBreakdown {
  if (price === null || cost === null) return { gainAmount: null, marginOnPrice: null, markupOnCost: null };
  const gainAmount = Math.round((price - cost) * 100) / 100;
  const marginOnPrice = price > 0 ? Math.round(((price - cost) / price) * 10000) / 100 : null;
  const markupOnCost = cost > 0 ? Math.round(((price - cost) / cost) * 10000) / 100 : null;
  return { gainAmount, marginOnPrice, markupOnCost };
}

/** "C$ 12.50 · 8.3% s/costo · 7.7% s/precio" (o el orden invertido, según preferencia). */
export function formatGainThreeWays(gain: GainBreakdown, preference: GainOrderPreference, money: (n: number) => string): string {
  if (gain.gainAmount === null) return "—";
  const costPart = gain.markupOnCost !== null ? `${gain.markupOnCost.toFixed(1)}% s/costo` : "— s/costo";
  const pricePart = gain.marginOnPrice !== null ? `${gain.marginOnPrice.toFixed(1)}% s/precio` : "— s/precio";
  const ordered = preference === "price" ? [pricePart, costPart] : [costPart, pricePart];
  return `${money(gain.gainAmount)} · ${ordered[0]} · ${ordered[1]}`;
}

export type PriceColorState = "BELOW_COST" | "BELOW_MIN" | "OK" | "UNKNOWN";

/** "Colores (tokens del tema, con color y texto): bajo el costo rojo; debajo del mínimo ámbar; dentro verde." */
export function priceColorState(price: number | null, cost: number | null, minMarginPercent: number | null): PriceColorState {
  if (price === null || cost === null || price <= 0 || cost <= 0) return "UNKNOWN";
  if (price <= cost) return "BELOW_COST";
  if (minMarginPercent !== null) {
    const marginPct = ((price - cost) / price) * 100;
    if (marginPct < minMarginPercent) return "BELOW_MIN";
  }
  return "OK";
}

/** "un '→' si el precio nuevo se aleja más de 5 puntos del margen realizado". */
export function shouldWarnRealizedGap(newPriceMarginPct: number | null, realizedMarginPct: number | null): boolean {
  if (newPriceMarginPct === null || realizedMarginPct === null) return false;
  return Math.abs(newPriceMarginPct - realizedMarginPct) > 5;
}

/** "Enter... aplica (con confirmación si sube o baja más de 30%)". */
export function shouldConfirmBigChange(oldPrice: number | null, newPrice: number | null): boolean {
  if (oldPrice === null || oldPrice <= 0 || newPrice === null) return false;
  return Math.abs((newPrice - oldPrice) / oldPrice) * 100 > 30;
}

export type BatchSummary = { count: number; upCount: number; downCount: number; sameCount: number; avgBefore: number; avgAfter: number };

/** Resumen del pie: "2 productos · 1 sube · 1 baja · promedio antes → después". */
export function buildBatchSummary(items: Array<{ previousPrice: number | null; newPrice: number | null }>): BatchSummary {
  const valid = items.filter((i): i is { previousPrice: number; newPrice: number } => i.previousPrice !== null && i.newPrice !== null);
  let upCount = 0;
  let downCount = 0;
  let sameCount = 0;
  for (const item of valid) {
    if (item.newPrice > item.previousPrice) upCount += 1;
    else if (item.newPrice < item.previousPrice) downCount += 1;
    else sameCount += 1;
  }
  const avgBefore = valid.length > 0 ? valid.reduce((sum, i) => sum + i.previousPrice, 0) / valid.length : 0;
  const avgAfter = valid.length > 0 ? valid.reduce((sum, i) => sum + i.newPrice, 0) / valid.length : 0;
  return { count: items.length, upCount, downCount, sameCount, avgBefore, avgAfter };
}

export type PriceApplyMethod = "MANUAL" | "SUGGESTED" | "REALIZED_MARGIN" | "KEEP_GAIN_AMOUNT" | "KEEP_MARGIN_PCT" | "OTHER_BRANCH" | "POLICY_MIN";
export type ReferenceLike = { method: PriceApplyMethod; price: number | null; available: boolean };

/** "Usar método ▾ en seleccionadas": el precio de ESE método, solo donde está disponible — las demás no se tocan. */
export function priceForMethod(references: ReferenceLike[], method: PriceApplyMethod): number | null {
  const ref = references.find((r) => r.method === method);
  return ref && ref.available ? ref.price : null;
}

/** "12" o "=12" (estilo hoja de cálculo) → 12. null = no es un precio válido. */
export function parsePriceInput(raw: string): number | null {
  const trimmed = raw.trim();
  const withoutEquals = trimmed.startsWith("=") ? trimmed.slice(1).trim() : trimmed;
  if (withoutEquals === "") return null;
  const n = Number(withoutEquals);
  return Number.isFinite(n) && n >= 0 ? n : null;
}
