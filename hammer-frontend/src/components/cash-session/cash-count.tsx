"use client";

import { useState } from "react";
import { money, numFixed, usdMoney } from "@/lib/format";

/** Venta: solo billetes grandes. */
const SALES_DENOMINATIONS = [1000, 500, 200, 100] as const;
/** Sencillo: billetes pequeños y monedas, se cuenta aparte (es con lo que se abre mañana). */
const FUND_BILLS = [50, 20, 10] as const;
const FUND_COINS = [5, 1, 0.5, 0.25] as const;
const FUND_DENOMINATIONS = [...FUND_BILLS, ...FUND_COINS];
const NIO_DENOMINATIONS = [...SALES_DENOMINATIONS, ...FUND_DENOMINATIONS];
/** Dólares: se anotan aparte, no suman a los córdobas. */
const USD_DENOMINATIONS = [100, 50, 20, 10, 5, 2, 1] as const;

type Currency = "NIO" | "USD";
type Counts = Record<string, string>;

function denomLabel(denom: number, currency: Currency = "NIO"): string {
  if (currency === "USD") return `US$${denom}`;
  return denom >= 1 ? `C$${denom}` : `${Math.round(denom * 100)}¢`;
}

/** Total contado: cantidad × valor, en centavos para no arrastrar 0.25 + 0.50 con basura. */
export function sumDenominations(counts: Counts, denoms: readonly number[] = NIO_DENOMINATIONS): number {
  let cents = 0;
  for (const denom of denoms) {
    const n = Number.parseInt(counts[String(denom)] ?? "", 10);
    if (Number.isFinite(n) && n > 0) cents += n * Math.round(denom * 100);
  }
  return cents / 100;
}

/** "20 × C$10, 5 × C$50, 20 × C$1": queda en la declaración y se muestra al abrir. */
export function describeDenominations(counts: Counts, denoms: readonly number[] = NIO_DENOMINATIONS, currency: Currency = "NIO"): string {
  return denoms
    .map((denom) => ({ denom, n: Number.parseInt(counts[String(denom)] ?? "", 10) }))
    .filter(({ n }) => Number.isFinite(n) && n > 0)
    .map(({ denom, n }) => `${n} × ${denomLabel(denom, currency)}`)
    .join(", ");
}

/** Cuánto equivalen los dólares en córdobas con la tasa de Master; null sin tasa. Solo se muestra, no suma. */
export function usdEquivalent(usd: number, rate: number | null): number | null {
  if (!rate || rate <= 0) return null;
  return Math.round(usd * rate * 100) / 100;
}

/** Diferencia contado − esperado redondeada a centavos; 0 = cuadra. */
export function countDifference(counted: number, expected: number): number {
  return Math.round((counted - expected) * 100) / 100 + 0; // + 0 convierte -0 en 0
}

export type CashCountResult = { total: number; sales: number; cashFund: number; cashFundNote: string; usd: number };

/**
 * Conteo de cierre a ciegas en tres partes: la venta (billetes grandes), el
 * sencillo aparte (billetes pequeños y monedas, con eso se abre mañana) y los
 * dólares aparte (no suman a los córdobas; se muestra a cuánto equivalen). No
 * muestra cuánto debería haber; la diferencia se ve después de cerrar.
 */
export function CashCount({ busy, usdRate, onConfirm }: { busy: boolean; usdRate: number | null; onConfirm: (result: CashCountResult) => void }) {
  const [sales, setSales] = useState<Counts>({});
  const [fund, setFund] = useState<Counts>({});
  const [usd, setUsd] = useState<Counts>({});
  const salesTotal = sumDenominations(sales, SALES_DENOMINATIONS);
  const fundTotal = sumDenominations(fund, FUND_DENOMINATIONS);
  const usdTotal = sumDenominations(usd, USD_DENOMINATIONS);
  const usdInNio = usdEquivalent(usdTotal, usdRate);
  const total = Math.round((salesTotal + fundTotal) * 100) / 100;
  const hasCount = [sales, fund, usd].some((c) => Object.values(c).some((v) => v.trim() !== ""));

  return (
    <div className="max-w-5xl space-y-4" data-testid="cash-count">
      <div className="grid items-start gap-3 lg:grid-cols-3">
        <CountSection
          title="Venta"
          hint="Billetes grandes"
          groups={[{ denoms: SALES_DENOMINATIONS }]}
          values={sales}
          onChange={setSales}
          busy={busy}
          footer={<SectionTotal label="Venta" value={money(salesTotal)} testId="cash-count-sales" />}
        />
        <CountSection
          title="Sencillo"
          hint="Se cuenta aparte: con esto se abre mañana"
          groups={[{ label: "Billetes pequeños", denoms: FUND_BILLS }, { label: "Monedas", denoms: FUND_COINS }]}
          values={fund}
          onChange={setFund}
          busy={busy}
          footer={<SectionTotal label="Sencillo" value={money(fundTotal)} testId="cash-count-fund" />}
        />
        <CountSection
          title="Dólares"
          hint="Aparte: no suman a los córdobas"
          groups={[{ denoms: USD_DENOMINATIONS }]}
          currency="USD"
          values={usd}
          onChange={setUsd}
          busy={busy}
          footer={
            <div className="space-y-0.5">
              <SectionTotal label="Dólares" value={usdMoney(usdTotal)} testId="cash-count-usd" />
              <p className="text-xs text-[var(--color-text-muted)]" data-testid="cash-count-usd-equivalent">
                {usdInNio !== null
                  ? <>{usdMoney(usdTotal)} equivale a <strong className="tabular-nums text-[var(--color-text)]">{money(usdInNio)}</strong> · tipo de cambio {numFixed(usdRate, 4)}</>
                  : "Sin tipo de cambio: Master lo fija en Tesorería."}
              </p>
            </div>
          }
        />
      </div>

      <dl className="space-y-1 rounded-xl border border-[var(--color-border-strong)] bg-[var(--color-surface-alt)] px-3 py-3 text-sm" aria-live="polite">
        <div className="flex justify-between gap-3">
          <dt className="text-[var(--color-text-muted)]">Venta + sencillo</dt>
          <dd className="tabular-nums text-[var(--color-text-secondary)]">{money(salesTotal)} + {money(fundTotal)}</dd>
        </div>
        <div className="flex items-baseline justify-between gap-3">
          <dt className="font-semibold text-[var(--color-text)]">Total en córdobas</dt>
          <dd className="text-2xl font-bold tabular-nums text-[var(--color-text)]" data-testid="cash-count-total">{money(total)}</dd>
        </div>
        {usdTotal > 0 ? (
          <div className="flex justify-between gap-3 border-t border-[var(--color-border)] pt-1">
            <dt className="text-[var(--color-text-muted)]">Dólares, aparte</dt>
            <dd className="text-right tabular-nums text-[var(--color-text)]">
              {usdMoney(usdTotal)}
              {usdInNio !== null ? <span className="block text-xs text-[var(--color-text-muted)]">equivale a {money(usdInNio)}</span> : null}
            </dd>
          </div>
        ) : null}
      </dl>

      <p className="text-xs text-[var(--color-text-muted)]">
        Cuenta todo lo que hay en la gaveta. Lo que debía haber y la diferencia se ven al cerrar.
      </p>

      <button
        type="button"
        className="w-full rounded-xl bg-[var(--btn-primary-bg,var(--color-info-700))] px-5 py-3 text-sm font-semibold text-white transition-colors hover:bg-[var(--btn-primary-hover,var(--color-info-600))] disabled:cursor-not-allowed disabled:opacity-50"
        onClick={() => onConfirm({ total, sales: salesTotal, cashFund: fundTotal, cashFundNote: describeDenominations(fund, FUND_DENOMINATIONS), usd: usdTotal })}
        disabled={!hasCount || busy}
        data-testid="cash-session-close"
      >
        {busy ? "Cerrando…" : hasCount ? `Cerrar caja con ${money(total)}${usdTotal > 0 ? ` y ${usdMoney(usdTotal)}` : ""}` : "Anota cuántos billetes y monedas hay"}
      </button>
    </div>
  );
}

function CountSection({ title, hint, groups, currency = "NIO", values, onChange, busy, footer }: {
  title: string;
  hint: string;
  groups: Array<{ label?: string; denoms: readonly number[] }>;
  currency?: Currency;
  values: Counts;
  onChange: (update: (current: Counts) => Counts) => void;
  busy: boolean;
  footer: React.ReactNode;
}) {
  return (
    <section className="overflow-hidden rounded-xl border border-[var(--color-border)]" aria-label={title}>
      <header className="bg-[var(--color-surface-alt)] px-3 py-2">
        <h3 className="text-sm font-semibold text-[var(--color-text)]">{title}</h3>
        <p className="text-xs text-[var(--color-text-muted)]">{hint}</p>
      </header>
      {groups.map((group) => (
        <div key={group.label ?? title}>
          {group.label ? <p className="border-t border-[var(--color-border)] px-3 pt-2 text-xs font-semibold text-[var(--color-text-muted)]">{group.label}</p> : null}
          <ul className="divide-y divide-[var(--color-border)]">
            {group.denoms.map((denom) => (
              <li key={denom} className="grid grid-cols-[4.5rem_minmax(0,1fr)] items-center gap-2 px-3 py-1.5">
                <span className="text-sm font-semibold tabular-nums text-[var(--color-text)]">{denomLabel(denom, currency)}</span>
                <input
                  className="hm-input min-w-0 rounded-lg text-right tabular-nums"
                  type="number"
                  inputMode="numeric"
                  min="0"
                  step="1"
                  placeholder="0"
                  value={values[String(denom)] ?? ""}
                  onChange={(e) => onChange((c) => ({ ...c, [String(denom)]: e.target.value }))}
                  aria-label={`${title}: cantidad de ${denomLabel(denom, currency)}`}
                  disabled={busy}
                />
              </li>
            ))}
          </ul>
        </div>
      ))}
      <div className="border-t border-[var(--color-border-strong)] bg-[var(--color-surface-alt)] px-3 py-2">{footer}</div>
    </section>
  );
}

function SectionTotal({ label, value, testId }: { label: string; value: string; testId: string }) {
  return (
    <div className="flex justify-between gap-3 text-sm">
      <span className="text-[var(--color-text-muted)]">{label}</span>
      <span className="font-semibold tabular-nums text-[var(--color-text)]" data-testid={testId}>{value}</span>
    </div>
  );
}
