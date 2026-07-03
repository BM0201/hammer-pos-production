"use client";

import { useCallback, useEffect, useState } from "react";
import { TrendingUp, Wallet, Receipt, Users, Landmark, Info, ChevronLeft, ChevronRight, RefreshCw, Building2 } from "lucide-react";
import { apiFetch, unwrapApiData } from "@/lib/client/api";
import { showToast } from "@/components/ui/toast";

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
  payrollPaid: number;
  operatingExpenses: number;
  operatingProfit: number;
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
  operatingExpenses: { monthlyTotal: number; periodTotal: number };
  payroll: { payrollTotal: number; employerCostTotal: number; pendingPayrollTotal: number };
  realPerformance: {
    grossSales: number;
    refunds: number;
    netSales: number;
    cogs: number;
    grossProfit: number;
    grossMarginPercent: number | null;
    cashExpenses: number;
    payrollPaid: number;
    operatingExpenses: number;
    expensesBudgetMonthly: number;
    operatingProfit: number;
    estimatedNetProfit: number;
    byBranch: BranchRow[];
  };
};

type Branch = { id: string; code: string; name: string };

const MONTH_NAMES = ["enero", "febrero", "marzo", "abril", "mayo", "junio", "julio", "agosto", "septiembre", "octubre", "noviembre", "diciembre"];

function money(value: number | null | undefined) {
  return new Intl.NumberFormat("es-NI", { style: "currency", currency: "NIO" }).format(Number(value ?? 0));
}

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
}: { label: string; value: number; kind?: "line" | "minus" | "subtotal" | "total"; percent?: number | null }) {
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
        {kind === "minus" ? "(−) " : isResult ? "= " : ""}{label}
      </span>
      <span className={`tabular-nums text-sm ${isResult ? "font-bold" : "font-medium"}`} style={{ color, fontFamily: "'DM Mono', ui-monospace, monospace" }}>
        {kind === "minus" && value > 0 ? `(${money(value)})` : money(value)}
        {percent != null && <span className="ml-2 text-[11px] font-normal" style={{ color: "var(--color-text-muted)" }}>{percent.toFixed(1)}%</span>}
      </span>
    </div>
  );
}

export function FinanceSummaryPanel({ branchId: fixedBranchId }: { branchId?: string | null }) {
  const [data, setData] = useState<FinanceSummary | null>(null);
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
                <PnlRow label="Planilla pagada" value={perf.payrollPaid} kind="minus" />
                <PnlRow label="Utilidad operativa" value={perf.operatingProfit} kind="total" />
                <p className="mt-2 text-[10px] leading-relaxed" style={{ color: "var(--color-text-muted)" }}>
                  Gastos de caja = egresos reales que cada sucursal pagó en el período (luz, agua, compras del momento…),
                  sin incluir planilla (va aparte para no doble-contarla).
                </p>
              </div>

              {/* Rentabilidad por sucursal */}
              <div className="overflow-x-auto">
                {perf.byBranch.length === 0 ? (
                  <p className="p-4 text-center text-xs" style={{ color: "var(--color-text-muted)" }}>Sin ventas cobradas en el período.</p>
                ) : (
                  <table className="w-full text-left text-xs">
                    <thead>
                      <tr className="text-[10px] uppercase tracking-wider" style={{ color: "var(--color-text-muted)" }}>
                        <th className="py-1.5 pr-3">Sucursal</th>
                        <th className="py-1.5 pr-3 text-right">Ventas netas</th>
                        <th className="py-1.5 pr-3 text-right">Devol.</th>
                        <th className="py-1.5 pr-3 text-right">COGS</th>
                        <th className="py-1.5 pr-3 text-right">Ut. bruta</th>
                        <th className="py-1.5 pr-3 text-right">Margen</th>
                        <th className="py-1.5 pr-3 text-right" title="Egresos de caja + planilla pagada del período">Gastos reales</th>
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
                    </tbody>
                  </table>
                )}
              </div>
            </div>

            <p className="text-[10px]" style={{ color: "var(--color-text-muted)" }}>
              Reglas (todo en base caja, corte mensual hora Managua): ventas netas = pagos cobrados − reembolsos ·
              COGS = costo de salidas por venta − reingresos vendibles por devolución (lo dañado queda como merma) ·
              utilidad operativa = utilidad bruta − gastos REALES pagados (egresos de caja de sucursal + planilla desembolsada).
              El presupuesto mensual configurado se compara aparte, no se resta.
            </p>
          </section>

          {/* ── 2. Costos del período: real vs presupuesto ── */}
          <section className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            <Card icon={Wallet} label="Gastos reales pagados" value={money(perf.operatingExpenses)}
              hint={`Caja ${money(perf.cashExpenses)} + planilla ${money(perf.payrollPaid)}`} />
            <Card icon={Receipt} label="Presupuesto mensual configurado" value={money(perf.expensesBudgetMonthly)}
              tone={perf.expensesBudgetMonthly > 0 && perf.operatingExpenses > perf.expensesBudgetMonthly ? "warn" : "default"}
              hint={perf.expensesBudgetMonthly > 0
                ? `Ejecutado: ${Math.round((perf.operatingExpenses / perf.expensesBudgetMonthly) * 100)}% del presupuesto`
                : "Sin presupuesto configurado"} />
            <Card icon={Users} label="Planilla pagada (bruto)" value={money(data.payroll.payrollTotal)} hint={`Costo patronal: ${money(data.payroll.employerCostTotal)}`} />
            <Card icon={Landmark} label="Planilla pendiente de pago" value={money(data.payroll.pendingPayrollTotal)} tone={data.payroll.pendingPayrollTotal > 0 ? "warn" : "default"}
              hint={data.payroll.pendingPayrollTotal > 0 ? "Desembolsos programados sin pagar" : "Al día"} />
          </section>

          {/* ── 3. Proyección comercial — hipotética, al final ── */}
          <section className="rounded-xl p-4 space-y-4" style={{ background: "var(--color-surface)", border: "0.5px solid var(--color-border)" }}>
            <div className="flex items-center justify-between flex-wrap gap-2">
              <p className="text-xs font-semibold uppercase tracking-wider flex items-center gap-1.5" style={{ color: "var(--color-text-muted)" }}>
                <TrendingUp className="h-3.5 w-3.5" /> Proyección comercial del inventario
              </p>
              <span className="text-[10px] rounded px-2 py-0.5" style={{ background: "var(--color-warning-100)", color: "var(--color-warning-700)" }}>
                No es utilidad real — es potencial si se vendiera todo el stock de hoy
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
