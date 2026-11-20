"use client";

import { useState } from "react";
import { money } from "@/lib/format";

/** Billetes y monedas en córdobas, de mayor a menor (el 10 es billete y moneda: se cuenta junto). */
const NIO_DENOMINATIONS = [1000, 500, 200, 100, 50, 20, 10, 5, 1, 0.5, 0.25, 0.1] as const;

/** Total contado por billetes: cantidad × valor, en centavos para no arrastrar 0.1 + 0.2. */
export function sumDenominations(counts: Record<string, string>): number {
  let cents = 0;
  for (const denom of NIO_DENOMINATIONS) {
    const n = Number.parseInt(counts[String(denom)] ?? "", 10);
    if (Number.isFinite(n) && n > 0) cents += n * Math.round(denom * 100);
  }
  return cents / 100;
}

/** Diferencia contado − esperado redondeada a centavos; 0 = cuadra. */
export function countDifference(counted: number, expected: number): number {
  return Math.round((counted - expected) * 100) / 100 + 0; // + 0 convierte -0 en 0
}

/**
 * Conteo de la gaveta al cerrar el turno. Arranca vacío (antes arrancaba en
 * 0 y un toque de más cerraba la caja con C$0) y muestra la diferencia
 * mientras se cuenta, para recontar antes de confirmar.
 */
export function CashCount({
  expected,
  busy,
  onConfirm,
}: {
  expected: number | null;
  busy: boolean;
  onConfirm: (counted: number) => void;
}) {
  const [mode, setMode] = useState<"total" | "bills">("total");
  const [total, setTotal] = useState("");
  const [counts, setCounts] = useState<Record<string, string>>({});

  const typedTotal = Number.parseFloat(total);
  const counted = mode === "bills" ? sumDenominations(counts) : typedTotal;
  const hasCount = mode === "bills" ? Object.values(counts).some((v) => v.trim() !== "") : total.trim() !== "" && Number.isFinite(typedTotal) && typedTotal >= 0;
  const diff = hasCount && expected !== null ? countDifference(counted, expected) : null;

  const tabClass = (active: boolean) =>
    `flex-1 rounded-lg px-3 py-2 text-sm font-semibold transition-colors pointer-coarse:py-2.5 ${
      active ? "bg-[var(--color-surface)] text-[var(--color-text)] shadow-sm" : "text-[var(--color-text-muted)] hover:text-[var(--color-text)]"
    }`;

  return (
    <div className="space-y-4" data-testid="cash-count">
      <div className="flex rounded-xl bg-[var(--color-surface-alt)] p-1" role="tablist" aria-label="Forma de contar">
        <button type="button" role="tab" aria-selected={mode === "total"} className={tabClass(mode === "total")} onClick={() => setMode("total")}>
          Total contado
        </button>
        <button type="button" role="tab" aria-selected={mode === "bills"} className={tabClass(mode === "bills")} onClick={() => setMode("bills")}>
          Por billetes
        </button>
      </div>

      {mode === "total" ? (
        <label className="block">
          <span className="mb-1 block text-xs font-medium text-[var(--color-text-muted)]">Efectivo contado en la gaveta (C$)</span>
          <input
            className="hm-input rounded-xl text-lg font-semibold tabular-nums"
            type="number"
            inputMode="decimal"
            min="0"
            step="0.01"
            value={total}
            onChange={(e) => setTotal(e.target.value)}
            placeholder="0.00"
            disabled={busy}
            autoFocus
            data-testid="cash-count-total"
          />
        </label>
      ) : (
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-4">
          {NIO_DENOMINATIONS.map((denom) => (
            <label key={denom} className="flex items-center gap-2 rounded-xl border border-[var(--color-border)] bg-[var(--color-surface)] px-3 py-1.5">
              <span className="w-14 shrink-0 text-sm font-semibold tabular-nums text-[var(--color-text)]">{denom >= 1 ? `C$${denom}` : `${denom * 100}¢`}</span>
              <span className="text-xs text-[var(--color-text-muted)]" aria-hidden>×</span>
              <input
                className="hm-input min-w-0 flex-1 rounded-lg text-right tabular-nums"
                type="number"
                inputMode="numeric"
                min="0"
                step="1"
                value={counts[String(denom)] ?? ""}
                onChange={(e) => setCounts((c) => ({ ...c, [String(denom)]: e.target.value }))}
                aria-label={`Cantidad de ${denom >= 1 ? `C$${denom}` : `${denom * 100} centavos`}`}
                disabled={busy}
              />
            </label>
          ))}
        </div>
      )}

      <dl className="grid grid-cols-3 gap-2 rounded-xl border border-[var(--color-border)] bg-[var(--color-surface-alt)] p-3 text-center">
        <div>
          <dt className="text-xs text-[var(--color-text-muted)]">Debe haber</dt>
          <dd className="text-sm font-semibold tabular-nums text-[var(--color-text)]">{expected === null ? "—" : money(expected)}</dd>
        </div>
        <div>
          <dt className="text-xs text-[var(--color-text-muted)]">Contado</dt>
          <dd className="text-sm font-semibold tabular-nums text-[var(--color-text)]">{hasCount ? money(counted) : "—"}</dd>
        </div>
        <div aria-live="polite">
          <dt className="text-xs text-[var(--color-text-muted)]">Diferencia</dt>
          <dd
            className={`text-sm font-bold tabular-nums ${
              diff === null ? "text-[var(--color-text-muted)]" : diff === 0 ? "text-[var(--color-success-700)]" : "text-[var(--color-danger-700)]"
            }`}
          >
            {diff === null ? "—" : diff === 0 ? "Cuadra" : `${diff > 0 ? "Sobran" : "Faltan"} ${money(Math.abs(diff))}`}
          </dd>
        </div>
      </dl>
      {diff !== null && diff !== 0 ? (
        <p className="text-xs text-[var(--color-text-muted)]">Vuelve a contar antes de confirmar. Si la diferencia se mantiene, queda registrada para revisión.</p>
      ) : null}

      <button
        type="button"
        className="w-full rounded-xl bg-[var(--btn-primary-bg,var(--color-info-700))] px-5 py-3 text-sm font-semibold text-white transition-colors hover:bg-[var(--btn-primary-hover,var(--color-info-600))] disabled:cursor-not-allowed disabled:opacity-50"
        onClick={() => onConfirm(counted)}
        disabled={!hasCount || busy}
        data-testid="cash-session-close"
      >
        {busy ? "Cerrando…" : hasCount ? `Cerrar caja con ${money(counted)}` : "Anota lo contado para cerrar"}
      </button>
    </div>
  );
}
