"use client";

import { useState, useEffect, useCallback } from "react";
import {
  BarChart3, TrendingUp, TrendingDown, Package, AlertTriangle,
  Loader2, RefreshCw, Zap, Target, Clock, ArrowUpRight, ArrowDownRight,
  CheckCircle2, Filter,
} from "lucide-react";
import { apiFetch } from "@/lib/client/api";

type DashboardData = {
  abcDistribution: { A: number; B: number; C: number; unclassified: number };
  xyzDistribution: { X: number; Y: number; Z: number; unclassified: number };
  avgRotationByClass: Record<string, number>;
  lowRotationProducts: ProductRow[];
  highValueProducts: ProductRow[];
  staleProducts: ProductRow[];
  recommendations: string[];
};

type ProductRow = {
  id: string;
  sku: string;
  name: string;
  abcClassification?: string | null;
  xyzClassification?: string | null;
  rotationIndex?: string | null;
  daysInStock?: number | null;
  suggestedMargin?: string | null;
  standardSalePrice?: string | null;
};

type AnalyticsProduct = ProductRow & {
  category?: { name: string };
  averageDailySales?: string | null;
  lastClassificationAt?: string | null;
  dynamicPrice?: any;
};

const ABC_COLORS = { A: "bg-[var(--color-success-500)]", B: "bg-[var(--color-info-500)]", C: "bg-[var(--color-warning-500)]" };
const ABC_BG = { A: "bg-[var(--color-success-50)] text-[var(--color-success-700)] border-[var(--color-success-100)]", B: "bg-[var(--color-info-50)] text-[var(--color-info-700)] border-[var(--color-info-200)]", C: "bg-[var(--color-warning-50)] text-[var(--color-warning-700)] border-[var(--color-warning-100)]" };
const XYZ_BG = { X: "bg-[var(--color-success-50)] text-[var(--color-success-700)]", Y: "bg-[var(--color-branch-admin-50)] text-[var(--color-branch-admin-700)]", Z: "bg-[var(--color-danger-50)] text-[var(--color-danger-700)]" };

export function AnalyticsDashboard() {
  const [dashboard, setDashboard] = useState<DashboardData | null>(null);
  const [products, setProducts] = useState<AnalyticsProduct[]>([]);
  const [loading, setLoading] = useState(false);
  const [classifyLoading, setClassifyLoading] = useState(false);
  const [activeTab, setActiveTab] = useState<"overview" | "products" | "recommendations">("overview");
  const [notice, setNotice] = useState<{ type: "success" | "error"; msg: string } | null>(null);
  const [filterABC, setFilterABC] = useState("");
  const [filterXYZ, setFilterXYZ] = useState("");

  const flash = useCallback((type: "success" | "error", msg: string) => {
    setNotice({ type, msg });
    setTimeout(() => setNotice(null), 5000);
  }, []);

  const loadDashboard = useCallback(async () => {
    setLoading(true);
    try {
      const r = await fetch("/api/analytics/dashboard");
      const j = await r.json();
      // BUG FIX: Show error when API fails
      if (!r.ok) {
        flash("error", j.error ?? j.message ?? "Error al cargar dashboard");
        return;
      }
      setDashboard(j.data ?? null);
    } catch {
      flash("error", "Error de conexión al cargar dashboard");
    } finally {
      setLoading(false);
    }
  }, [flash]);

  const loadProducts = useCallback(async () => {
    setLoading(true);
    try {
      const params = new URLSearchParams();
      if (filterABC) params.set("abcClass", filterABC);
      if (filterXYZ) params.set("xyzClass", filterXYZ);
      params.set("take", "100");
      const r = await fetch(`/api/analytics/products?${params.toString()}`);
      const j = await r.json();
      // BUG FIX: Show error when API fails
      if (!r.ok) {
        flash("error", j.error ?? j.message ?? "Error al cargar productos");
        return;
      }
      setProducts(j.data ?? []);
    } catch {
      flash("error", "Error de conexión al cargar productos");
    } finally {
      setLoading(false);
    }
  }, [filterABC, filterXYZ, flash]);

  useEffect(() => { loadDashboard(); }, [loadDashboard]);
  useEffect(() => { if (activeTab === "products") loadProducts(); }, [activeTab, loadProducts]);

  const handleClassify = async () => {
    setClassifyLoading(true);
    try {
      const d = new Date();
      const month = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
      const r = await apiFetch("/api/analytics/classify", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ month }),
      });
      const j = await r.json();
      if (!r.ok) { flash("error", j.error ?? "Error"); return; }
      flash("success", `Clasificación completada: ABC=${j.data.abc.classified}, XYZ=${j.data.xyz.classified} productos`);
      await loadDashboard();
    } finally {
      setClassifyLoading(false);
    }
  };

  const total = dashboard ? dashboard.abcDistribution.A + dashboard.abcDistribution.B + dashboard.abcDistribution.C : 0;

  return (
    <div className="space-y-6">
      {/* Notice */}
      {notice && (
        <div className={`flex items-center gap-2 p-3 rounded-lg text-sm font-medium ${
          notice.type === "success" ? "bg-[var(--color-success-50)] text-[var(--color-success-700)] border border-[var(--color-success-100)]" : "bg-[var(--color-danger-50)] text-[var(--color-danger-700)] border border-[var(--color-danger-100)]"
        }`}>
          {notice.type === "success" ? <CheckCircle2 className="h-4 w-4" /> : <AlertTriangle className="h-4 w-4" />}
          {notice.msg}
        </div>
      )}

      {/* Header actions */}
      <div className="flex flex-wrap items-center gap-3">
        <button
          onClick={handleClassify}
          disabled={classifyLoading}
          className="flex items-center gap-2 bg-[var(--color-info-600)] hover:bg-[var(--color-info-700)] text-white px-5 py-2.5 rounded-lg text-sm font-medium min-h-[44px] disabled:opacity-50 transition-colors"
        >
          {classifyLoading ? <Loader2 className="h-4 w-4 animate-spin" /> : <Zap className="h-4 w-4" />}
          Ejecutar Clasificación ABC-XYZ
        </button>
        <button
          onClick={loadDashboard}
          className="flex items-center gap-2 bg-[var(--color-border)] hover:bg-[var(--color-border-strong)] text-[var(--color-text)] px-4 py-2.5 rounded-lg text-sm font-medium min-h-[44px] transition-colors"
        >
          <RefreshCw className="h-4 w-4" /> Actualizar
        </button>
      </div>

      {/* Tabs */}
      <div className="flex gap-1 bg-[var(--color-surface-alt)] rounded-lg p-1">
        {[
          { key: "overview" as const, label: "Resumen", icon: BarChart3 },
          { key: "products" as const, label: "Productos", icon: Package },
          { key: "recommendations" as const, label: "Recomendaciones", icon: Target },
        ].map((tab) => (
          <button
            key={tab.key}
            onClick={() => setActiveTab(tab.key)}
            className={`flex items-center gap-2 px-4 py-2.5 rounded-md text-sm font-medium transition-all min-h-[44px] flex-1 justify-center ${
              activeTab === tab.key ? "bg-[var(--color-surface)] text-[var(--color-info-700)] shadow-sm" : "text-[var(--color-text-muted)] hover:text-[var(--color-text)]"
            }`}
          >
            <tab.icon className="h-4 w-4" /> {tab.label}
          </button>
        ))}
      </div>

      {loading && !dashboard && (
        <div className="flex items-center justify-center py-12">
          <Loader2 className="h-8 w-8 animate-spin text-[var(--color-info-500)]" />
        </div>
      )}

      {/* ── Tab: Overview ── */}
      {activeTab === "overview" && dashboard && (
        <div className="space-y-6">
          {/* ABC Distribution Cards */}
          <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
            {(["A", "B", "C"] as const).map((cls) => (
              <div key={cls} className={`rounded-xl border p-5 ${ABC_BG[cls]}`}>
                <div className="flex items-center justify-between mb-2">
                  <span className="text-3xl font-bold">{cls}</span>
                  <span className={`w-3 h-3 rounded-full ${ABC_COLORS[cls]}`} />
                </div>
                <p className="text-2xl font-bold">{dashboard.abcDistribution[cls]}</p>
                <p className="text-sm opacity-80">
                  {total > 0 ? Math.round((dashboard.abcDistribution[cls] / total) * 100) : 0}% del total clasificado
                </p>
                <p className="text-xs mt-1 opacity-60">
                  Rotación prom: {(dashboard.avgRotationByClass[cls] ?? 0).toFixed(2)}
                </p>
              </div>
            ))}
            <div className="rounded-xl border border-[var(--color-border)] bg-[var(--color-surface-alt)] p-5">
              <div className="flex items-center justify-between mb-2">
                <span className="text-lg font-semibold text-[var(--color-text-soft)]">Sin clasificar</span>
              </div>
              <p className="text-2xl font-bold text-[var(--color-text-secondary)]">{dashboard.abcDistribution.unclassified}</p>
              <p className="text-sm text-[var(--color-text-soft)]">Ejecutar clasificación</p>
            </div>
          </div>

          {/* XYZ Distribution */}
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            {(["X", "Y", "Z"] as const).map((cls) => (
              <div key={cls} className={`rounded-xl p-5 ${XYZ_BG[cls]}`}>
                <p className="text-sm font-semibold mb-1">Clase {cls}</p>
                <p className="text-2xl font-bold">{dashboard.xyzDistribution[cls]}</p>
                <p className="text-xs opacity-70">
                  {cls === "X" ? "Demanda estable (CV<0.5)" : cls === "Y" ? "Demanda variable (0.5≤CV<1)" : "Demanda irregular (CV≥1)"}
                </p>
              </div>
            ))}
          </div>

          {/* Critical Products Tables */}
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
            {/* Low rotation */}
            <div className="bg-[var(--color-surface)] rounded-xl shadow-sm border border-[var(--color-border)] overflow-hidden">
              <div className="p-4 border-b border-[var(--color-border)] flex items-center gap-2">
                <TrendingDown className="h-5 w-5 text-[var(--color-warning-500)]" />
                <h4 className="font-semibold text-[var(--color-text)]">Baja Rotación</h4>
              </div>
              <div className="overflow-x-auto">
                <table className="w-full text-left">
                  <thead className="bg-[var(--color-surface-alt)] text-xs font-semibold text-[var(--color-text-muted)] uppercase">
                    <tr><th className="px-3 py-2">Producto</th><th className="px-3 py-2">ABC</th><th className="px-3 py-2 text-right">IR</th><th className="px-3 py-2 text-right">Días</th></tr>
                  </thead>
                  <tbody className="divide-y divide-[var(--color-border)]">
                    {dashboard.lowRotationProducts.map((p) => (
                      <tr key={p.id} className="hover:bg-[var(--color-surface-alt)]">
                        <td className="px-3 py-2 text-sm">{p.name}</td>
                        <td className="px-3 py-2"><span className={`px-2 py-0.5 rounded text-xs font-bold ${ABC_BG[p.abcClassification as "A"|"B"|"C"] ?? "bg-[var(--color-surface-alt)] text-[var(--color-text-muted)]"}`}>{p.abcClassification ?? "—"}</span></td>
                        <td className="px-3 py-2 text-sm text-right font-mono">{Number(p.rotationIndex ?? 0).toFixed(2)}</td>
                        <td className="px-3 py-2 text-sm text-right">{p.daysInStock ?? "—"}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>

            {/* Stale products */}
            <div className="bg-[var(--color-surface)] rounded-xl shadow-sm border border-[var(--color-border)] overflow-hidden">
              <div className="p-4 border-b border-[var(--color-border)] flex items-center gap-2">
                <Clock className="h-5 w-5 text-[var(--color-danger-500)]" />
                <h4 className="font-semibold text-[var(--color-text)]">Productos Estancados (&gt;60 días)</h4>
              </div>
              <div className="overflow-x-auto">
                <table className="w-full text-left">
                  <thead className="bg-[var(--color-surface-alt)] text-xs font-semibold text-[var(--color-text-muted)] uppercase">
                    <tr><th className="px-3 py-2">Producto</th><th className="px-3 py-2">ABC</th><th className="px-3 py-2 text-right">Días</th><th className="px-3 py-2 text-right">Margen</th></tr>
                  </thead>
                  <tbody className="divide-y divide-[var(--color-border)]">
                    {dashboard.staleProducts.map((p) => (
                      <tr key={p.id} className="hover:bg-[var(--color-surface-alt)]">
                        <td className="px-3 py-2 text-sm">{p.name}</td>
                        <td className="px-3 py-2"><span className={`px-2 py-0.5 rounded text-xs font-bold ${ABC_BG[p.abcClassification as "A"|"B"|"C"] ?? "bg-[var(--color-surface-alt)] text-[var(--color-text-muted)]"}`}>{p.abcClassification ?? "—"}</span></td>
                        <td className="px-3 py-2 text-sm text-right font-semibold text-[var(--color-danger-600)]">{p.daysInStock}</td>
                        <td className="px-3 py-2 text-sm text-right">{p.suggestedMargin ? `${Number(p.suggestedMargin).toFixed(1)}%` : "—"}</td>
                      </tr>
                    ))}
                    {dashboard.staleProducts.length === 0 && (
                      <tr><td colSpan={4} className="px-3 py-4 text-center text-sm text-[var(--color-text-soft)]">Sin productos estancados</td></tr>
                    )}
                  </tbody>
                </table>
              </div>
            </div>
          </div>

          {/* High value */}
          <div className="bg-[var(--color-surface)] rounded-xl shadow-sm border border-[var(--color-border)] overflow-hidden">
            <div className="p-4 border-b border-[var(--color-border)] flex items-center gap-2">
              <TrendingUp className="h-5 w-5 text-[var(--color-success-500)]" />
              <h4 className="font-semibold text-[var(--color-text)]">Productos de Alto Valor (Clase A)</h4>
            </div>
            <div className="overflow-x-auto">
              <table className="w-full text-left">
                <thead className="bg-[var(--color-surface-alt)] text-xs font-semibold text-[var(--color-text-muted)] uppercase">
                  <tr>
                    <th className="px-4 py-3">SKU</th>
                    <th className="px-4 py-3">Producto</th>
                    <th className="px-4 py-3">ABC-XYZ</th>
                    <th className="px-4 py-3 text-right">Precio</th>
                    <th className="px-4 py-3 text-right">Rotación</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-[var(--color-border)]">
                  {dashboard.highValueProducts.map((p) => (
                    <tr key={p.id} className="hover:bg-[var(--color-surface-alt)]">
                      <td className="px-4 py-3 text-sm font-mono text-[var(--color-text-muted)]">{p.sku}</td>
                      <td className="px-4 py-3 text-sm font-medium text-[var(--color-text)]">{p.name}</td>
                      <td className="px-4 py-3">
                        <span className="text-xs font-bold">{p.abcClassification ?? ""}{p.xyzClassification ?? ""}</span>
                      </td>
                      <td className="px-4 py-3 text-sm text-right font-mono">C${Number(p.standardSalePrice ?? 0).toFixed(2)}</td>
                      <td className="px-4 py-3 text-sm text-right font-mono">{Number(p.rotationIndex ?? 0).toFixed(2)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      )}

      {/* ── Tab: Products ── */}
      {activeTab === "products" && (
        <div className="space-y-4">
          <div className="flex flex-wrap gap-3 items-center">
            <div className="flex items-center gap-2">
              <Filter className="h-4 w-4 text-[var(--color-text-soft)]" />
              <select value={filterABC} onChange={(e) => setFilterABC(e.target.value)} className="border border-[var(--color-border-strong)] rounded-lg px-3 py-2 text-sm min-h-[44px]">
                <option value="">Todas las clases ABC</option>
                <option value="A">Clase A</option>
                <option value="B">Clase B</option>
                <option value="C">Clase C</option>
              </select>
              <select value={filterXYZ} onChange={(e) => setFilterXYZ(e.target.value)} className="border border-[var(--color-border-strong)] rounded-lg px-3 py-2 text-sm min-h-[44px]">
                <option value="">Todas las clases XYZ</option>
                <option value="X">Clase X</option>
                <option value="Y">Clase Y</option>
                <option value="Z">Clase Z</option>
              </select>
            </div>
          </div>

          <div className="bg-[var(--color-surface)] rounded-xl shadow-sm border border-[var(--color-border)] overflow-hidden">
            <div className="overflow-x-auto">
              <table className="w-full text-left">
                <thead className="bg-[var(--color-surface-alt)] text-xs font-semibold text-[var(--color-text-muted)] uppercase tracking-wider">
                  <tr>
                    <th className="px-4 py-3">SKU</th>
                    <th className="px-4 py-3">Producto</th>
                    <th className="px-4 py-3">Categoría</th>
                    <th className="px-4 py-3 text-center">ABC-XYZ</th>
                    <th className="px-4 py-3 text-right">IR</th>
                    <th className="px-4 py-3 text-right">Vta/día</th>
                    <th className="px-4 py-3 text-right">Días stock</th>
                    <th className="px-4 py-3 text-right">Margen sug.</th>
                    <th className="px-4 py-3 text-right">Precio</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-[var(--color-border)]">
                  {products.map((p) => (
                    <tr key={p.id} className="hover:bg-[var(--color-surface-alt)]">
                      <td className="px-4 py-3 text-sm font-mono text-[var(--color-text-muted)]">{p.sku}</td>
                      <td className="px-4 py-3 text-sm font-medium text-[var(--color-text)]">{p.name}</td>
                      <td className="px-4 py-3 text-sm text-[var(--color-text-muted)]">{p.category?.name ?? "—"}</td>
                      <td className="px-4 py-3 text-center">
                        <span className={`inline-flex px-2 py-0.5 rounded text-xs font-bold ${ABC_BG[p.abcClassification as "A"|"B"|"C"] ?? "bg-[var(--color-surface-alt)] text-[var(--color-text-muted)]"}`}>
                          {p.abcClassification ?? "—"}
                        </span>
                        <span className={`ml-1 inline-flex px-2 py-0.5 rounded text-xs font-bold ${XYZ_BG[p.xyzClassification as "X"|"Y"|"Z"] ?? "bg-[var(--color-surface-alt)] text-[var(--color-text-muted)]"}`}>
                          {p.xyzClassification ?? "—"}
                        </span>
                      </td>
                      <td className="px-4 py-3 text-sm text-right font-mono">{Number(p.rotationIndex ?? 0).toFixed(2)}</td>
                      <td className="px-4 py-3 text-sm text-right font-mono">{Number(p.averageDailySales ?? 0).toFixed(1)}</td>
                      <td className="px-4 py-3 text-sm text-right">
                        <span className={`font-semibold ${(p.daysInStock ?? 0) > 60 ? "text-[var(--color-danger-600)]" : (p.daysInStock ?? 0) > 30 ? "text-[var(--color-warning-600)]" : "text-[var(--color-text-secondary)]"}`}>
                          {p.daysInStock ?? "—"}
                        </span>
                      </td>
                      <td className="px-4 py-3 text-sm text-right">{p.suggestedMargin ? `${Number(p.suggestedMargin).toFixed(1)}%` : "—"}</td>
                      <td className="px-4 py-3 text-sm text-right font-mono">C${Number(p.standardSalePrice ?? 0).toFixed(2)}</td>
                    </tr>
                  ))}
                  {products.length === 0 && (
                    <tr><td colSpan={9} className="px-4 py-8 text-center text-sm text-[var(--color-text-soft)]">
                      {loading ? "Cargando..." : "Sin productos clasificados. Ejecute la clasificación primero."}
                    </td></tr>
                  )}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      )}

      {/* ── Tab: Recommendations ── */}
      {activeTab === "recommendations" && dashboard && (
        <div className="space-y-6">
          {/* Recommendations */}
          <div className="bg-[var(--color-surface)] rounded-xl shadow-sm border border-[var(--color-border)] p-6">
            <h4 className="font-semibold text-[var(--color-text)] mb-4 flex items-center gap-2"><Target className="h-5 w-5 text-[var(--color-info-600)]" />Recomendaciones Automáticas</h4>
            {dashboard.recommendations.length === 0 ? (
              <p className="text-sm text-[var(--color-text-soft)]">No hay recomendaciones en este momento. Ejecute la clasificación primero.</p>
            ) : (
              <div className="space-y-3">
                {dashboard.recommendations.map((rec, i) => (
                  <div key={i} className="flex items-start gap-3 p-4 bg-[var(--color-warning-50)] border border-[var(--color-warning-100)] rounded-lg">
                    <AlertTriangle className="h-5 w-5 text-[var(--color-warning-500)] flex-shrink-0 mt-0.5" />
                    <p className="text-sm text-[var(--color-warning-700)]">{rec}</p>
                  </div>
                ))}
              </div>
            )}
          </div>

          {/* Strategy Matrix */}
          <div className="bg-[var(--color-surface)] rounded-xl shadow-sm border border-[var(--color-border)] p-6">
            <h4 className="font-semibold text-[var(--color-text)] mb-4">Matriz de Estrategias ABC-XYZ</h4>
            <div className="overflow-x-auto">
              <table className="w-full text-sm border-collapse">
                <thead>
                  <tr>
                    <th className="p-3 bg-[var(--color-surface-alt)] border border-[var(--color-border)]"></th>
                    <th className="p-3 bg-[var(--color-success-50)] border border-[var(--color-border)] font-semibold text-[var(--color-success-700)]">X (Estable)</th>
                    <th className="p-3 bg-[var(--color-branch-admin-50)] border border-[var(--color-border)] font-semibold text-[var(--color-branch-admin-700)]">Y (Variable)</th>
                    <th className="p-3 bg-[var(--color-danger-50)] border border-[var(--color-border)] font-semibold text-[var(--color-danger-700)]">Z (Irregular)</th>
                  </tr>
                </thead>
                <tbody>
                  {[
                    { cls: "A", label: "Alto valor", strategies: ["EDLP, stock seguro alto, margen 15-20%", "Promociones periódicas, margen 20-25%", "Control estricto, margen 25-30%"] },
                    { cls: "B", label: "Valor medio", strategies: ["Stock estable, margen 25-30%", "Revisión quincenal, margen 30-35%", "Pedidos bajo demanda, margen 35-40%"] },
                    { cls: "C", label: "Bajo valor", strategies: ["Stock mínimo, margen 35-40%", "Evaluar eliminación, margen 40-45%", "Liquidar si >90 días, margen 45-50%"] },
                  ].map((row) => (
                    <tr key={row.cls}>
                      <td className={`p-3 border border-[var(--color-border)] font-semibold ${ABC_BG[row.cls as "A"|"B"|"C"]}`}>{row.cls} ({row.label})</td>
                      {row.strategies.map((s, i) => (
                        <td key={i} className="p-3 border border-[var(--color-border)] text-[var(--color-text-secondary)]">{s}</td>
                      ))}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
