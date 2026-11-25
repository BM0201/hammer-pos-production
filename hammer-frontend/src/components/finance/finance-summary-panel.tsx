"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { TrendingUp, TrendingDown, Wallet, Receipt, Users, Landmark, Info, ChevronLeft, ChevronRight, RefreshCw, Building2 } from "lucide-react";
import { apiFetch, unwrapApiData } from "@/lib/client/api";
import { showToast } from "@/components/ui/toast";
import { money, fmtDateTimeShort } from "@/lib/format";
import { BranchProfitChart, ExpenseMixChart, PnlWaterfallChart, SalesProfitTrendChart, Sparkline } from "@/components/finance/finance-charts";

/* ── Tipos del endpoint oficial: /api/master/finance/summary (finance/service.ts) ── */

type BranchRow = {
  branchId: string;
  branchCode: string | null;
  branchName: string | null;
  grossSales: number;
  refunds: number;
  netSales: number;
  cogs: number;
  grossProfit: number;
  grossMarginPercent: number | null;
  cashExpenses: number;
  bankExpenses: number;
  cardFees: number;
  retainedCashExpenses: number;
  payrollPaid: number;
  operatingExpenses: number;
  cashOverages: number;
  cashShortages: number;
  operatingProfit: number;
};

type CashOverageItem = {
  cashSessionId: string;
  branchCode: string | null;
  cashBoxCode: string | null;
  closedAt: string;
  closedByName: string | null;
  amount: number;
};

type FinanceSummary = {
  period: { year: number; month: number };
  inventoryProjection: {
    inventoryValue: number;
    potentialRevenue: number;
    potentialGrossProfit: number;
    potentialGrossMarginPercent: number | null;
    productsWithoutPrice: number;
    productsWithoutCost: number;
  };
  operatingExpenses: { monthlyTotal: number; periodTotal: number; byCategory: Array<{ category: string; amount: number }> };
  payroll: { payrollTotal: number; employerCostTotal: number; pendingPayrollTotal: number };
  realPerformance: {
    grossSales: number;
    refunds: number;
    netSales: number;
    cogs: number;
    grossProfit: number;
    grossMarginPercent: number | null;
    cashExpenses: number;
    bankExpenses: number;
    cardFees: number;
    retainedCashExpenses: number;
    payrollPaid: number;
    operatingExpenses: number;
    cashOverages: number;
    cashOverageItems: CashOverageItem[];
    cashShortages: number;
    cashShortageItems: CashOverageItem[];
    /** Gastos de cuentas centrales sin sucursal (banco central, comisión de tarjeta). */
    central: { bankExpenses: number; cardFees: number; operatingExpenses: number };
    expensesBudgetMonthly: number;
    operatingProfit: number;
    estimatedNetProfit: number;
    /** Salió plata, pero no es costo de operar (equipo/mejoras, personal del dueño): no resta de la utilidad operativa. */
    outsideOperation?: { equipment: number; ownerPersonal: number; total: number };
    byBranch: BranchRow[];
  };
};

type Branch = { id: string; code: string; name: string };

/* /api/master/finance/trend — serie mensual del desempeño real (base caja) */
type TrendPoint = {
  year: number;
  month: number;
  grossSales: number;
  refunds: number;
  netSales: number;
  cogs: number;
  grossProfit: number;
  grossMarginPercent: number | null;
  cashExpenses: number;
  bankExpenses: number;
  retainedCashExpenses: number;
  payrollPaid: number;
  cashOverages: number;
  cardFees?: number;
  cashShortages?: number;
  operatingProfit: number;
};

const MONTH_NAMES = ["enero", "febrero", "marzo", "abril", "mayo", "junio", "julio", "agosto", "septiembre", "octubre", "noviembre", "diciembre"];

function managuaNow() {
  const ymd = new Intl.DateTimeFormat("en-CA", { timeZone: "America/Managua", year: "numeric", month: "2-digit" }).format(new Date());
  const [year, month] = ymd.split("-").map(Number);
  return { year, month };
}

function Card({
  label, value, hint, tone = "default", icon: Icon,
}: { label: string; value: string; hint?: string; tone?: "default" | "ok" | "warn" | "info"; icon: React.ElementType }) {
  const color =
    tone === "ok" ? "var(--color-success-700)"
      : tone === "warn" ? "var(--color-danger-700)"
        : tone === "info" ? "var(--color-info-600)"
          : "var(--color-text)";
  const bg =
    tone === "ok" ? "var(--color-success-50)"
      : tone === "warn" ? "var(--color-danger-50)"
        : "var(--color-surface-alt)";
  return (
    <div className="rounded-lg p-3 space-y-1" style={{ background: bg, border: "0.5px solid var(--color-border)" }}>
      <p className="text-[10px] font-bold uppercase tracking-wider flex items-center gap-1.5" style={{ color: "var(--color-text-muted)" }}>
        <Icon className="h-3 w-3" /> {label}
      </p>
      <p className="text-xl font-bold tabular-nums" style={{ color }}>{value}</p>
      {hint && <p className="text-[11px]" style={{ color: "var(--color-text-muted)" }}>{hint}</p>}
    </div>
  );
}

/* ── Estado de resultados (P&L) — el formato que espera contabilidad ── */

function PnlRow({
  label, value, kind = "line", percent,
}: { label: string; value: number; kind?: "line" | "minus" | "plus" | "subtotal" | "total"; percent?: number | null }) {
  const isResult = kind === "subtotal" || kind === "total";
  const color =
    kind === "total"
      ? value >= 0 ? "var(--color-success-700)" : "var(--color-danger-700)"
      : isResult
        ? "var(--color-text)"
        : "var(--color-text-secondary)";
  return (
    <div
      className={`flex items-baseline justify-between gap-3 py-1.5 ${isResult ? "border-t" : ""}`}
      style={{ borderColor: isResult ? "var(--color-border-strong)" : undefined }}
    >
      <span className={`text-xs ${isResult ? "font-bold" : ""}`} style={{ color: isResult ? "var(--color-text)" : "var(--color-text-muted)" }}>
        {kind === "minus" ? "(−) " : kind === "plus" ? "(+) " : isResult ? "= " : ""}{label}
      </span>
      <span className={`tabular-nums text-sm ${isResult ? "font-bold" : "font-medium"}`} style={{ color, fontFamily: "'DM Mono', ui-monospace, monospace" }}>
        {kind === "minus" && value > 0 ? `(${money(value)})` : money(value)}
        {percent != null && <span className="ml-2 text-[11px] font-normal" style={{ color: "var(--color-text-muted)" }}>{percent.toFixed(1)}%</span>}
      </span>
    </div>
  );
}

/** Cajas con sobrante o faltante del período, para revisar con quien cerró. */
function CashDifferenceList({ items, kind }: { items: CashOverageItem[]; kind: "overage" | "shortage" }) {
  if (items.length === 0) return null;
  const overage = kind === "overage";
  const noun = overage ? "sobrante" : "faltante";
  return (
    <details className="mt-2 rounded-md px-2 py-1.5 text-xs" style={{ background: "var(--color-surface)", border: "0.5px solid var(--color-border)" }}>
      <summary className="cursor-pointer py-1 font-medium" style={{ color: "var(--color-text-secondary)" }}>
        Revisar {items.length === 1 ? `1 caja con ${noun}` : `${items.length} cajas con ${noun}`}
      </summary>
      <p className="mb-1.5 text-[10px]" style={{ color: "var(--color-text-muted)" }}>
        {overage
          ? "Sobró dinero al contar. Si fue un cobro anotado como tarjeta o transferencia que en verdad fue efectivo, o un vuelto mal dado, revísalo con quien cerró."
          : "Faltó dinero al contar. Si fue un cobro con tarjeta o transferencia anotado como efectivo, corrígelo en el historial de la venta; si fue un gasto sin anotar, regístralo. Si no, revísalo con quien cerró."}
      </p>
      <ul className="divide-y" style={{ borderColor: "var(--color-border)" }}>
        {items.map((o) => (
          <li key={o.cashSessionId} className="flex items-baseline justify-between gap-3 py-1.5">
            <span style={{ color: "var(--color-text-secondary)" }}>
              <b style={{ color: "var(--color-text)" }}>{o.branchCode ?? "—"}</b>
              {o.cashBoxCode ? ` · ${o.cashBoxCode}` : ""} · {fmtDateTimeShort(o.closedAt)}
              {o.closedByName ? ` · ${o.closedByName}` : ""}
            </span>
            <span className="tabular-nums font-medium" style={{ color: overage ? "var(--color-success-700)" : "var(--color-danger-700)" }}>
              {overage ? money(o.amount) : `−${money(o.amount)}`}
            </span>
          </li>
        ))}
      </ul>
    </details>
  );
}

export function FinanceSummaryPanel({ branchId: fixedBranchId }: { branchId?: string | null }) {
  const [data, setData] = useState<FinanceSummary | null>(null);
  const [trend, setTrend] = useState<TrendPoint[]>([]);
  const [loading, setLoading] = useState(true);
  const [period, setPeriod] = useState(() => managuaNow());
  const [branches, setBranches] = useState<Branch[]>([]);
  const [branchFilter, setBranchFilter] = useState<string>(fixedBranchId ?? "");
  const nowParts = managuaNow();
  const isCurrentMonth = period.year === nowParts.year && period.month === nowParts.month;

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const params = new URLSearchParams({ year: String(period.year), month: String(period.month) });
      const effectiveBranch = fixedBranchId ?? branchFilter;
      if (effectiveBranch) params.set("branchId", effectiveBranch);
      const res = await apiFetch(`/api/master/finance/summary?${params.toString()}`);
      const raw = await res.json();
      if (!res.ok) {
        showToast("error", raw?.error?.message ?? "No se pudo cargar el resumen financiero.");
        return;
      }
      setData(unwrapApiData(raw) as FinanceSummary);
    } catch {
      showToast("error", "Error de red al cargar el resumen financiero.");
    } finally {
      setLoading(false);
    }
  }, [fixedBranchId, branchFilter, period.year, period.month]);

  useEffect(() => { void load(); }, [load]);

  // Trayectoria: 12 meses (6 para el gráfico + 6 previos para el comparativo
  // del resumen ejecutivo). Depende solo de la sucursal, no del mes navegado.
  const loadTrend = useCallback(async () => {
    try {
      const params = new URLSearchParams({ months: "12" });
      const effectiveBranch = fixedBranchId ?? branchFilter;
      if (effectiveBranch) params.set("branchId", effectiveBranch);
      const res = await apiFetch(`/api/master/finance/trend?${params.toString()}`);
      const raw = await res.json();
      if (!res.ok) return; // la trayectoria es complementaria: no bloquea el resumen
      setTrend(((unwrapApiData(raw) as { points?: TrendPoint[] })?.points) ?? []);
    } catch {
      /* complementaria */
    }
  }, [fixedBranchId, branchFilter]);

  useEffect(() => { void loadTrend(); }, [loadTrend]);

  // Presupuesto inteligente: suma de los sugeridos por historial (6 meses de
  // gastos reales por categoría). Da contexto al presupuesto configurado — si
  // el configurado quedó viejo, aquí se ve cuánto debería ser y a dónde ir a
  // actualizarlo (Gastos operativos › Presupuesto).
  const [suggestedBudget, setSuggestedBudget] = useState<number | null>(null);
  const loadSuggestedBudget = useCallback(async () => {
    try {
      const effectiveBranch = fixedBranchId ?? branchFilter;
      const res = await apiFetch(`/api/finance/expense-history${effectiveBranch ? `?branchId=${effectiveBranch}` : ""}`);
      if (!res.ok) return; // complementario: no bloquea el resumen
      const raw = unwrapApiData(await res.json()) as { categories?: Array<{ suggestedBudget: number }> } | null;
      const total = (raw?.categories ?? []).reduce((s, c) => s + (c.suggestedBudget || 0), 0);
      setSuggestedBudget(total > 0 ? Math.round(total * 100) / 100 : null);
    } catch {
      /* complementario */
    }
  }, [fixedBranchId, branchFilter]);

  useEffect(() => { void loadSuggestedBudget(); }, [loadSuggestedBudget]);

  // Resumen ejecutivo: últimos 6 meses vs los 6 anteriores (solo si hay historia).
  const exec = useMemo(() => {
    if (trend.length === 0) return null;
    const last6 = trend.slice(-6);
    const prev6 = trend.slice(0, Math.max(0, trend.length - 6));
    const sum = (pts: TrendPoint[], k: "netSales" | "operatingProfit") => pts.reduce((s, p) => s + p[k], 0);
    const netSales6 = sum(last6, "netSales");
    const profit6 = sum(last6, "operatingProfit");
    const prevNet = sum(prev6, "netSales");
    const prevProfit = sum(prev6, "operatingProfit");
    const delta = (curr: number, prev: number) => (prev > 0 ? Math.round(((curr - prev) / prev) * 1000) / 10 : null);
    const monthsWithSales = last6.filter((p) => p.netSales > 0).length;
    return {
      netSales6, profit6,
      netSalesSeries: last6.map((p) => p.netSales),
      profitSeries: last6.map((p) => p.operatingProfit),
      marginSeries: last6.map((p) => (p.netSales > 0 ? (p.operatingProfit / p.netSales) * 100 : 0)),
      netSalesDelta: delta(netSales6, prevNet),
      profitDelta: delta(profit6, prevProfit),
      marginPercent: netSales6 > 0 ? Math.round((profit6 / netSales6) * 1000) / 10 : null,
      monthsWithSales,
    };
  }, [trend]);

  const chartData = useMemo(
    () => trend.slice(-6).map((p) => ({
      ...p,
      label: `${MONTH_NAMES[p.month - 1].slice(0, 3)} ${String(p.year).slice(2)}`,
    })),
    [trend],
  );

  useEffect(() => {
    if (fixedBranchId !== undefined && fixedBranchId !== null) return; // selector deshabilitado
    apiFetch("/api/branches")
      .then((r) => r.json())
      .then((raw) => setBranches((unwrapApiData(raw) as Branch[]) ?? []))
      .catch(() => { /* selector es opcional */ });
  }, [fixedBranchId]);

  function shiftMonth(delta: number) {
    setPeriod((prev) => {
      const idx = prev.year * 12 + (prev.month - 1) + delta;
      return { year: Math.floor(idx / 12), month: (idx % 12) + 1 };
    });
  }

  const inv = data?.inventoryProjection;
  const perf = data?.realPerformance;
  // El presupuesto configurado trae la planilla del mes; el sugerido por historial no.
  const budgetPayroll = data?.operatingExpenses.byCategory?.find((c) => c.category === "PAYROLL")?.amount ?? 0;
  const budgetWithoutPayroll = Math.max(0, (perf?.expensesBudgetMonthly ?? 0) - budgetPayroll);

  return (
    <div className="space-y-5">
      {/* ── Controles: período + sucursal ── */}
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div className="flex items-center gap-1.5">
          <button
            onClick={() => shiftMonth(-1)}
            className="flex h-8 w-8 items-center justify-center rounded-lg border transition-colors hover:bg-[var(--color-surface-alt)]"
            style={{ borderColor: "var(--color-border)", color: "var(--color-text-secondary)" }}
            aria-label="Mes anterior"
          >
            <ChevronLeft className="h-4 w-4" />
          </button>
          <span className="min-w-[10rem] text-center text-sm font-bold capitalize" style={{ color: "var(--color-text)" }}>
            {MONTH_NAMES[period.month - 1]} {period.year}
            {isCurrentMonth && <span className="ml-1.5 text-[10px] font-semibold rounded px-1.5 py-0.5" style={{ background: "var(--color-info-100)", color: "var(--color-info-700)" }}>en curso</span>}
          </span>
          <button
            onClick={() => shiftMonth(1)}
            disabled={isCurrentMonth}
            className="flex h-8 w-8 items-center justify-center rounded-lg border transition-colors hover:bg-[var(--color-surface-alt)] disabled:opacity-40 disabled:cursor-not-allowed"
            style={{ borderColor: "var(--color-border)", color: "var(--color-text-secondary)" }}
            aria-label="Mes siguiente"
          >
            <ChevronRight className="h-4 w-4" />
          </button>
        </div>
        <div className="flex items-center gap-2">
          {fixedBranchId == null && branches.length > 0 && (
            <div className="flex items-center gap-1.5">
              <Building2 className="h-3.5 w-3.5" style={{ color: "var(--color-text-muted)" }} />
              <select
                className="hm-input h-8 text-xs"
                value={branchFilter}
                onChange={(e) => setBranchFilter(e.target.value)}
                aria-label="Filtrar por sucursal"
              >
                <option value="">Todas las sucursales</option>
                {branches.map((b) => <option key={b.id} value={b.id}>{b.code} — {b.name}</option>)}
              </select>
            </div>
          )}
          <button
            onClick={() => void load()}
            className="flex h-8 items-center gap-1.5 rounded-lg border px-3 text-xs font-medium transition-colors hover:bg-[var(--color-surface-alt)]"
            style={{ borderColor: "var(--color-border)", color: "var(--color-text-secondary)" }}
          >
            <RefreshCw className={`h-3.5 w-3.5 ${loading ? "animate-spin" : ""}`} />
            Actualizar
          </button>
        </div>
      </div>

      {loading && !data ? (
        <div className="p-6 text-center text-sm text-[var(--color-text-muted)]">Cargando resumen financiero…</div>
      ) : !data || !perf || !inv ? null : (
        <>
          {/* ── 0. RESUMEN EJECUTIVO — lo primero que lee un banco o socio ── */}
          {exec && exec.monthsWithSales > 0 && (
            <section className="rounded-xl p-4" style={{ background: "var(--color-surface)", border: "1px solid var(--color-success-200)" }}>
              <div className="mb-3 flex items-center justify-between flex-wrap gap-2">
                <p className="text-xs font-semibold uppercase tracking-wider" style={{ color: "var(--color-text-muted)" }}>
                  Resumen ejecutivo — últimos 6 meses reales
                </p>
                <span className="text-[10px] rounded px-2 py-0.5" style={{ background: "var(--color-info-100)", color: "var(--color-info-700)" }}>
                  Basado en ventas cobradas
                </span>
              </div>
              <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
                <div>
                  <p className="text-[10px] font-bold uppercase tracking-wider" style={{ color: "var(--color-text-muted)" }}>Ingresos netos (6m)</p>
                  <p className="text-2xl font-extrabold tabular-nums" style={{ color: "var(--color-text)" }}>{money(exec.netSales6)}</p>
                  {exec.netSalesDelta != null && (
                    <span className="mt-1 inline-flex items-center gap-1 rounded px-1.5 py-0.5 text-[11px] font-bold"
                      style={exec.netSalesDelta >= 0
                        ? { background: "var(--color-success-50)", color: "var(--color-success-700)" }
                        : { background: "var(--color-danger-50)", color: "var(--color-danger-700)" }}>
                      {exec.netSalesDelta >= 0 ? <TrendingUp className="h-3 w-3" /> : <TrendingDown className="h-3 w-3" />}
                      {Math.abs(exec.netSalesDelta).toFixed(1)}% vs semestre anterior
                    </span>
                  )}
                  <Sparkline values={exec.netSalesSeries} label="Ingresos netos" />
                </div>
                <div>
                  <p className="text-[10px] font-bold uppercase tracking-wider" style={{ color: "var(--color-text-muted)" }}>Utilidad operativa (6m)</p>
                  <p className="text-2xl font-extrabold tabular-nums" style={{ color: exec.profit6 >= 0 ? "var(--color-success-700)" : "var(--color-danger-700)" }}>{money(exec.profit6)}</p>
                  {exec.profitDelta != null && (
                    <span className="mt-1 inline-flex items-center gap-1 rounded px-1.5 py-0.5 text-[11px] font-bold"
                      style={exec.profitDelta >= 0
                        ? { background: "var(--color-success-50)", color: "var(--color-success-700)" }
                        : { background: "var(--color-danger-50)", color: "var(--color-danger-700)" }}>
                      {exec.profitDelta >= 0 ? <TrendingUp className="h-3 w-3" /> : <TrendingDown className="h-3 w-3" />}
                      {Math.abs(exec.profitDelta).toFixed(1)}% vs semestre anterior
                    </span>
                  )}
                  <Sparkline values={exec.profitSeries} label="Utilidad operativa" />
                </div>
                <div>
                  <p className="text-[10px] font-bold uppercase tracking-wider" style={{ color: "var(--color-text-muted)" }}>Margen operativo (6m)</p>
                  <p className="text-2xl font-extrabold tabular-nums" style={{ color: "var(--color-text)" }}>
                    {exec.marginPercent != null ? `${exec.marginPercent.toFixed(1)}%` : "—"}
                  </p>
                  <p className="text-[11px]" style={{ color: "var(--color-text-muted)" }}>Utilidad operativa / ingresos netos</p>
                  <Sparkline values={exec.marginSeries} label="Margen operativo" />
                </div>
                <div>
                  <p className="text-[10px] font-bold uppercase tracking-wider" style={{ color: "var(--color-text-muted)" }}>Meses con venta</p>
                  <p className="text-2xl font-extrabold tabular-nums" style={{ color: "var(--color-text)" }}>{exec.monthsWithSales} de 6</p>
                  <p className="text-[11px]" style={{ color: "var(--color-text-muted)" }}>Continuidad de operación</p>
                </div>
              </div>
            </section>
          )}

          {/* ── 0b. TRAYECTORIA — ingresos/utilidad y a dónde se van los gastos, 6 meses ── */}
          {chartData.some((p) => p.netSales !== 0 || p.operatingProfit !== 0) && (
            <div className="grid gap-4 xl:grid-cols-2">
              <SalesProfitTrendChart points={chartData} />
              <ExpenseMixChart points={chartData} />
            </div>
          )}

          {/* ── 1. DESEMPEÑO REAL — la verdad primero ── */}
          <section className="rounded-xl p-4 space-y-4" style={{ background: "var(--color-surface)", border: "0.5px solid var(--color-border)" }}>
            <p className="text-xs font-semibold uppercase tracking-wider flex items-center gap-1.5" style={{ color: "var(--color-text-muted)" }}>
              <Landmark className="h-3.5 w-3.5" /> Estado de resultados del período
              <span className="text-[10px] rounded px-2 py-0.5" style={{ background: "var(--color-info-100)", color: "var(--color-info-700)" }}>
                Dinero real: ventas cobradas, no proyección
              </span>
            </p>

            <div className="grid gap-5 lg:grid-cols-[minmax(260px,340px)_1fr]">
              {/* Estado de resultados */}
              <div className="rounded-lg p-3.5" style={{ background: "var(--color-surface-alt)", border: "0.5px solid var(--color-border)" }}>
                <PnlRow label="Ventas brutas cobradas" value={perf.grossSales} />
                <PnlRow label="Devoluciones (reembolsos)" value={perf.refunds} kind="minus" />
                <PnlRow label="Ventas netas" value={perf.netSales} kind="subtotal" />
                <PnlRow label="Costo de ventas (COGS)" value={perf.cogs} kind="minus" />
                <PnlRow label="Utilidad bruta" value={perf.grossProfit} kind="subtotal" percent={perf.grossMarginPercent} />
                <PnlRow label="Gastos pagados desde caja" value={perf.cashExpenses} kind="minus" />
                <PnlRow label="Gastos pagados desde banco" value={perf.bankExpenses} kind="minus" />
                <PnlRow label="Comisión de tarjeta" value={perf.cardFees} kind="minus" />
                <PnlRow label="Gastos con efectivo retenido" value={perf.retainedCashExpenses} kind="minus" />
                <PnlRow label="Planilla pagada" value={perf.payrollPaid} kind="minus" />
                <PnlRow label="Sobrante de caja" value={perf.cashOverages} kind="plus" />
                <PnlRow label="Faltante de caja" value={perf.cashShortages} kind="minus" />
                <PnlRow label="Utilidad operativa" value={perf.operatingProfit} kind="total" />
                {(perf.outsideOperation?.total ?? 0) > 0 && (
                  <div className="mt-2 rounded-md px-2.5 py-2 text-xs" style={{ background: "var(--color-surface)", border: "0.5px dashed var(--color-border-strong)" }}>
                    <p className="font-semibold" style={{ color: "var(--color-text)" }}>Fuera de la operación: {money(perf.outsideOperation!.total)}</p>
                    <p className="mt-0.5" style={{ color: "var(--color-text-secondary)" }}>
                      {perf.outsideOperation!.equipment > 0 && <>Equipo y mejoras {money(perf.outsideOperation!.equipment)}</>}
                      {perf.outsideOperation!.equipment > 0 && perf.outsideOperation!.ownerPersonal > 0 && " · "}
                      {perf.outsideOperation!.ownerPersonal > 0 && <>Personal del dueño {money(perf.outsideOperation!.ownerPersonal)}</>}
                    </p>
                    <p className="mt-0.5 text-[10px]" style={{ color: "var(--color-text-muted)" }}>Salió de caja, pero no es costo de operar la ferretería: no resta de la utilidad operativa.</p>
                  </div>
                )}
                <CashDifferenceList items={perf.cashOverageItems} kind="overage" />
                <CashDifferenceList items={perf.cashShortageItems} kind="shortage" />
                <p className="mt-2 text-[10px] leading-relaxed" style={{ color: "var(--color-text-muted)" }}>
                  Gastos de caja = egresos que cada sucursal pagó desde la gaveta abierta · gastos de banco = pagos a
                  proveedor/gasto desde una cuenta bancaria registrada · comisión de tarjeta = lo que el banco descuenta al liquidar las
                  ventas con tarjeta (entra cuando se confirma la liquidación) · efectivo retenido = gastos pagados con dinero
                  ya cerrado en caja fuerte, esperando depósito — ninguno incluye planilla (va aparte, a costo empresa) ·
                  sobrante / faltante de caja = lo que sobró o faltó al contar las cajas cerradas (contado − esperado).
                </p>
              </div>

              {/* Rentabilidad por sucursal — min-w-0 en el item de grid para que
                  el overflow-x quede CONTENIDO en la tabla y no empuje el ancho
                  de toda la página (los grid items tienen min-width:auto). */}
              <div className="min-w-0 overflow-x-auto rounded-lg px-3" style={{ border: "0.5px solid var(--color-border)" }}>
                {perf.byBranch.length === 0 ? (
                  <p className="p-4 text-center text-xs" style={{ color: "var(--color-text-muted)" }}>Sin ventas cobradas en el período.</p>
                ) : (
                  <table className="w-full min-w-[680px] text-left text-xs">
                    <thead>
                      <tr className="text-[10px] uppercase tracking-wider" style={{ color: "var(--color-text-muted)" }}>
                        <th className="py-1.5 pr-3">Sucursal</th>
                        <th className="py-1.5 pr-3 text-right">Ventas netas</th>
                        <th className="py-1.5 pr-3 text-right">Devol.</th>
                        <th className="py-1.5 pr-3 text-right">COGS</th>
                        <th className="py-1.5 pr-3 text-right">Ut. bruta</th>
                        <th className="py-1.5 pr-3 text-right">Margen</th>
                        <th className="py-1.5 pr-3 text-right" title="Egresos de caja + banco + comisión de tarjeta + efectivo retenido + planilla pagada del período">Gastos reales</th>
                        <th className="py-1.5 text-right">Ut. operativa</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y" style={{ borderColor: "var(--color-border)" }}>
                      {perf.byBranch.map((b) => (
                        <tr key={b.branchId}>
                          <td className="py-2 pr-3 font-semibold whitespace-nowrap" style={{ color: "var(--color-text)" }}>
                            {b.branchCode ?? "—"} <span className="font-normal hidden xl:inline" style={{ color: "var(--color-text-muted)" }}>{b.branchName ?? ""}</span>
                          </td>
                          <td className="py-2 pr-3 text-right tabular-nums font-semibold" style={{ color: "var(--color-text)" }}>{money(b.netSales)}</td>
                          <td className="py-2 pr-3 text-right tabular-nums" style={{ color: b.refunds > 0 ? "var(--color-warning-700)" : "var(--color-text-muted)" }}>{money(b.refunds)}</td>
                          <td className="py-2 pr-3 text-right tabular-nums" style={{ color: "var(--color-text-secondary)" }}>{money(b.cogs)}</td>
                          <td className="py-2 pr-3 text-right tabular-nums" style={{ color: b.grossProfit >= 0 ? "var(--color-success-700)" : "var(--color-danger-700)" }}>{money(b.grossProfit)}</td>
                          <td className="py-2 pr-3 text-right tabular-nums" style={{ color: "var(--color-text-secondary)" }}>{b.grossMarginPercent != null ? `${b.grossMarginPercent.toFixed(1)}%` : "—"}</td>
                          <td className="py-2 pr-3 text-right tabular-nums" style={{ color: "var(--color-text-secondary)" }}>{money(b.operatingExpenses)}</td>
                          <td className="py-2 text-right tabular-nums font-bold" style={{ color: b.operatingProfit >= 0 ? "var(--color-success-700)" : "var(--color-danger-700)" }}>{money(b.operatingProfit)}</td>
                        </tr>
                      ))}
                      {perf.central.operatingExpenses > 0 && (
                        <tr title="Gastos de cuentas centrales que no son de una sucursal: banco central y comisión de tarjeta">
                          <td className="py-2 pr-3 font-semibold whitespace-nowrap" style={{ color: "var(--color-text)" }}>
                            Central <span className="font-normal" style={{ color: "var(--color-text-muted)" }}>sin sucursal</span>
                          </td>
                          <td colSpan={5} className="py-2 pr-3 text-right text-[11px]" style={{ color: "var(--color-text-muted)" }}>
                            {perf.central.cardFees > 0 ? `Comisión de tarjeta ${money(perf.central.cardFees)}` : ""}
                            {perf.central.cardFees > 0 && perf.central.bankExpenses > 0 ? " · " : ""}
                            {perf.central.bankExpenses > 0 ? `Banco central ${money(perf.central.bankExpenses)}` : ""}
                          </td>
                          <td className="py-2 pr-3 text-right tabular-nums" style={{ color: "var(--color-text-secondary)" }}>{money(perf.central.operatingExpenses)}</td>
                          <td className="py-2 text-right tabular-nums font-bold" style={{ color: "var(--color-danger-700)" }}>{money(-perf.central.operatingExpenses)}</td>
                        </tr>
                      )}
                    </tbody>
                  </table>
                )}
              </div>
            </div>

            {/* Diversificación del ingreso — mitigante de riesgo para crédito */}
            {perf.byBranch.length > 1 && perf.netSales > 0 && (() => {
              const top = perf.byBranch.reduce((a, b) => (b.netSales > a.netSales ? b : a));
              const share = Math.round((top.netSales / perf.netSales) * 100);
              return (
                <p className="rounded-lg px-3 py-2 text-[11px]" style={{ background: "var(--color-surface-alt)", border: "0.5px solid var(--color-border)", color: "var(--color-text-secondary)" }}>
                  {share <= 40
                    ? <>Ninguna sucursal concentra más del 40% del ingreso del período — el negocio no depende de un solo punto de venta.</>
                    : <><b>{top.branchCode ?? top.branchName}</b> concentra el <b>{share}%</b> del ingreso del período — concentración a vigilar como riesgo.</>}
                </p>
              );
            })()}

            <p className="text-[10px]" style={{ color: "var(--color-text-muted)" }}>
              Reglas (todo en base caja, corte mensual hora Managua): ventas netas = pagos cobrados − reembolsos ·
              COGS = costo de salidas por venta − reingresos vendibles por devolución (lo dañado queda como merma) ·
              utilidad operativa = utilidad bruta − gastos REALES pagados (egresos de caja de sucursal + banco + comisión de tarjeta + efectivo retenido + planilla desembolsada) + sobrante − faltante de caja.
              Las sucursales más la fila Central suman el total.
              El presupuesto mensual configurado se compara aparte, no se resta.
            </p>
          </section>

          {/* ── 1b. Gráficas del mes: cascada del estado de resultados y utilidad por sucursal ── */}
          <div className={`grid gap-4 ${perf.byBranch.length + (perf.central.operatingExpenses > 0 ? 1 : 0) >= 2 ? "xl:grid-cols-[minmax(0,1.25fr)_minmax(0,1fr)]" : ""}`}>
            <PnlWaterfallChart pnl={perf} />
            <BranchProfitChart byBranch={perf.byBranch} centralExpenses={perf.central.operatingExpenses} />
          </div>

          {/* ── 2. Costos del período: real vs presupuesto ── */}
          <section className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            <Card icon={Wallet} label="Gastos reales pagados" value={money(perf.operatingExpenses)}
              hint={`Caja ${money(perf.cashExpenses)} + banco ${money(perf.bankExpenses)} + tarjeta ${money(perf.cardFees)} + retenido ${money(perf.retainedCashExpenses)} + planilla ${money(perf.payrollPaid)}`} />
            <Card icon={Receipt} label="Presupuesto mensual configurado" value={money(perf.expensesBudgetMonthly)}
              tone={perf.expensesBudgetMonthly > 0 && perf.operatingExpenses > perf.expensesBudgetMonthly ? "warn" : "default"}
              hint={perf.expensesBudgetMonthly > 0
                ? `Ejecutado: ${Math.round((perf.operatingExpenses / perf.expensesBudgetMonthly) * 100)}% · incluye planilla ${money(budgetPayroll)}`
                : suggestedBudget != null
                  ? `Sin configurar · Sugerido por historial (sin planilla): ${money(suggestedBudget)}`
                  : "Sin presupuesto configurado"} />
            <Card icon={Users} label="Planilla pagada (bruto)" value={money(data.payroll.payrollTotal)} hint={`Costo patronal: ${money(data.payroll.employerCostTotal)}`} />
            <Card icon={Landmark} label="Planilla pendiente de pago" value={money(data.payroll.pendingPayrollTotal)} tone={data.payroll.pendingPayrollTotal > 0 ? "warn" : "default"}
              hint={data.payroll.pendingPayrollTotal > 0 ? "Desembolsos programados sin pagar" : "Al día"} />

            {/* Comparación visual presupuesto vs gasto real — barra de ejecución.
                Antes solo había un % suelto en la tarjeta; ahora se ve de un
                vistazo cuánto del presupuesto se consumió y si se excedió. */}
            {perf.expensesBudgetMonthly > 0 && (() => {
              const pct = (perf.operatingExpenses / perf.expensesBudgetMonthly) * 100;
              const pctRounded = Math.round(pct);
              const over = pct > 100;
              const remaining = perf.expensesBudgetMonthly - perf.operatingExpenses;
              const barColor = over
                ? "var(--color-danger-600, #dc2626)"
                : pct >= 85
                  ? "var(--color-warning-600, #d97706)"
                  : "var(--color-success-600, #16a34a)";
              return (
                <div className="sm:col-span-2 lg:col-span-4 rounded-xl p-4 space-y-2.5"
                  style={{ background: "var(--color-surface)", border: "0.5px solid var(--color-border)" }}>
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <span className="text-xs font-semibold uppercase tracking-wider" style={{ color: "var(--color-text-muted)" }}>
                      Ejecución del presupuesto mensual
                    </span>
                    <span className="text-sm font-bold" style={{ color: barColor }}>
                      {pctRounded}% ejecutado
                    </span>
                  </div>
                  <div className="h-3 w-full overflow-hidden rounded-full" style={{ background: "var(--color-surface-alt)" }}>
                    <div className="h-full rounded-full transition-all"
                      style={{ width: `${Math.min(pct, 100)}%`, background: barColor }} />
                  </div>
                  <div className="flex flex-wrap items-center justify-between gap-2 text-[11px]" style={{ color: "var(--color-text-secondary)" }}>
                    <span>Real pagado: <b style={{ color: "var(--color-text)" }}>{money(perf.operatingExpenses)}</b> de {money(perf.expensesBudgetMonthly)}</span>
                    <span style={{ color: over ? "var(--color-danger-700)" : "var(--color-text-secondary)" }}>
                      {over
                        ? `Excedido en ${money(Math.abs(remaining))}`
                        : `Disponible: ${money(remaining)}`}
                    </span>
                  </div>
                  {/* Presupuesto inteligente: si el configurado quedó viejo
                      (muy por debajo de lo que el negocio gasta de verdad),
                      el "% ejecutado" alarma sin razón — aquí se muestra la
                      referencia real y a dónde ir a actualizarla. */}
                  {/* El sugerido por historial no trae planilla: se compara contra el presupuesto SIN planilla. */}
                  {suggestedBudget != null && suggestedBudget > budgetWithoutPayroll * 1.2 && (
                    <p className="rounded-lg px-3 py-2 text-[11px]" style={{ background: "var(--color-warning-50, #fef3c7)", border: "0.5px solid var(--color-warning-200, #fde68a)", color: "var(--color-warning-700, #b45309)" }}>
                      Sin contar planilla, el presupuesto configurado es {money(budgetWithoutPayroll)} y quedó por debajo de lo que el negocio
                      gasta de verdad: el historial de los últimos 6 meses sugiere <b>{money(suggestedBudget)}</b>.
                      Actualízalo en <b>Gastos operativos › Presupuesto</b> (botón “Usar sugerido” por categoría).
                    </p>
                  )}
                  <p className="text-[10px]" style={{ color: "var(--color-text-muted)" }}>
                    El “gasto real” suma caja, banco, comisión de tarjeta, efectivo retenido y planilla pagada; el presupuesto también incluye la planilla del mes
                    ({money(budgetPayroll)}). Es una referencia y no se resta de la utilidad.
                    {suggestedBudget != null ? ` Sugerido por historial, sin planilla: ${money(suggestedBudget)} (configurado sin planilla: ${money(budgetWithoutPayroll)}).` : ""}
                  </p>
                </div>
              );
            })()}
          </section>

          {/* ── 3. Proyección comercial — hipotética, al final y con borde punteado
                para no mezclarla visualmente con las cifras reales auditables ── */}
          <section className="rounded-xl p-4 space-y-4" style={{ background: "var(--color-surface-muted, var(--color-surface))", border: "1.5px dashed var(--color-border-strong)" }}>
            <div className="flex items-center justify-between flex-wrap gap-2">
              <p className="text-xs font-semibold uppercase tracking-wider flex items-center gap-1.5" style={{ color: "var(--color-text-muted)" }}>
                <TrendingUp className="h-3.5 w-3.5" /> Proyección comercial del inventario
              </p>
              <span className="text-[10px] rounded px-2 py-0.5" style={{ background: "var(--color-warning-100)", color: "var(--color-warning-700)" }}>
                ⚠ Estimado, no auditado — asume vender el 100% del stock de hoy; no es utilidad real
              </span>
            </div>
            <div className="grid gap-3 sm:grid-cols-4">
              <Card icon={Wallet} label="Valor inventario (costo)" value={money(inv.inventoryValue)} hint="Cantidad × costo promedio" />
              <Card icon={TrendingUp} label="Valor de venta potencial" value={money(inv.potentialRevenue)} tone="info" hint="Cantidad × precio vigente" />
              <Card icon={TrendingUp} label="Ganancia bruta potencial" value={money(inv.potentialGrossProfit)} tone={inv.potentialGrossProfit >= 0 ? "ok" : "warn"} hint="No incluye gastos" />
              <Card icon={TrendingUp} label="Margen bruto potencial" value={inv.potentialGrossMarginPercent != null ? `${inv.potentialGrossMarginPercent.toFixed(1)}%` : "—"} tone="ok" />
            </div>
            {(inv.productsWithoutPrice > 0 || inv.productsWithoutCost > 0) && (
              <p className="text-[11px] flex items-center gap-1.5" style={{ color: "var(--color-text-muted)" }}>
                <Info className="h-3 w-3" />
                {inv.productsWithoutPrice} producto(s) sin precio · {inv.productsWithoutCost} sin costo (excluidos del cálculo).
              </p>
            )}
          </section>
        </>
      )}
    </div>
  );
}
