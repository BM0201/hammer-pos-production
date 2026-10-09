"use client";

import { Fragment, useCallback, useEffect, useMemo, useState } from "react";
import { useRouter, useSearchParams, usePathname } from "next/navigation";
import {
  Bar, BarChart, CartesianGrid, Legend, ResponsiveContainer, Tooltip, XAxis, YAxis,
} from "recharts";
import {
  ChevronLeft, ChevronRight, Building2, RefreshCw, AlertTriangle, Download, Printer,
  ChevronDown, ChevronUp, Settings, Users, Truck, Info,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { apiFetch, unwrapApiData } from "@/lib/client/api";
import { showToast } from "@/components/ui/toast";
import { money, fmtDateTime } from "@/lib/format";
import { getCategoryColor, withUnclassifiedLast } from "@/lib/finance-colors";
import { parsePeriodUrlState, periodUrlParams, isoDateOnly, type ExpensePeriodUrlState } from "@/lib/finance-period-url";
import { buildExpensePeriodCsv, buildExpensePeriodPrintHtml } from "@/lib/finance-period-export";
import { printHtml, recordPrintAudit } from "@/lib/printing";
import {
  PERIOD_KIND_LABELS, SOURCE_LABELS, ledgerCategoryLabel,
  type ExpensePeriodReport, type PeriodKind, type ExpensePeriodBasis,
} from "@/components/finance/expenses-period.types";
import { ExpenseConceptsModal } from "@/components/finance/expense-concepts-modal";

type Branch = { id: string; code: string; name: string };

const KIND_OPTIONS: PeriodKind[] = ["DAY", "WEEK", "QUINCENA", "MONTH"];

/** Mismo patrón que ThemeToggle: lee data-theme del <html> y se resuscribe a sus cambios, para colorear el gráfico igual en ambos temas. */
function useDocumentTheme(): "light" | "dark" {
  const [theme, setTheme] = useState<"light" | "dark">(() =>
    typeof document !== "undefined" && document.documentElement.dataset.theme === "dark" ? "dark" : "light");
  useEffect(() => {
    const observer = new MutationObserver(() => {
      setTheme(document.documentElement.dataset.theme === "dark" ? "dark" : "light");
    });
    observer.observe(document.documentElement, { attributes: true, attributeFilter: ["data-theme"] });
    return () => observer.disconnect();
  }, []);
  return theme;
}

function KpiCard({ label, value, hint, tone = "default" }: { label: string; value: string; hint?: string; tone?: "default" | "ok" | "warn" }) {
  const color = tone === "ok" ? "var(--color-success-700)" : tone === "warn" ? "var(--color-danger-700)" : "var(--color-text)";
  const bg = tone === "ok" ? "var(--color-success-50)" : tone === "warn" ? "var(--color-danger-50)" : "var(--color-surface-alt)";
  return (
    <div className="rounded-lg p-3 space-y-1" style={{ background: bg, border: "0.5px solid var(--color-border)" }}>
      <p className="text-[10px] font-bold uppercase tracking-wider" style={{ color: "var(--color-text-muted)" }}>{label}</p>
      <p className="text-xl font-bold tabular-nums" style={{ color }}>{value}</p>
      {hint && <p className="text-[11px]" style={{ color: "var(--color-text-muted)" }}>{hint}</p>}
    </div>
  );
}

function deltaTone(delta: number): "ok" | "warn" | "default" {
  if (delta > 0.5) return "warn"; // más gasto = advertencia
  if (delta < -0.5) return "ok";
  return "default";
}

export function ExpensesPeriodPanel({ fixedBranchId }: { fixedBranchId?: string | null } = {}) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const theme = useDocumentTheme();

  const urlState = useMemo(() => parsePeriodUrlState(searchParams), [searchParams]);
  const [branches, setBranches] = useState<Branch[]>([]);
  const [report, setReport] = useState<ExpensePeriodReport | null>(null);
  const [loading, setLoading] = useState(true);
  const [expandedCategory, setExpandedCategory] = useState<string | null>(null);
  const [categoryFilter, setCategoryFilter] = useState<string | null>(null);
  const [rowsOffset, setRowsOffset] = useState(0);
  const [conceptsModalOpen, setConceptsModalOpen] = useState(false);

  const effectiveBranchId = fixedBranchId ?? urlState.branchId;

  function navigate(next: Partial<ExpensePeriodUrlState>) {
    const merged: ExpensePeriodUrlState = { ...urlState, ...next };
    const params = periodUrlParams(merged);
    router.replace(`${pathname}?${params.toString()}` as Parameters<typeof router.replace>[0], { scroll: false });
  }

  useEffect(() => {
    if (fixedBranchId !== undefined && fixedBranchId !== null) return;
    apiFetch("/api/branches").then((r) => r.json()).then((raw) => setBranches((unwrapApiData(raw) as Branch[]) ?? [])).catch(() => {});
  }, [fixedBranchId]);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const params = new URLSearchParams({ kind: urlState.kind, basis: urlState.basis, limit: "50", offset: String(rowsOffset) });
      if (urlState.date) params.set("date", urlState.date);
      if (effectiveBranchId) params.set("branchId", effectiveBranchId);
      if (categoryFilter) params.set("category", categoryFilter);
      const res = await apiFetch(`/api/master/finance/expenses/period?${params.toString()}`);
      const raw = await res.json();
      if (!res.ok) {
        showToast("error", raw?.error?.message ?? "No se pudo cargar el reporte de gastos.");
        return;
      }
      setReport(unwrapApiData(raw) as ExpensePeriodReport);
    } catch {
      showToast("error", "Error de red al cargar el reporte de gastos.");
    } finally {
      setLoading(false);
    }
  }, [urlState.kind, urlState.basis, urlState.date, effectiveBranchId, categoryFilter, rowsOffset]);

  useEffect(() => { void load(); }, [load]);
  // Cambiar de categoría/período reinicia la paginación de filas.
  useEffect(() => { setRowsOffset(0); }, [categoryFilter, urlState.kind, urlState.date, effectiveBranchId, urlState.basis]);

  const branchLabel = effectiveBranchId
    ? (branches.find((b) => b.id === effectiveBranchId)?.name ?? "Sucursal")
    : "Todas las sucursales";

  function handleExport() {
    if (!report) return;
    const csv = buildExpensePeriodCsv(report);
    const blob = new Blob([`﻿${csv}`], { type: "text/csv;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `gastos-${report.period.kind.toLowerCase()}-${isoDateOnly(report.period.start)}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  }

  async function handlePrint() {
    if (!report) return;
    printHtml(buildExpensePeriodPrintHtml(report, { branchLabel }));
    await recordPrintAudit({
      branchId: effectiveBranchId ?? undefined,
      entityType: "ExpensePeriodReport",
      entityId: `${report.period.kind}:${isoDateOnly(report.period.start)}`,
      documentType: "FINANCE_EXPENSE_PERIOD_REPORT",
    });
  }

  const byDayChartData = useMemo(() => {
    if (!report) return [];
    return report.byDay.map((day) => ({ date: day.date.slice(5), ...day.byCategory }));
  }, [report]);

  const chartCategories = useMemo(() => {
    if (!report) return [];
    const set = new Set<string>();
    for (const day of report.byDay) for (const cat of Object.keys(day.byCategory)) set.add(cat);
    return withUnclassifiedLast([...set].map((category) => ({ category }))).map((c) => c.category);
  }, [report]);

  return (
    <div className="space-y-5">
      {/* ── Controles: tipo de período + navegación + sucursal + base ── */}
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div className="flex items-center gap-1.5 flex-wrap">
          <select
            className="hm-input h-8 text-xs"
            value={urlState.kind}
            onChange={(e) => navigate({ kind: e.target.value as PeriodKind, date: null })}
            aria-label="Tipo de período"
          >
            {KIND_OPTIONS.map((k) => <option key={k} value={k}>{PERIOD_KIND_LABELS[k]}</option>)}
          </select>
          {report && (
            <>
              <button
                onClick={() => navigate({ date: isoDateOnly(report.period.previous.start) })}
                className="flex h-8 w-8 items-center justify-center rounded-lg border transition-colors hover:bg-[var(--color-surface-alt)]"
                style={{ borderColor: "var(--color-border)", color: "var(--color-text-secondary)" }}
                aria-label="Período anterior"
              >
                <ChevronLeft className="h-4 w-4" />
              </button>
              <span className="min-w-[11rem] text-center text-sm font-bold" style={{ color: "var(--color-text)" }}>
                {report.period.label}
              </span>
              <button
                onClick={() => navigate({ date: isoDateOnly(report.period.next.start) })}
                className="flex h-8 w-8 items-center justify-center rounded-lg border transition-colors hover:bg-[var(--color-surface-alt)]"
                style={{ borderColor: "var(--color-border)", color: "var(--color-text-secondary)" }}
                aria-label="Período siguiente"
              >
                <ChevronRight className="h-4 w-4" />
              </button>
            </>
          )}
        </div>
        <div className="flex items-center gap-2">
          <select
            className="hm-input h-8 text-xs"
            value={urlState.basis}
            onChange={(e) => navigate({ basis: e.target.value as ExpensePeriodBasis })}
            aria-label="Base: pagado o devengado"
          >
            <option value="PAID">Pagado</option>
            <option value="ACCRUED">Devengado</option>
          </select>
          {fixedBranchId == null && branches.length > 0 && (
            <div className="flex items-center gap-1.5">
              <Building2 className="h-3.5 w-3.5" style={{ color: "var(--color-text-muted)" }} />
              <select
                className="hm-input h-8 text-xs"
                value={urlState.branchId ?? ""}
                onChange={(e) => navigate({ branchId: e.target.value || null })}
                aria-label="Filtrar por sucursal"
              >
                <option value="">Todas las sucursales</option>
                {branches.map((b) => <option key={b.id} value={b.id}>{b.code} — {b.name}</option>)}
              </select>
            </div>
          )}
          <Button variant="ghost" size="sm" onClick={() => void load()} icon={<RefreshCw className={`h-3.5 w-3.5 ${loading ? "animate-spin" : ""}`} />}>
            Actualizar
          </Button>
          <Button variant="ghost" size="sm" onClick={handleExport} disabled={!report} icon={<Download className="h-3.5 w-3.5" />}>
            CSV
          </Button>
          <Button variant="ghost" size="sm" onClick={() => void handlePrint()} disabled={!report} icon={<Printer className="h-3.5 w-3.5" />}>
            Imprimir
          </Button>
          <Button variant="ghost" size="sm" onClick={() => setConceptsModalOpen(true)} icon={<Settings className="h-3.5 w-3.5" />}>
            Conceptos
          </Button>
        </div>
      </div>

      {loading && !report ? (
        <div className="p-6 text-center text-sm text-[var(--color-text-muted)]">Cargando reporte de gastos…</div>
      ) : !report ? null : (
        <>
          {/* ── KPIs ── */}
          <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-3">
            <KpiCard
              label="Gasto total"
              value={money(report.totals.expenseTotal)}
              hint={report.comparison.previousTotal > 0
                ? `${report.totals.expenseTotal >= report.comparison.previousTotal ? "+" : ""}${(((report.totals.expenseTotal - report.comparison.previousTotal) / report.comparison.previousTotal) * 100).toFixed(0)}% vs anterior`
                : undefined}
              tone={report.comparison.previousTotal > 0 ? deltaTone(report.totals.expenseTotal - report.comparison.previousTotal) : "default"}
            />
            <KpiCard
              label="Gasto / ventas"
              value={report.totals.expenseToSalesPercent != null ? `${report.totals.expenseToSalesPercent.toFixed(1)}%` : "—"}
            />
            <KpiCard
              label="Utilidad operativa"
              value={money(report.totals.operatingProfit)}
              tone={report.totals.operatingProfit >= 0 ? "ok" : "warn"}
            />
            <KpiCard
              label="Presupuesto ejecutado"
              value={report.budget.executedPercent != null ? `${report.budget.executedPercent.toFixed(0)}%` : "—"}
              hint={money(report.budget.totalProrated)}
              tone={report.budget.executedPercent != null && report.budget.executedPercent > 110 ? "warn" : "default"}
            />
            <KpiCard
              label="Planilla del período"
              value={report.payroll ? money(report.payroll.netPaid) : "—"}
              hint={report.payroll?.halvesPaid.length ? report.payroll.halvesPaid.join(", ") : undefined}
            />
          </div>

          {/* ── Alertas: "qué pasó" ── */}
          {report.alerts.length > 0 && (
            <div className="rounded-lg p-3 space-y-2" style={{ background: "var(--color-danger-50)", border: "0.5px solid var(--color-danger-200)" }}>
              <p className="text-xs font-bold uppercase tracking-wider flex items-center gap-1.5" style={{ color: "var(--color-danger-700)" }}>
                <AlertTriangle className="h-3.5 w-3.5" /> Qué pasó este período
              </p>
              <ul className="space-y-1">
                {report.alerts.map((alert, i) => (
                  <li key={i}>
                    <button
                      type="button"
                      onClick={() => alert.category && setCategoryFilter(alert.category)}
                      className="text-left text-xs hover:underline"
                      style={{ color: "var(--color-text)" }}
                      disabled={!alert.category}
                    >
                      {alert.message}
                    </button>
                  </li>
                ))}
              </ul>
            </div>
          )}

          {/* ── Gráfica de barras apiladas por día/categoría ── */}
          {byDayChartData.length > 0 && (
            <div className="rounded-lg p-3" style={{ background: "var(--color-surface)", border: "0.5px solid var(--color-border)" }}>
              <p className="text-xs font-bold uppercase tracking-wider mb-2" style={{ color: "var(--color-text-muted)" }}>Gasto por día</p>
              <ResponsiveContainer width="100%" height={240}>
                <BarChart data={byDayChartData}>
                  <CartesianGrid strokeDasharray="3 3" stroke="var(--color-border)" />
                  <XAxis dataKey="date" tick={{ fontSize: 11 }} />
                  <YAxis tick={{ fontSize: 11 }} />
                  <Tooltip formatter={(value) => money(typeof value === "number" ? value : Number(value ?? 0))} />
                  <Legend formatter={(value: string) => ledgerCategoryLabel(value)} wrapperStyle={{ fontSize: 11 }} />
                  {chartCategories.map((category) => (
                    <Bar key={category} dataKey={category} stackId="total" fill={getCategoryColor(category, theme)} name={category} />
                  ))}
                </BarChart>
              </ResponsiveContainer>
            </div>
          )}

          {/* ── Tabla por categoría → conceptos ── */}
          <div className="rounded-lg overflow-hidden" style={{ border: "0.5px solid var(--color-border)" }}>
            <table className="hm-table w-full text-sm">
              <thead style={{ background: "var(--color-surface-alt)" }}>
                <tr>
                  <th className="px-3 py-2 text-left text-xs font-semibold" style={{ color: "var(--color-text-muted)" }}>Categoría</th>
                  <th className="px-3 py-2 text-right text-xs font-semibold" style={{ color: "var(--color-text-muted)" }}>Gasto</th>
                  <th className="px-3 py-2 text-right text-xs font-semibold" style={{ color: "var(--color-text-muted)" }}>Presupuesto</th>
                  <th className="px-3 py-2 text-right text-xs font-semibold" style={{ color: "var(--color-text-muted)" }}>% ejecutado</th>
                  <th className="px-3 py-2 text-right text-xs font-semibold" style={{ color: "var(--color-text-muted)" }}>vs promedio</th>
                </tr>
              </thead>
              <tbody>
                {withUnclassifiedLast(report.byCategory).map((cat) => {
                  const isExpanded = expandedCategory === cat.category;
                  return (
                    <Fragment key={cat.category}>
                      <tr
                        className="cursor-pointer border-b border-[var(--color-border)] last:border-0 hover:bg-[var(--color-surface-alt)]"
                        onClick={() => setExpandedCategory(isExpanded ? null : cat.category)}
                      >
                        <td className="px-3 py-2.5 font-medium flex items-center gap-1.5" data-label="Categoría" style={{ color: cat.category === "UNCLASSIFIED" ? "var(--color-warning-700)" : "var(--color-text)" }}>
                          {isExpanded ? <ChevronUp className="h-3.5 w-3.5" /> : <ChevronDown className="h-3.5 w-3.5" />}
                          {ledgerCategoryLabel(cat.category)}
                        </td>
                        <td className="px-3 py-2.5 text-right tabular-nums" data-label="Gasto">{money(cat.total)}</td>
                        <td className="px-3 py-2.5 text-right tabular-nums" data-label="Presupuesto" style={{ color: "var(--color-text-muted)" }}>{money(cat.budgetProrated)}</td>
                        <td className="px-3 py-2.5 text-right tabular-nums" data-label="% ejecutado">{cat.budgetExecutedPercent != null ? `${cat.budgetExecutedPercent.toFixed(0)}%` : "—"}</td>
                        <td className="px-3 py-2.5 text-right tabular-nums" data-label="vs promedio" style={{ color: "var(--color-text-muted)" }}>
                          {cat.deltaPercent != null ? `${cat.deltaPercent > 0 ? "+" : ""}${cat.deltaPercent.toFixed(0)}%` : "—"}
                        </td>
                      </tr>
                      {isExpanded && cat.byConcept.map((concept) => (
                        <tr key={`${cat.category}-${concept.conceptId ?? "none"}`} className="border-b border-[var(--color-border)] last:border-0" style={{ background: "var(--color-surface-alt)" }}>
                          <td className="px-3 py-2 pl-9 text-xs" data-label="Concepto" style={{ color: "var(--color-text-muted)" }}>{concept.conceptName ?? "Sin concepto"}</td>
                          <td className="px-3 py-2 text-right text-xs tabular-nums" data-label="Gasto">{money(concept.total)}</td>
                          <td className="px-3 py-2" data-label="" />
                          <td className="px-3 py-2" data-label="" />
                          <td className="px-3 py-2" data-label="" />
                        </tr>
                      ))}
                    </Fragment>
                  );
                })}
              </tbody>
            </table>
          </div>

          {/* ── Planilla del período (solo si tocó una fecha de pago) ── */}
          {report.payroll && (
            <div className="rounded-lg p-3 grid grid-cols-2 sm:grid-cols-4 gap-3" style={{ background: "var(--color-surface)", border: "0.5px solid var(--color-border)" }}>
              <p className="col-span-2 sm:col-span-4 text-xs font-bold uppercase tracking-wider flex items-center gap-1.5" style={{ color: "var(--color-text-muted)" }}>
                <Users className="h-3.5 w-3.5" /> Planilla del período
              </p>
              <KpiCard label="Neto pagado" value={money(report.payroll.netPaid)} />
              <KpiCard label="INSS patronal" value={money(report.payroll.inssPatronal)} />
              <KpiCard label="INATEC" value={money(report.payroll.inatec)} />
              <KpiCard label="Pendiente" value={money(report.payroll.pending)} tone={report.payroll.pending > 0 ? "warn" : "default"} />
            </div>
          )}

          {/* ── Informativo: CxP y fletes internos ── */}
          <div className="rounded-lg p-3 space-y-2" style={{ background: "var(--color-info-50)", border: "0.5px solid var(--color-info-200)" }}>
            <p className="text-xs font-bold uppercase tracking-wider flex items-center gap-1.5" style={{ color: "var(--color-info-700)" }}>
              <Info className="h-3.5 w-3.5" /> Informativo (no suma al gasto operativo)
            </p>
            <p className="text-xs" style={{ color: "var(--color-text)" }}>
              Compras a proveedor pagadas en el período: <strong>{money(report.informative.purchasesPaid)}</strong> — ya entran como costo de venta al vender, no se cuentan dos veces.
            </p>
            {report.informative.internalFreightCost > 0 && (
              <p className="text-xs flex items-start gap-1.5" style={{ color: "var(--color-text)" }}>
                <Truck className="h-3.5 w-3.5 mt-0.5 flex-shrink-0" />
                <span>
                  Costo de fletes internos del período: <strong>{money(report.informative.internalFreightCost)}</strong>.
                  {report.informative.internalFreightOverlapWarning && (
                    <span className="block mt-0.5" style={{ color: "var(--color-text-muted)" }}>{report.informative.internalFreightOverlapWarning}</span>
                  )}
                </span>
              </p>
            )}
          </div>

          {/* ── Libro de gastos (filas) ── */}
          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <p className="text-xs font-bold uppercase tracking-wider" style={{ color: "var(--color-text-muted)" }}>
                Libro de gastos {categoryFilter && `— ${ledgerCategoryLabel(categoryFilter)}`}
              </p>
              {categoryFilter && (
                <button onClick={() => setCategoryFilter(null)} className="text-xs hover:underline" style={{ color: "var(--color-info-700)" }}>
                  Quitar filtro
                </button>
              )}
            </div>
            <div className="rounded-lg overflow-hidden" style={{ border: "0.5px solid var(--color-border)" }}>
              <table className="hm-table w-full text-sm">
                <thead style={{ background: "var(--color-surface-alt)" }}>
                  <tr>
                    <th className="px-3 py-2 text-left text-xs font-semibold" style={{ color: "var(--color-text-muted)" }}>Fecha</th>
                    <th className="px-3 py-2 text-left text-xs font-semibold" style={{ color: "var(--color-text-muted)" }}>Sucursal</th>
                    <th className="px-3 py-2 text-left text-xs font-semibold" style={{ color: "var(--color-text-muted)" }}>Categoría / concepto</th>
                    <th className="px-3 py-2 text-left text-xs font-semibold" style={{ color: "var(--color-text-muted)" }}>Descripción</th>
                    <th className="px-3 py-2 text-right text-xs font-semibold" style={{ color: "var(--color-text-muted)" }}>Monto</th>
                    <th className="px-3 py-2 text-left text-xs font-semibold" style={{ color: "var(--color-text-muted)" }}>Fuente</th>
                  </tr>
                </thead>
                <tbody>
                  {report.rows.items.map((row) => (
                    <tr key={row.id} className="border-b border-[var(--color-border)] last:border-0 hover:bg-[var(--color-surface-alt)]">
                      <td className="px-3 py-2 text-xs" data-label="Fecha" style={{ color: "var(--color-text-muted)" }}>{fmtDateTime(row.date)}</td>
                      <td className="px-3 py-2 text-xs" data-label="Sucursal">{row.branchCode ?? "—"}</td>
                      <td className="px-3 py-2 text-xs" data-label="Categoría">
                        {ledgerCategoryLabel(row.category)}
                        {row.conceptName && <span className="block text-[11px]" style={{ color: "var(--color-text-muted)" }}>{row.conceptName}</span>}
                      </td>
                      <td className="px-3 py-2 text-xs max-w-xs truncate" data-label="Descripción" title={row.description}>
                        {row.description}
                        {!row.receiptNumber && row.source !== "DEVENGADO" && (
                          <span className="ml-1 text-[10px] font-semibold" style={{ color: "var(--color-warning-700)" }}>sin recibo</span>
                        )}
                      </td>
                      <td className="px-3 py-2 text-right text-xs tabular-nums" data-label="Monto">{money(row.amount)}</td>
                      <td className="px-3 py-2 text-xs" data-label="Fuente">{SOURCE_LABELS[row.source] ?? row.source}</td>
                    </tr>
                  ))}
                  {report.rows.items.length === 0 && (
                    <tr><td colSpan={6} className="px-3 py-6 text-center text-xs" style={{ color: "var(--color-text-muted)" }}>Sin gastos en este período.</td></tr>
                  )}
                </tbody>
              </table>
            </div>
            {report.rows.total > report.rows.limit && (
              <div className="flex items-center justify-between text-xs" style={{ color: "var(--color-text-muted)" }}>
                <span>{rowsOffset + 1}–{Math.min(rowsOffset + report.rows.limit, report.rows.total)} de {report.rows.total}</span>
                <div className="flex gap-2">
                  <button disabled={rowsOffset === 0} onClick={() => setRowsOffset((o) => Math.max(0, o - report.rows.limit))} className="disabled:opacity-40 hover:underline">Anterior</button>
                  <button disabled={rowsOffset + report.rows.limit >= report.rows.total} onClick={() => setRowsOffset((o) => o + report.rows.limit)} className="disabled:opacity-40 hover:underline">Siguiente</button>
                </div>
              </div>
            )}
          </div>
        </>
      )}

      {conceptsModalOpen && <ExpenseConceptsModal onClose={() => setConceptsModalOpen(false)} />}
    </div>
  );
}
