import type { CashIndicatorState } from "@/components/navigation/cash-indicator-panel";

/**
 * prompt-tesoreria-sin-transito.md Fase 2 — SOLO en la pantalla de
 * Tesorería (master/treasury/page.tsx): IN_TRANSIT_ONLY (nada acumulado,
 * pero algo en tránsito) se ve como CLEAR. Tesorería es el punto final del
 * retenido — el tránsito es del día, ya no se muestra ahí, así que tampoco
 * tiene sentido que siga marcando "necesita atención". No toca
 * computeCashIndicatorState (backend) ni las vistas del día
 * (cash-indicator-panel.tsx, cash-accumulation-bar.tsx, money-week), donde
 * ese estado sigue siendo información real y visible.
 *
 * En su propio archivo (no exportada desde page.tsx) porque un route file
 * de Next.js solo puede exportar nombres reservados (default, metadata,
 * generateStaticParams, …) — cualquier otro export ahí rompe el tipado de
 * la ruta.
 */
export function treasuryVisibleState(state: CashIndicatorState): CashIndicatorState {
  return state === "IN_TRANSIT_ONLY" ? "CLEAR" : state;
}
