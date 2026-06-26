"use client";

import { useCallback, useEffect, useState } from "react";
import { TrendingUp, Wallet, Receipt, Users, Landmark, Info } from "lucide-react";
import { apiFetch, unwrapApiData } from "@/lib/client/api";
import { showToast } from "@/components/ui/toast";

/* ── Tipos del endpoint oficial: /api/master/finance/summary (finance/service.ts) ── */

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
    netSales: number;
    cogs: number;
    grossProfit: number;
    grossMarginPercent: number | null;
    operatingExpenses: number;
    operatingProfit: number;
    estimatedNetProfit: number;
  };
};

function money(value: number | null | undefined) {
  return new Intl.NumberFormat("es-NI", { style: "currency", currency: "NIO" }).format(Number(value ?? 0));
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

export function FinanceSummaryPanel({ branchId }: { branchId?: string | null }) {
  const [data, setData] = useState<FinanceSummary | null>(null);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const qs = branchId ? `?branchId=${encodeURIComponent(branchId)}` : "";
      const res = await apiFetch(`/api/master/finance/summary${qs}`);
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
  }, [branchId]);

  useEffect(() => { void load(); }, [load]);

  if (loading) return <div className="p-6 text-center text-sm text-[var(--color-text-muted)]">Cargando resumen financiero…</div>;
  if (!data) return null;

  const inv = data.inventoryProjection;
  const perf = data.realPerformance;

  return (
    <div className="space-y-5">
      {/* ── Proyección comercial (NO es utilidad real) ── */}
      <section className="rounded-xl p-4 space-y-4" style={{ background: "var(--color-surface)", border: "0.5px solid var(--color-border)" }}>
        <div className="flex items-center justify-between flex-wrap gap-2">
          <p className="text-xs font-semibold uppercase tracking-wider flex items-center gap-1.5" style={{ color: "var(--color-text-muted)" }}>
            <TrendingUp className="h-3.5 w-3.5" /> Proyección comercial del inventario
          </p>
          <span className="text-[10px] rounded px-2 py-0.5" style={{ background: "var(--color-warning-100)", color: "var(--color-warning-700)" }}>
            No es utilidad real — es potencial si se vendiera todo el stock
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

      {/* ── Costos del periodo ── */}
      <section className="grid gap-3 sm:grid-cols-3">
        <Card icon={Receipt} label="Gastos operativos (periodo)" value={money(data.operatingExpenses.periodTotal)} hint="Gastos recurrentes mensuales" />
        <Card icon={Users} label="Planilla (bruto)" value={money(data.payroll.payrollTotal)} hint={`Costo patronal: ${money(data.payroll.employerCostTotal)}`} />
        <Card icon={Landmark} label="Planilla pendiente (borrador)" value={money(data.payroll.pendingPayrollTotal)} tone={data.payroll.pendingPayrollTotal > 0 ? "warn" : "default"} />
      </section>

      {/* ── Desempeño REAL del periodo ── */}
      <section className="rounded-xl p-4 space-y-4" style={{ background: "var(--color-surface)", border: "0.5px solid var(--color-border)" }}>
        <p className="text-xs font-semibold uppercase tracking-wider flex items-center gap-1.5" style={{ color: "var(--color-text-muted)" }}>
          <Landmark className="h-3.5 w-3.5" /> Desempeño real del periodo
          <span className="text-[10px] rounded px-2 py-0.5" style={{ background: "var(--color-info-100)", color: "var(--color-info-700)" }}>
            Ventas cobradas, no proyección
          </span>
        </p>
        <div className="grid gap-3 sm:grid-cols-4">
          <Card icon={TrendingUp} label="Ventas netas" value={money(perf.netSales)} tone="info" />
          <Card icon={Wallet} label="Costo de ventas (COGS)" value={money(perf.cogs)} />
          <Card icon={TrendingUp} label="Utilidad bruta real" value={money(perf.grossProfit)} tone={perf.grossProfit >= 0 ? "ok" : "warn"}
            hint={perf.grossMarginPercent != null ? `${perf.grossMarginPercent.toFixed(1)}% margen` : undefined} />
          <Card icon={Landmark} label="Utilidad operativa estimada" value={money(perf.operatingProfit)} tone={perf.operatingProfit >= 0 ? "ok" : "warn"}
            hint="Utilidad bruta real − gastos operativos" />
        </div>
        <p className="text-[10px]" style={{ color: "var(--color-text-muted)" }}>
          Utilidad operativa = utilidad bruta real − gastos operativos (incluye planilla). La proyección comercial de arriba NO se mezcla con la utilidad real.
        </p>
      </section>
    </div>
  );
}
