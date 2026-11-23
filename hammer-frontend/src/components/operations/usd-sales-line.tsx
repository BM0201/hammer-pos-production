import { DollarSign } from "lucide-react";
import { money, usdMoney } from "@/lib/format";

/** Cobros en dólares del período, tal como los manda el servidor (`usdSales`). Ya están dentro de "Efectivo". */
export type UsdSales = { count: number; usd: number; nio: number };

/**
 * Apartado único de "Dólares" para todas las pantallas que desglosan cobros:
 * se muestra debajo de Efectivo, nunca sumado aparte (sería contarlos dos veces).
 */
export function UsdSalesLine({ usdSales }: { usdSales?: UsdSales | null }) {
  if (!usdSales || usdSales.count === 0) return null;
  return (
    <div className="flex items-center justify-between gap-2 rounded-lg border border-dashed border-[var(--color-border-strong)] px-3 py-2">
      <div className="flex min-w-0 items-center gap-2">
        <DollarSign aria-hidden className="shrink-0 text-[var(--color-text-muted)]" style={{ width: "0.875rem", height: "0.875rem" }} />
        <div className="min-w-0">
          <span className="text-xs font-semibold text-[var(--color-text-secondary)]">Dólares</span>
          <span className="ml-1.5 text-[11px] text-[var(--color-text-muted)]">ya incluidos en Efectivo</span>
        </div>
      </div>
      <div className="text-right">
        <span className="text-sm font-bold text-[var(--color-text)]">{usdMoney(usdSales.usd)}</span>
        <span className="ml-2 text-xs text-[var(--color-text-muted)]">
          = {money(usdSales.nio)} · {usdSales.count} pago{usdSales.count !== 1 ? "s" : ""}
        </span>
      </div>
    </div>
  );
}
