"use client";

import { useCallback, useState } from "react";
import {
  BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip,
  ResponsiveContainer, PieChart, Pie, Cell, Legend,
} from "recharts";
import {
  TrendingUp, ShoppingCart, Package, Calculator, BarChart3,
  RefreshCw, Download, ChevronDown, ChevronUp, X,
} from "lucide-react";
import { apiFetch } from "@/lib/client/api";
import { Button } from "@/components/ui/button";
import { LoadingState } from "@/components/ui/loading-state";

// ─── Types ──────────────────────────────────────────────────────────────────

type Branch = { id: string; code: string; name: string };

type Kpis = {
  totalSold: number;
  ordersCount: number;
  unitsSold: number;
  avgTicket: number;
  distinctProducts: number;
};

type DayRow = {
  date: string;
  total_sold: number;
  orders_count: number;
  units_sold: number;
  distinct_products: number;
};

type ProductRow = {
  product_id: string;
  sku: string;
  name: string;
  category_name: string;
  total_qty: number;
  total_sold: number;
};

type BranchRow = {
  branch_id: string;
  branch_code: string;
  branch_name: string;
  total_sold: number;
  orders_count: number;
};

type CategoryRow = {
  category_id: string;
  category_name: string;
  total_sold: number;
  orders_count: number;
};

type SummaryData = {
  kpis: Kpis;
  byDay: DayRow[];
  topProducts: ProductRow[];
  byBranch: BranchRow[];
  byCategory: CategoryRow[];
  generatedAt: string;
};

type ProductsByDayData = {
  rows: ProductRow[];
  count: number;
  generatedAt: string;
};

// ─── Helpers ────────────────────────────────────────────────────────────────

const NIO = new Intl.NumberFormat("es-NI", { style: "currency", currency: "NIO", maximumFractionDigits: 0 });
const NION = new Intl.NumberFormat("es-NI", { style: "currency", currency: "NIO", minimumFractionDigits: 2, maximumFractionDigits: 2 });

function getDefaultDates() {
  const today = new Date();
  const dateTo = today.toISOString().split("T")[0]!;
  const from = new Date(today);
  from.setDate(from.getDate() - 29);
  return { dateFrom: from.toISOString().split("T")[0]!, dateTo };
}

function fmtDate(iso: string) {
  const [y, m, d] = iso.split("-");
  return `${d}/${m}/${y?.slice(2)}`;
}

function buildCsvRows(headers: string[], rows: Record<string, unknown>[]) {
  const escape = (v: unknown) => {
    const s = String(v ?? "");
    return s.includes(",") || s.includes('"') || s.includes("\n") ? `"${s.replace(/"/g, '""')}"` : s;
  };
  const lines = [headers.join(","), ...rows.map((r) => headers.map((h) => escape(r[h])).join(","))];
  return lines.join("\n");
}

function downloadCsv(filename: string, csv: string) {
  const blob = new Blob(["﻿" + csv], { type: "text/csv;charset=utf-8;" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

const CHART_COLORS = [
  "var(--color-info-500)",
  "var(--color-success-500)",
  "var(--color-warning-500)",
  "var(--color-danger-500)",
  "var(--color-master-500)",
  "var(--color-branch-admin-500)",
  "#8b5cf6",
  "#06b6d4",
  "#f59e0b",
  "#10b981",
];

// ─── Sub-components ──────────────────────────────────────────────────────────

function KpiCard({
  label, value, sub, icon: Icon, color,
}: {
  label: string; value: string; sub?: string;
  icon: React.ElementType; color: string;
}) {
  return (
    <div className="hm-module-card p-4 relative overflow-hidden">
      <div className={`absolute top-0 left-0 right-0 h-[3px] ${color}`} />
      <div className="flex items-start justify-between gap-2 mt-1">
        <div className="min-w-0">
          <p className="text-[0.65rem] font-bold uppercase tracking-[0.1em] text-[var(--color-text-muted)] mb-1.5">{label}</p>
          <p className="hm-num-lg">{value}</p>
          {sub && <p className="mt-1 text-[0.625rem] text-[var(--color-text-soft)] truncate">{sub}</p>}
        </div>
        <div className="hm-icon-wrap hm-icon-wrap-md border bg-[var(--color-surface-alt)] border-[var(--color-border)] flex-shrink-0 mt-0.5">
          <Icon className="text-[var(--color-text-muted)]" style={{ width: "1rem", height: "1rem" }} />
        </div>
      </div>
    </div>
  );
}

type SortDir = "asc" | "desc";

function SortHeader({
  label, sortKey, current, dir, onSort,
}: {
  label: string; sortKey: string; current: string; dir: SortDir;
  onSort: (key: string) => void;
}) {
  const active = current === sortKey;
  return (
    <button
      type="button"
      className="flex items-center gap-1 hover:text-[var(--color-text)] transition-colors"
      onClick={() => onSort(sortKey)}
    >
      {label}
      {active ? (
        dir === "asc" ? <ChevronUp className="h-3 w-3" /> : <ChevronDown className="h-3 w-3" />
      ) : (
        <ChevronDown className="h-3 w-3 opacity-30" />
      )}
    </button>
  );
}

function DrilldownModal({
  date, rows, loading, onClose,
}: {
  date: string; rows: ProductRow[]; loading: boolean; onClose: () => void;
}) {
  const [sort, setSort] = useState<{ key: string; dir: SortDir }>({ key: "total_qty", dir: "desc" });

  function handleSort(key: string) {
    setSort((prev) => ({ key, dir: prev.key === key && prev.dir === "desc" ? "asc" : "desc" }));
  }

  const sorted = [...rows].sort((a, b) => {
    const av = a[sort.key as keyof ProductRow];
    const bv = b[sort.key as keyof ProductRow];
    const cmp = typeof av === "number" && typeof bv === "number"
      ? av - bv
      : String(av).localeCompare(String(bv));
    return sort.dir === "asc" ? cmp : -cmp;
  });

  function exportCsv() {
    const csv = buildCsvRows(
      ["sku", "name", "category_name", "total_qty", "total_sold"],
      sorted.map((r) => ({ ...r })),
    );
    downloadCsv(`productos-${date}.csv`, csv);
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/50">
      <div className="bg-[var(--color-surface)] rounded-xl shadow-2xl border border-[var(--color-border)] w-full max-w-3xl max-h-[85vh] flex flex-col">
        <div className="flex items-center justify-between p-4 border-b border-[var(--color-border)]">
          <div>
            <h3 className="font-bold text-[var(--color-text)]">Productos vendidos — {fmtDate(date)}</h3>
            {!loading && <p className="text-xs text-[var(--color-text-muted)]">{rows.length} productos</p>}
          </div>
          <div className="flex gap-2">
            {!loading && rows.length > 0 && (
              <button type="button" className="hm-icon-btn" title="Exportar CSV" onClick={exportCsv}>
                <Download className="h-3.5 w-3.5" />
              </button>
            )}
            <button type="button" className="hm-icon-btn" onClick={onClose}>
              <X className="h-3.5 w-3.5" />
            </button>
          </div>
        </div>
        <div className="overflow-auto flex-1 p-4">
          {loading ? (
            <LoadingState message="Cargando productos..." />
          ) : rows.length === 0 ? (
            <p className="text-sm text-[var(--color-text-muted)] text-center py-8">Sin datos para este día.</p>
          ) : (
            <table className="hm-table w-full">
              <thead>
                <tr>
                  <th className="text-left">SKU</th>
                  <th className="text-left">Producto</th>
                  <th className="text-left">Categoría</th>
                  <th className="text-right">
                    <SortHeader label="Cantidad" sortKey="total_qty" current={sort.key} dir={sort.dir} onSort={handleSort} />
                  </th>
                  <th className="text-right">
                    <SortHeader label="Subtotal" sortKey="total_sold" current={sort.key} dir={sort.dir} onSort={handleSort} />
                  </th>
                </tr>
              </thead>
              <tbody>
                {sorted.map((r) => (
                  <tr key={r.product_id}>
                    <td className="font-mono text-xs">{r.sku}</td>
                    <td className="max-w-[200px] truncate">{r.name}</td>
                    <td className="text-xs text-[var(--color-text-muted)]">{r.category_name}</td>
                    <td className="text-right tabular-nums">{Number(r.total_qty).toLocaleString("es-NI")}</td>
                    <td className="text-right tabular-nums">{NIO.format(r.total_sold)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      </div>
    </div>
  );
}

// ─── Main component ──────────────────────────────────────────────────────────

type Props = { masterMode?: boolean; defaultBranchId?: string; branches?: Branch[] };

export function SalesDashboard({ masterMode = false, defaultBranchId = "", branches = [] }: Props) {
  const { dateFrom: defFrom, dateTo: defTo } = getDefaultDates();

  const [dateFrom, setDateFrom] = useState(defFrom);
  const [dateTo, setDateTo] = useState(defTo);
  const [branchId, setBranchId] = useState(defaultBranchId);

  const [data, setData] = useState<SummaryData | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [daySort, setDaySort] = useState<{ key: string; dir: SortDir }>({ key: "date", dir: "asc" });
  const [prodSort, setProdSort] = useState<{ key: string; dir: SortDir }>({ key: "total_qty", dir: "desc" });

  const [drillDate, setDrillDate] = useState<string | null>(null);
  const [drillRows, setDrillRows] = useState<ProductRow[]>([]);
  const [drillLoading, setDrillLoading] = useState(false);

  const loadData = useCallback(async () => {
    if (!dateFrom || !dateTo) return;
    setLoading(true);
    setError(null);
    try {
      const params = new URLSearchParams({ dateFrom, dateTo, format: "json" });
      if (branchId) params.set("branchId", branchId);
      const res = await apiFetch(`/api/reports/sales/summary?${params.toString()}`);
      const json = await res.json() as SummaryData | { error?: { message?: string }; message?: string };
      if (!res.ok) {
        const msg = (json as { error?: { message?: string }; message?: string })?.error?.message
          ?? (json as { message?: string }).message
          ?? "Error al cargar el dashboard.";
        setError(msg);
        return;
      }
      setData(json as SummaryData);
    } catch {
      setError("Error de red al cargar el dashboard.");
    } finally {
      setLoading(false);
    }
  }, [dateFrom, dateTo, branchId]);

  async function openDrilldown(date: string) {
    setDrillDate(date);
    setDrillRows([]);
    setDrillLoading(true);
    try {
      const params = new URLSearchParams({ dateFrom: date, dateTo: date, date, format: "json" });
      if (branchId) params.set("branchId", branchId);
      const res = await apiFetch(`/api/reports/sales/products-by-day?${params.toString()}`);
      const json = await res.json() as ProductsByDayData;
      if (res.ok) setDrillRows(json.rows ?? []);
    } catch { /* best-effort */ }
    finally { setDrillLoading(false); }
  }

  function sortDay(key: string) {
    setDaySort((prev) => ({ key, dir: prev.key === key && prev.dir === "desc" ? "asc" : "desc" }));
  }

  function sortProd(key: string) {
    setProdSort((prev) => ({ key, dir: prev.key === key && prev.dir === "desc" ? "asc" : "desc" }));
  }

  function sortRows<T>(rows: T[], key: string, dir: SortDir): T[] {
    return [...rows].sort((a, b) => {
      const av = (a as Record<string, unknown>)[key];
      const bv = (b as Record<string, unknown>)[key];
      const cmp = typeof av === "number" && typeof bv === "number"
        ? av - bv
        : String(av).localeCompare(String(bv));
      return dir === "asc" ? cmp : -cmp;
    });
  }

  function exportDaysCsv() {
    if (!data) return;
    const csv = buildCsvRows(
      ["date", "total_sold", "orders_count", "units_sold", "distinct_products"],
      data.byDay.map((r) => ({ ...r })),
    );
    downloadCsv("ventas-por-dia.csv", csv);
  }

  function exportProductsCsv() {
    if (!data) return;
    const csv = buildCsvRows(
      ["sku", "name", "category_name", "total_qty", "total_sold"],
      data.topProducts.map((r) => ({ ...r })),
    );
    downloadCsv("top-productos.csv", csv);
  }

  const sortedDays = data ? sortRows(data.byDay, daySort.key, daySort.dir) : [];
  const sortedProds = data ? sortRows(data.topProducts, prodSort.key, prodSort.dir) : [];

  const topQtyChart = data?.topProducts.slice(0, 10).map((r) => ({ name: r.name.length > 22 ? r.name.slice(0, 20) + "…" : r.name, qty: r.total_qty })) ?? [];
  const topAmtChart = data
    ? [...data.topProducts].sort((a, b) => b.total_sold - a.total_sold).slice(0, 10).map((r) => ({
        name: r.name.length > 22 ? r.name.slice(0, 20) + "…" : r.name,
        monto: r.total_sold,
      }))
    : [];

  return (
    <div className="space-y-5">

      {/* ── Filter bar ── */}
      <div className="hm-module-card overflow-hidden">
        <div className="hm-module-card-header">
          <div className="flex items-center gap-2">
            <div className="hm-icon-wrap hm-icon-wrap-sm border bg-[var(--color-info-50)] border-[var(--color-info-100)]">
              <BarChart3 className="text-[var(--color-info-600)]" style={{ width: "0.75rem", height: "0.75rem" }} />
            </div>
            <div>
              <p className="font-semibold text-sm text-[var(--color-text)] leading-none">Dashboard de ventas</p>
              <p className="text-[0.65rem] text-[var(--color-text-muted)] mt-0.5">Órdenes cobradas · excluye canceladas y devoluciones</p>
            </div>
          </div>
          {data && (
            <p className="text-[0.6rem] text-[var(--color-text-soft)] hidden sm:block">
              Actualizado {new Date(data.generatedAt).toLocaleTimeString("es-NI", { hour: "2-digit", minute: "2-digit" })}
            </p>
          )}
        </div>
        <div className="p-4 flex flex-wrap gap-3 items-end bg-[var(--color-surface-alt)/40]">
          <label className="grid gap-1 min-w-[130px]">
            <span className="text-[0.6875rem] font-semibold text-[var(--color-text-muted)] uppercase tracking-wide">Desde</span>
            <input className="hm-input rounded-lg text-sm" type="date" value={dateFrom} onChange={(e) => setDateFrom(e.target.value)} />
          </label>
          <label className="grid gap-1 min-w-[130px]">
            <span className="text-[0.6875rem] font-semibold text-[var(--color-text-muted)] uppercase tracking-wide">Hasta</span>
            <input className="hm-input rounded-lg text-sm" type="date" value={dateTo} onChange={(e) => setDateTo(e.target.value)} />
          </label>
          {masterMode && (
            <label className="grid gap-1 min-w-[160px]">
              <span className="text-[0.6875rem] font-semibold text-[var(--color-text-muted)] uppercase tracking-wide">Sucursal</span>
              <select className="hm-input rounded-lg text-sm" value={branchId} onChange={(e) => setBranchId(e.target.value)}>
                <option value="">Todas</option>
                {branches.map((b) => <option key={b.id} value={b.id}>{b.code} — {b.name}</option>)}
              </select>
            </label>
          )}
          <Button
            variant="primary"
            size="sm"
            loading={loading}
            icon={<RefreshCw className="h-3.5 w-3.5" />}
            onClick={() => void loadData()}
          >
            Actualizar
          </Button>
          {error && <p className="w-full text-xs text-[var(--color-danger-600)] mt-1">{error}</p>}
        </div>
      </div>

      {loading && <LoadingState message="Calculando dashboard de ventas..." />}

      {!loading && !data && (
        <div className="hm-module-card p-12 flex flex-col items-center gap-4 text-center">
          <div className="hm-icon-wrap border bg-[var(--color-info-50)] border-[var(--color-info-100)]" style={{ width: "3.5rem", height: "3.5rem" }}>
            <BarChart3 className="text-[var(--color-info-300)]" style={{ width: "1.5rem", height: "1.5rem" }} />
          </div>
          <div>
            <p className="font-semibold text-[var(--color-text)]">Selecciona un rango de fechas</p>
            <p className="text-sm text-[var(--color-text-muted)] mt-1">
              Elige las fechas y pulsa <strong className="text-[var(--color-text)]">Actualizar</strong> para calcular el resumen de ventas.
            </p>
          </div>
        </div>
      )}

      {!loading && data && (
        <>
          {/* ── KPIs ── */}
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
            <KpiCard
              label="Total vendido"
              value={NIO.format(data.kpis.totalSold)}
              sub={`incluye transporte`}
              icon={TrendingUp}
              color="bg-gradient-to-r from-[var(--color-success-400)] to-[var(--color-success-600)]"
            />
            <KpiCard
              label="Órdenes cobradas"
              value={data.kpis.ordersCount.toLocaleString("es-NI")}
              sub={`en el período`}
              icon={ShoppingCart}
              color="bg-gradient-to-r from-[var(--color-info-400)] to-[var(--color-info-600)]"
            />
            <KpiCard
              label="Unidades vendidas"
              value={Number(data.kpis.unitsSold).toLocaleString("es-NI")}
              sub={`líneas de producto`}
              icon={Package}
              color="bg-gradient-to-r from-[var(--color-warning-400)] to-[var(--color-warning-600)]"
            />
            <KpiCard
              label="Ticket promedio"
              value={NION.format(data.kpis.avgTicket)}
              sub={`por orden`}
              icon={Calculator}
              color="bg-gradient-to-r from-[var(--color-master-400)] to-[var(--color-master-600)]"
            />
            <KpiCard
              label="Productos distintos"
              value={data.kpis.distinctProducts.toLocaleString("es-NI")}
              sub={`SKUs vendidos`}
              icon={BarChart3}
              color="bg-gradient-to-r from-[var(--color-branch-admin-400)] to-[var(--color-branch-admin-600)]"
            />
          </div>

          {/* ── Charts ── */}
          <div className="grid gap-4 lg:grid-cols-2">

            {/* Ventas por día */}
            <div className="hm-module-card p-4">
              <p className="text-[0.6875rem] font-bold uppercase tracking-wide text-[var(--color-text-muted)] mb-3">
                Ventas por día
              </p>
              {data.byDay.length === 0 ? (
                <p className="text-xs text-[var(--color-text-muted)] py-6 text-center">Sin datos.</p>
              ) : (
                <ResponsiveContainer width="100%" height={220}>
                  <BarChart data={data.byDay.map((r) => ({ name: fmtDate(r.date), total: r.total_sold }))} margin={{ top: 4, right: 8, left: 0, bottom: 4 }}>
                    <CartesianGrid strokeDasharray="3 3" stroke="var(--color-border)" />
                    <XAxis dataKey="name" tick={{ fontSize: 10 }} />
                    <YAxis tickFormatter={(v: unknown) => NIO.format(Number(v)).replace("NIO", "").trim()} tick={{ fontSize: 10 }} />
                    <Tooltip formatter={(v: unknown) => [NIO.format(Number(v)), "Total"]} />
                    <Bar dataKey="total" fill="var(--color-info-500)" radius={[3, 3, 0, 0]} />
                  </BarChart>
                </ResponsiveContainer>
              )}
            </div>

            {/* Top 10 productos por cantidad */}
            <div className="hm-module-card p-4">
              <p className="text-[0.6875rem] font-bold uppercase tracking-wide text-[var(--color-text-muted)] mb-3">
                Top 10 productos — por cantidad
              </p>
              {topQtyChart.length === 0 ? (
                <p className="text-xs text-[var(--color-text-muted)] py-6 text-center">Sin datos.</p>
              ) : (
                <ResponsiveContainer width="100%" height={220}>
                  <BarChart data={topQtyChart} layout="vertical" margin={{ top: 4, right: 16, left: 4, bottom: 4 }}>
                    <CartesianGrid strokeDasharray="3 3" stroke="var(--color-border)" horizontal={false} />
                    <XAxis type="number" tick={{ fontSize: 10 }} />
                    <YAxis type="category" dataKey="name" width={120} tick={{ fontSize: 10 }} />
                    <Tooltip formatter={(v: unknown) => [Number(v).toLocaleString("es-NI"), "Unidades"]} />
                    <Bar dataKey="qty" fill="var(--color-success-500)" radius={[0, 3, 3, 0]} />
                  </BarChart>
                </ResponsiveContainer>
              )}
            </div>

            {/* Top 10 productos por monto */}
            <div className="hm-module-card p-4">
              <p className="text-[0.6875rem] font-bold uppercase tracking-wide text-[var(--color-text-muted)] mb-3">
                Top 10 productos — por monto
              </p>
              {topAmtChart.length === 0 ? (
                <p className="text-xs text-[var(--color-text-muted)] py-6 text-center">Sin datos.</p>
              ) : (
                <ResponsiveContainer width="100%" height={220}>
                  <BarChart data={topAmtChart} layout="vertical" margin={{ top: 4, right: 16, left: 4, bottom: 4 }}>
                    <CartesianGrid strokeDasharray="3 3" stroke="var(--color-border)" horizontal={false} />
                    <XAxis type="number" tickFormatter={(v: unknown) => NIO.format(Number(v)).replace("NIO", "").trim()} tick={{ fontSize: 10 }} />
                    <YAxis type="category" dataKey="name" width={120} tick={{ fontSize: 10 }} />
                    <Tooltip formatter={(v: unknown) => [NIO.format(Number(v)), "Subtotal"]} />
                    <Bar dataKey="monto" fill="var(--color-warning-500)" radius={[0, 3, 3, 0]} />
                  </BarChart>
                </ResponsiveContainer>
              )}
            </div>

            {/* Pie charts: sucursal + categoría */}
            <div className="grid gap-4">
              {/* Por sucursal */}
              <div className="hm-module-card p-4">
                <p className="text-[0.6875rem] font-bold uppercase tracking-wide text-[var(--color-text-muted)] mb-2">
                  Distribución por sucursal
                </p>
                {data.byBranch.length === 0 ? (
                  <p className="text-xs text-[var(--color-text-muted)] py-4 text-center">Sin datos.</p>
                ) : (
                  <ResponsiveContainer width="100%" height={100}>
                    <PieChart>
                      <Pie data={data.byBranch.map((r) => ({ name: r.branch_code, value: r.total_sold }))} cx="50%" cy="50%" outerRadius={40} dataKey="value">
                        {data.byBranch.map((_, i) => (
                          <Cell key={i} fill={CHART_COLORS[i % CHART_COLORS.length]} />
                        ))}
                      </Pie>
                      <Tooltip formatter={(v: unknown) => [NIO.format(Number(v)), "Ventas"]} />
                      <Legend iconSize={8} wrapperStyle={{ fontSize: "0.65rem" }} />
                    </PieChart>
                  </ResponsiveContainer>
                )}
              </div>

              {/* Por categoría */}
              <div className="hm-module-card p-4">
                <p className="text-[0.6875rem] font-bold uppercase tracking-wide text-[var(--color-text-muted)] mb-2">
                  Distribución por categoría
                </p>
                {data.byCategory.length === 0 ? (
                  <p className="text-xs text-[var(--color-text-muted)] py-4 text-center">Sin datos.</p>
                ) : (
                  <ResponsiveContainer width="100%" height={100}>
                    <PieChart>
                      <Pie data={data.byCategory.map((r) => ({ name: r.category_name, value: r.total_sold }))} cx="50%" cy="50%" outerRadius={40} dataKey="value">
                        {data.byCategory.map((_, i) => (
                          <Cell key={i} fill={CHART_COLORS[i % CHART_COLORS.length]} />
                        ))}
                      </Pie>
                      <Tooltip formatter={(v: unknown) => [NIO.format(Number(v)), "Subtotal"]} />
                      <Legend iconSize={8} wrapperStyle={{ fontSize: "0.65rem" }} />
                    </PieChart>
                  </ResponsiveContainer>
                )}
              </div>
            </div>
          </div>

          {/* ── Table: por día ── */}
          <div className="hm-module-card">
            <div className="hm-module-card-header">
              <p className="font-bold text-sm text-[var(--color-text)]">Resumen por día</p>
              <button type="button" className="hm-icon-btn" title="Exportar CSV" onClick={exportDaysCsv}>
                <Download className="h-3.5 w-3.5" />
              </button>
            </div>
            <div className="overflow-x-auto">
              <table className="hm-table w-full">
                <thead>
                  <tr>
                    <th className="text-left text-xs">
                      <SortHeader label="Fecha" sortKey="date" current={daySort.key} dir={daySort.dir} onSort={sortDay} />
                    </th>
                    <th className="text-right text-xs">
                      <SortHeader label="Total" sortKey="total_sold" current={daySort.key} dir={daySort.dir} onSort={sortDay} />
                    </th>
                    <th className="text-right text-xs">
                      <SortHeader label="Órdenes" sortKey="orders_count" current={daySort.key} dir={daySort.dir} onSort={sortDay} />
                    </th>
                    <th className="text-right text-xs">
                      <SortHeader label="Unidades" sortKey="units_sold" current={daySort.key} dir={daySort.dir} onSort={sortDay} />
                    </th>
                    <th className="text-right text-xs">
                      <SortHeader label="Distintos" sortKey="distinct_products" current={daySort.key} dir={daySort.dir} onSort={sortDay} />
                    </th>
                    <th className="text-right text-xs">Ticket prom.</th>
                    <th />
                  </tr>
                </thead>
                <tbody>
                  {sortedDays.map((r) => (
                    <tr key={r.date} className="hover:bg-[var(--color-surface-alt)] transition-colors">
                      <td className="font-mono text-xs">{fmtDate(r.date)}</td>
                      <td className="text-right tabular-nums">{NIO.format(r.total_sold)}</td>
                      <td className="text-right tabular-nums">{r.orders_count}</td>
                      <td className="text-right tabular-nums">{Number(r.units_sold).toLocaleString("es-NI")}</td>
                      <td className="text-right tabular-nums">{r.distinct_products}</td>
                      <td className="text-right tabular-nums">
                        {r.orders_count > 0 ? NION.format(r.total_sold / r.orders_count) : "—"}
                      </td>
                      <td className="text-right">
                        <button
                          type="button"
                          className="text-[0.625rem] text-[var(--color-info-600)] hover:underline"
                          onClick={() => void openDrilldown(r.date)}
                        >
                          Ver productos
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>

          {/* ── Table: top productos ── */}
          <div className="hm-module-card">
            <div className="hm-module-card-header">
              <p className="font-bold text-sm text-[var(--color-text)]">Top productos (hasta 20)</p>
              <button type="button" className="hm-icon-btn" title="Exportar CSV" onClick={exportProductsCsv}>
                <Download className="h-3.5 w-3.5" />
              </button>
            </div>
            <div className="overflow-x-auto">
              <table className="hm-table w-full">
                <thead>
                  <tr>
                    <th className="text-left text-xs">SKU</th>
                    <th className="text-left text-xs">Producto</th>
                    <th className="text-left text-xs">Categoría</th>
                    <th className="text-right text-xs">
                      <SortHeader label="Cantidad" sortKey="total_qty" current={prodSort.key} dir={prodSort.dir} onSort={sortProd} />
                    </th>
                    <th className="text-right text-xs">
                      <SortHeader label="Subtotal" sortKey="total_sold" current={prodSort.key} dir={prodSort.dir} onSort={sortProd} />
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {sortedProds.map((r, i) => (
                    <tr key={r.product_id} className={i % 2 === 0 ? "" : "bg-[var(--color-surface-alt)/30]"}>
                      <td className="font-mono text-xs">{r.sku}</td>
                      <td className="max-w-[220px] truncate text-sm">{r.name}</td>
                      <td className="text-xs text-[var(--color-text-muted)]">{r.category_name}</td>
                      <td className="text-right tabular-nums">{Number(r.total_qty).toLocaleString("es-NI")}</td>
                      <td className="text-right tabular-nums">{NIO.format(r.total_sold)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>

          <p className="text-[0.6rem] text-[var(--color-text-soft)] text-right">
            Datos calculados al {new Date(data.generatedAt).toLocaleString("es-NI")} · Solo órdenes PAID / DISPATCH_PENDING / DISPATCHED
          </p>
        </>
      )}

      {/* ── Drilldown modal ── */}
      {drillDate && (
        <DrilldownModal
          date={drillDate}
          rows={drillRows}
          loading={drillLoading}
          onClose={() => { setDrillDate(null); setDrillRows([]); }}
        />
      )}
    </div>
  );
}
