"use client";

import { useCallback, useEffect, useState } from "react";
import { ChevronLeft, ChevronRight, Wallet, ArrowLeftRight, CreditCard, TrendingUp, TrendingDown, AlertTriangle, Send, Users } from "lucide-react";
import { apiFetch, unwrapApiData } from "@/lib/client/api";
import { useSession } from "@/lib/client/session";
import { getActiveBranchId } from "@/lib/client/active-branch";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { SendDepositModal, type CashPosition, type CashIndicatorState } from "@/components/navigation/cash-indicator-panel";

/**
 * "Dinero de la semana" (Admin de Sucursal, prompt-modulo-dinero-semana-
 * sucursal.md) — no es otro reporte de ventas: dice DÓNDE está cada córdoba
 * cobrado y DE QUIÉN es la responsabilidad de moverlo. Todo sale de
 * getBranchMoneySummary — la misma fuente que usa Tesorería de Master (§4),
 * así que si algún día los dos números no coinciden, el bug está en cómo se
 * llama al servicio, nunca en dos cálculos que divergieron.
 */

type MoneyByMethod = { cash: number; transfer: number; card: number; other: number; total: number };
type DayRow = MoneyByMethod & { businessDate: string };
type InTransitEntry = { custodyAccountId: string; holderUserId: string | null; holderName: string; amount: number; sinceDate: string | null };

type BranchMoneySummary = {
  branchId: string;
  weekStart: string;
  weekEnd: string;
  days: DayRow[];
  totals: MoneyByMethod;
  previousWeekTotal: number;
  totalChangePercent: number | null;
  cashNow: CashPosition;
  inTransit: InTransitEntry[];
};

const fmt = (v: number) => `C$${v.toLocaleString("es-NI", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

function shiftIsoDate(iso: string, days: number): string {
  const d = new Date(`${iso}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

function fmtDayLabel(iso: string) {
  return new Date(`${iso}T00:00:00Z`).toLocaleDateString("es-NI", { weekday: "short", day: "2-digit", month: "short", timeZone: "UTC" });
}

const STATE_LABEL: Record<CashIndicatorState, string> = {
  ACCUMULATING: "Acumulando",
  APPROACHING: "Cerca del umbral",
  READY: "Listo para depositar",
  OVERDUE: "Retenido de más",
  CRITICAL: "Crítico",
  IN_TRANSIT_ONLY: "En tránsito",
  CLEAR: "Al día",
};

export default function BranchMoneyWeekPage() {
  const sessionState = useSession();
  const branchId = sessionState.status === "authenticated"
    ? getActiveBranchId(sessionState.session.branchIds, sessionState.session.primaryBranchId)
    : null;

  const [weekStartOverride, setWeekStartOverride] = useState<string | null>(null);
  const [summary, setSummary] = useState<BranchMoneySummary | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [showSendModal, setShowSendModal] = useState(false);

  const load = useCallback(async () => {
    if (!branchId) return;
    setLoading(true);
    setError(null);
    try {
      const params = new URLSearchParams({ branchId });
      if (weekStartOverride) params.set("weekStart", weekStartOverride);
      const res = await apiFetch(`/api/treasury/branch-money-summary?${params.toString()}`);
      const raw = await res.json();
      if (!res.ok) throw new Error(raw?.error?.message ?? "No se pudo cargar el dinero de la semana.");
      setSummary(unwrapApiData(raw) as BranchMoneySummary);
    } catch (e) {
      setError(e instanceof Error ? e.message : "No se pudo cargar el dinero de la semana.");
    } finally {
      setLoading(false);
    }
  }, [branchId, weekStartOverride]);

  useEffect(() => { void load(); }, [load]);

  if (sessionState.status === "loading" || (!branchId && sessionState.status === "authenticated")) {
    return <p className="text-[var(--color-text-muted)] animate-pulse">Cargando…</p>;
  }
  if (sessionState.status !== "authenticated" || !branchId) {
    return <p className="text-[var(--color-danger-600)]">No tienes una sucursal asignada.</p>;
  }

  const todayStr = new Date().toISOString().slice(0, 10);
  const isCurrentOrFutureWeek = summary ? summary.weekEnd >= todayStr : false;
  const hasOther = summary ? summary.totals.other > 0.01 : false;

  return (
    <section className="space-y-4">
      <div className="flex items-center justify-between gap-3">
        <div>
          <h1 className="text-lg font-semibold text-[var(--color-text)]">Dinero de la semana</h1>
          <p className="text-sm text-[var(--color-text-muted)]">Dónde está cada córdoba cobrado, y de quién es la responsabilidad de moverlo.</p>
        </div>
        {summary && (
          <div className="flex items-center gap-1.5">
            <Button variant="ghost" size="sm" icon={<ChevronLeft className="h-4 w-4" />} onClick={() => setWeekStartOverride(shiftIsoDate(summary.weekStart, -7))}>Anterior</Button>
            <span className="text-xs font-medium text-[var(--color-text-secondary)]">
              {fmtDayLabel(summary.weekStart)} – {fmtDayLabel(summary.weekEnd)}
            </span>
            <Button variant="ghost" size="sm" disabled={isCurrentOrFutureWeek} onClick={() => setWeekStartOverride(shiftIsoDate(summary.weekStart, 7))}>
              Siguiente <ChevronRight className="h-4 w-4" />
            </Button>
          </div>
        )}
      </div>

      {error && <p className="rounded-lg bg-[var(--color-danger-50)] px-3 py-2 text-sm text-[var(--color-danger-700)]">{error}</p>}

      {loading && !summary ? (
        <p className="py-8 text-center text-sm text-[var(--color-text-muted)]">Cargando…</p>
      ) : summary && (
        <>
          {/* Tres medios + total, con comparación vs. semana anterior */}
          <Card className="p-4">
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
              <MethodTile icon={Wallet} label="Efectivo" amount={summary.totals.cash} />
              <MethodTile icon={ArrowLeftRight} label="Transferencia" amount={summary.totals.transfer} />
              <MethodTile icon={CreditCard} label="Tarjeta" amount={summary.totals.card} />
              <div className="rounded-xl border border-[var(--color-border-strong)] bg-[var(--color-surface-alt)] p-3">
                <div className="text-[0.6875rem] font-semibold uppercase tracking-wide text-[var(--color-text-muted)]">Total cobrado</div>
                <p className="mt-1 text-xl font-bold tabular-nums text-[var(--color-text)]">{fmt(summary.totals.total)}</p>
                {summary.totalChangePercent !== null && (
                  <p className={["flex items-center gap-1 text-xs font-medium", summary.totalChangePercent >= 0 ? "text-[var(--color-success-700)]" : "text-[var(--color-danger-600)]"].join(" ")}>
                    {summary.totalChangePercent >= 0 ? <TrendingUp className="h-3 w-3" /> : <TrendingDown className="h-3 w-3" />}
                    {Math.abs(summary.totalChangePercent)}% vs. semana pasada
                  </p>
                )}
              </div>
            </div>
            {hasOther && <p className="mt-2 text-[0.6875rem] text-[var(--color-text-soft)]">Incluye {fmt(summary.totals.other)} en otros métodos (crédito).</p>}
          </Card>

          {/* Detalle día por día */}
          <Card className="overflow-x-auto p-0">
            <table className="hm-table w-full text-xs">
              <thead>
                <tr>
                  <th></th>
                  <th className="text-right">Efectivo</th>
                  <th className="text-right">Transfer.</th>
                  <th className="text-right">Tarjeta</th>
                  {hasOther && <th className="text-right">Otro</th>}
                  <th className="text-right">Total</th>
                </tr>
              </thead>
              <tbody>
                {summary.days.map((day) => (
                  <tr key={day.businessDate}>
                    <td className="font-medium text-[var(--color-text)]">{fmtDayLabel(day.businessDate)}</td>
                    <td className="text-right font-mono tabular-nums">{day.cash > 0 ? fmt(day.cash) : "—"}</td>
                    <td className="text-right font-mono tabular-nums">{day.transfer > 0 ? fmt(day.transfer) : "—"}</td>
                    <td className="text-right font-mono tabular-nums">{day.card > 0 ? fmt(day.card) : "—"}</td>
                    {hasOther && <td className="text-right font-mono tabular-nums">{day.other > 0 ? fmt(day.other) : "—"}</td>}
                    <td className="text-right font-mono font-semibold tabular-nums text-[var(--color-text)]">{day.total > 0 ? fmt(day.total) : "—"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </Card>

          {/* Tu efectivo ahora — NO acotado a la semana (§2.2) */}
          <Card className="p-4">
            <div className="mb-3 flex items-center justify-between">
              <h2 className="text-sm font-semibold text-[var(--color-text)]">Tu efectivo ahora</h2>
              <span className="rounded-full bg-[var(--color-surface-muted)] px-2 py-0.5 text-[0.6875rem] font-semibold text-[var(--color-text-muted)]">{STATE_LABEL[summary.cashNow.state]}</span>
            </div>
            <div className="space-y-1.5 text-sm">
              <Row label="En caja hoy" value={fmt(summary.cashNow.cashInDrawerToday)} />
              <Row label="Acumulado" value={fmt(summary.cashNow.accumulatedAmount)} />
              <Row label="Fondo de caja (no se deposita)" value={summary.cashNow.cashFundAmount === null ? "—" : fmt(summary.cashNow.cashFundAmount)} />
              <div className="border-t border-[var(--color-border)] pt-1.5">
                <Row label="Para depositar" value={fmt(summary.cashNow.pendingDeposit)} bold />
              </div>
              {summary.cashNow.pendingDepositNote && <p className="text-[0.6875rem] italic text-[var(--color-text-soft)]">{summary.cashNow.pendingDepositNote}</p>}
            </div>

            {summary.cashNow.anomaly && (
              <p className="mt-2 flex items-start gap-1.5 rounded-lg bg-[var(--color-warning-50)] px-3 py-2 text-xs text-[var(--color-warning-700)]">
                <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" /> {summary.cashNow.anomaly.message}
              </p>
            )}

            {(summary.cashNow.state === "READY" || summary.cashNow.state === "OVERDUE" || summary.cashNow.state === "CRITICAL") && (
              <Button variant="secondary" size="sm" className="mt-3" icon={<Send className="h-3.5 w-3.5" />} onClick={() => setShowSendModal(true)}>
                Enviar depósito / Entregar en persona
              </Button>
            )}
          </Card>

          {/* En tránsito — solo si hay algo, sin botón de acción (§2.3) */}
          {summary.inTransit.length > 0 && (
            <Card className="p-4">
              <div className="mb-3 flex items-center gap-2">
                <Users className="h-4 w-4 text-[var(--color-text-muted)]" />
                <h2 className="text-sm font-semibold text-[var(--color-text)]">En tránsito</h2>
              </div>
              <div className="space-y-1.5">
                {summary.inTransit.map((entry) => (
                  <div key={entry.custodyAccountId} className="flex items-center justify-between rounded-lg border border-[var(--color-warning-200)] bg-[var(--color-warning-50)] p-3">
                    <div>
                      <p className="text-sm font-semibold text-[var(--color-text)]">{entry.holderName}</p>
                      <p className="text-xs text-[var(--color-text-muted)]">
                        {entry.sinceDate ? `Desde ${fmtDayLabel(entry.sinceDate)}` : ""} · Esperando confirmación de Master
                      </p>
                    </div>
                    <span className="font-mono text-sm font-bold tabular-nums text-[var(--color-text)]">{fmt(entry.amount)}</span>
                  </div>
                ))}
              </div>
            </Card>
          )}
        </>
      )}

      {showSendModal && branchId && (
        <SendDepositModal
          branchId={branchId}
          pendingDeposit={summary?.cashNow.pendingDeposit ?? 0}
          onClose={() => setShowSendModal(false)}
          onSent={() => { setShowSendModal(false); void load(); }}
        />
      )}
    </section>
  );
}

function MethodTile({ icon: Icon, label, amount }: { icon: typeof Wallet; label: string; amount: number }) {
  return (
    <div className="rounded-xl border border-[var(--color-border)] bg-[var(--color-surface-alt)] p-3">
      <div className="flex items-center gap-1.5 text-[0.6875rem] font-semibold uppercase tracking-wide text-[var(--color-text-muted)]">
        <Icon className="h-3 w-3" /> {label}
      </div>
      <p className="mt-1 text-xl font-bold tabular-nums text-[var(--color-text)]">{fmt(amount)}</p>
    </div>
  );
}

function Row({ label, value, bold }: { label: string; value: string; bold?: boolean }) {
  return (
    <div className="flex justify-between">
      <span className="text-[var(--color-text-muted)]">{label}</span>
      <span className={["font-mono tabular-nums", bold ? "font-bold text-[var(--color-text)]" : "text-[var(--color-text)]"].join(" ")}>{value}</span>
    </div>
  );
}
