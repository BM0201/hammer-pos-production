"use client";

import { useState } from "react";
import { money } from "@/lib/format";

/** Billetes y monedas en córdobas, de mayor a menor (el 10 es billete y moneda: se cuenta junto). */
const NIO_DENOMINATIONS = [1000, 500, 200, 100, 50, 20, 10, 5, 1, 0.5, 0.25, 0.1] as const;
/** El sencillo se arma con billetes chicos y monedas. */
const MAX_CASH_FUND_DENOMINATION = 100;

function denomLabel(denom: number): string {
  return denom >= 1 ? `C$${denom}` : `${Math.round(denom * 100)}¢`;
}

/** Total contado por billetes: cantidad × valor, en centavos para no arrastrar 0.1 + 0.2. */
export function sumDenominations(counts: Record<string, string>): number {
  let cents = 0;
  for (const denom of NIO_DENOMINATIONS) {
    const n = Number.parseInt(counts[String(denom)] ?? "", 10);
    if (Number.isFinite(n) && n > 0) cents += n * Math.round(denom * 100);
  }
  return cents / 100;
}

/** "20 × C$10, 5 × C$50, 20 × C$1": queda en la declaración y se muestra al abrir. */
export function describeDenominations(counts: Record<string, string>): string {
  return NIO_DENOMINATIONS
    .map((denom) => ({ denom, n: Number.parseInt(counts[String(denom)] ?? "", 10) }))
    .filter(({ n }) => Number.isFinite(n) && n > 0)
    .map(({ denom, n }) => `${n} × ${denomLabel(denom)}`)
    .join(", ");
}

/** Diferencia contado − esperado redondeada a centavos; 0 = cuadra. */
export function countDifference(counted: number, expected: number): number {
  return Math.round((counted - expected) * 100) / 100 + 0; // + 0 convierte -0 en 0
}

export type CashCountResult = { total: number; sales: number; cashFund: number; cashFundNote: string };

/**
 * Conteo de cierre a ciegas, por billetes y monedas, en dos columnas: lo de la
 * venta y el sencillo que se queda para abrir mañana. No muestra cuánto
 * debería haber (para que el conteo no se acomode a la cifra); la diferencia
 * se ve después de cerrar.
 */
export function CashCount({ busy, onConfirm }: { busy: boolean; onConfirm: (result: CashCountResult) => void }) {
  const [sales, setSales] = useState<Record<string, string>>({});
  const [fund, setFund] = useState<Record<string, string>>({});
  const salesTotal = sumDenominations(sales);
  const fundTotal = sumDenominations(fund);
  const total = Math.round((salesTotal + fundTotal) * 100) / 100;
  const hasCount = [...Object.values(sales), ...Object.values(fund)].some((v) => v.trim() !== "");

  const input = (denom: number, values: Record<string, string>, set: typeof setSales, kind: "venta" | "sencillo") => (
    <input
      className="hm-input min-w-0 rounded-lg text-right tabular-nums"
      type="number"
      inputMode="numeric"
      min="0"
      step="1"
      placeholder="0"
      value={values[String(denom)] ?? ""}
      onChange={(e) => set((c) => ({ ...c, [String(denom)]: e.target.value }))}
      aria-label={`${kind === "venta" ? "Venta" : "Sencillo"}: cantidad de ${denomLabel(denom)}`}
      disabled={busy}
    />
  );

  return (
    <div className="max-w-xl space-y-4" data-testid="cash-count">
      <div className="overflow-hidden rounded-xl border border-[var(--color-border)]">
        <div className="grid grid-cols-[4rem_1fr_1fr] items-end gap-2 bg-[var(--color-surface-alt)] px-3 py-2 text-xs font-semibold text-[var(--color-text-muted)] sm:gap-3">
          <span>Billete</span>
          <span className="text-right">Venta</span>
          <span className="text-right">Sencillo<span className="block font-normal">para abrir mañana</span></span>
        </div>
        <ul className="divide-y divide-[var(--color-border)]">
          {NIO_DENOMINATIONS.map((denom) => (
            <li key={denom} className="grid grid-cols-[4rem_1fr_1fr] items-center gap-2 px-3 py-1.5 sm:gap-3">
              <span className="text-sm font-semibold tabular-nums text-[var(--color-text)]">{denomLabel(denom)}</span>
              {input(denom, sales, setSales, "venta")}
              {denom <= MAX_CASH_FUND_DENOMINATION
                ? input(denom, fund, setFund, "sencillo")
                : <span className="text-right text-sm text-[var(--color-text-soft)]" aria-hidden="true">—</span>}
            </li>
          ))}
        </ul>
        <dl className="space-y-1 border-t border-[var(--color-border-strong)] bg-[var(--color-surface-alt)] px-3 py-3 text-sm" aria-live="polite">
          <div className="flex justify-between gap-3">
            <dt className="text-[var(--color-text-muted)]">Venta</dt>
            <dd className="font-semibold tabular-nums text-[var(--color-text)]" data-testid="cash-count-sales">{money(salesTotal)}</dd>
          </div>
          <div className="flex justify-between gap-3">
            <dt className="text-[var(--color-text-muted)]">Sencillo</dt>
            <dd className="font-semibold tabular-nums text-[var(--color-text)]" data-testid="cash-count-fund">{money(fundTotal)}</dd>
          </div>
          <div className="flex items-baseline justify-between gap-3 pt-1">
            <dt className="font-semibold text-[var(--color-text)]">Total contado</dt>
            <dd className="text-2xl font-bold tabular-nums text-[var(--color-text)]" data-testid="cash-count-total">{money(total)}</dd>
          </div>
        </dl>
      </div>

      <p className="text-xs text-[var(--color-text-muted)]">
        Cuenta todo lo que hay en la gaveta. El sencillo se queda para abrir mañana; lo que debía haber y la diferencia se ven al cerrar.
      </p>

      <button
        type="button"
        className="w-full rounded-xl bg-[var(--btn-primary-bg,var(--color-info-700))] px-5 py-3 text-sm font-semibold text-white transition-colors hover:bg-[var(--btn-primary-hover,var(--color-info-600))] disabled:cursor-not-allowed disabled:opacity-50"
        onClick={() => onConfirm({ total, sales: salesTotal, cashFund: fundTotal, cashFundNote: describeDenominations(fund) })}
        disabled={!hasCount || busy}
        data-testid="cash-session-close"
      >
        {busy ? "Cerrando…" : hasCount ? `Cerrar caja con ${money(total)}` : "Anota cuántos billetes y monedas hay"}
      </button>
    </div>
  );
}
