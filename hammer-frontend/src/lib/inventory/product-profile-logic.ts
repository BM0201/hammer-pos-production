/**
 * Perfil de producto (rediseño de Inventario, Fase 2) — lógica pura de las
 * pestañas y del bloque "Para atender" del Resumen, separada del componente
 * para poder probarla sin DOM.
 */

export type ProfileTab = "general" | "pricing" | "stock" | "movements" | "barcodes" | "activity";

const PROFILE_TABS: readonly ProfileTab[] = ["general", "pricing", "stock", "movements", "barcodes", "activity"];

/** Pestañas retiradas (9 → 6): sus links viejos caen en la pestaña que ahora las contiene. */
const LEGACY_PROFILE_TABS: Record<string, ProfileTab> = {
  wacHistory: "pricing",
  priceHistory: "pricing",
  brain: "activity",
  audit: "activity",
};

export function resolveProfileTab(raw: string | null): ProfileTab {
  if (!raw) return "general";
  if (LEGACY_PROFILE_TABS[raw]) return LEGACY_PROFILE_TABS[raw];
  return (PROFILE_TABS as readonly string[]).includes(raw) ? (raw as ProfileTab) : "general";
}

/** Decisiones del Brain que todavía esperan a alguien (el resto ya se cerró de una u otra forma). */
const OPEN_BRAIN_STATUSES = new Set(["OPEN", "MANUAL_REVIEW"]);

export function countOpenBrainDecisions(decisions: Array<{ status: string }>): number {
  return decisions.filter((d) => OPEN_BRAIN_STATUSES.has(d.status)).length;
}

export type AttentionItem = { key: string; label: string; action: string; tab: ProfileTab };

export type AttentionInput = {
  /** Código de la sucursal elegida; null = "Toda la red" (costo, precio y mínimo no aplican). */
  branchCode: string | null;
  effectiveCost: number | null;
  effectivePrice: number | null;
  marginPercent: number | null;
  hasBarcode: boolean;
  stockInScope: number;
  /** minQuantity de la política de reposición de esa sucursal; null si no hay política. */
  minQuantity: number | null;
  openBrainDecisions: number;
};

/** Margen por debajo del cual se avisa — el mismo corte que pinta ámbar en la Lista (marginBadgeVariant). */
const LOW_MARGIN_PERCENT = 20;

/** Color del margen: mismos cortes que marginBadgeVariant de la Lista (<0 rojo, <20 ámbar). */
export function marginTone(value: number | null): "neutral" | "danger" | "warning" | "success" {
  if (value === null) return "neutral";
  if (value < 0) return "danger";
  if (value < LOW_MARGIN_PERCENT) return "warning";
  return "success";
}

export function buildAttentionItems(input: AttentionInput): AttentionItem[] {
  const items: AttentionItem[] = [];
  const where = input.branchCode ? ` en ${input.branchCode}` : "";

  if (input.branchCode) {
    if (input.effectiveCost === null) {
      items.push({ key: "no-cost", label: `Sin costo${where}: no se puede medir la ganancia`, action: "Ver costos", tab: "pricing" });
    }
    if (input.effectivePrice === null) {
      items.push({ key: "no-price", label: `Sin precio de venta${where}`, action: "Poner precio", tab: "pricing" });
    } else if (input.marginPercent !== null && input.marginPercent < LOW_MARGIN_PERCENT) {
      const label = input.marginPercent < 0
        ? `Se vende bajo el costo${where} (${input.marginPercent.toFixed(1)}%)`
        : `Margen ${input.marginPercent.toFixed(1)}%${where}, bajo el ${LOW_MARGIN_PERCENT}%`;
      items.push({ key: "low-margin", label, action: "Revisar precio", tab: "pricing" });
    }
    if (input.minQuantity !== null && input.minQuantity > 0 && input.stockInScope <= input.minQuantity) {
      items.push({ key: "low-stock", label: `Stock${where} en el mínimo o debajo (mín ${input.minQuantity})`, action: "Ver existencias", tab: "stock" });
    }
  }
  if (!input.hasBarcode) {
    items.push({ key: "no-code", label: "Sin código de barras", action: "Agregar código", tab: "barcodes" });
  }
  if (input.openBrainDecisions > 0) {
    const n = input.openBrainDecisions;
    items.push({ key: "brain", label: n === 1 ? "1 alerta del Brain abierta" : `${n} alertas del Brain abiertas`, action: "Ver actividad", tab: "activity" });
  }
  return items;
}
