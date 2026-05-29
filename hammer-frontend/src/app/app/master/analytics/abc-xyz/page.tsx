"use client";

import { useState, useEffect, useCallback } from "react";
import {
  Loader2,
  AlertTriangle,
  CheckCircle,
  Search,
  Grid3x3,
  Table,
} from "lucide-react";
import { apiFetch, unwrapApiData } from "@/lib/client/api";

/* ── Types ── */
type ProductClassification = {
  id: string;
  sku: string;
  name: string;
  category: { name: string };
  unit: string;
  standardSalePrice: number;
  abcClassification: string | null;
  xyzClassification: string | null;
  rotationIndex: number | null;
  averageDailySales: number | null;
  daysInStock: number | null;
  suggestedMargin: number | null;
  lastClassificationAt: string | null;
  suggestedAbcClassification: string | null;
  suggestedXyzClassification: string | null;
  suggestionStatus: "READY" | "INSUFFICIENT_DATA";
  suggestionReason: string | null;
  isManualOverride: boolean;
};

type Stats = {
  total: number;
  classified: number;
  unclassified: number;
  byAbc: { A: number; B: number; C: number };
  byXyz: { X: number; Y: number; Z: number };
};
type ClassificationField = "abcClassification" | "xyzClassification";

function getErrorMessage(error: unknown, fallback: string) {
  return error instanceof Error ? error.message : fallback;
}

/* ── CSS variable-based color mappings ── */
const ABC_COLORS: Record<string, { bg: string; text: string; border: string }> = {
  A: { bg: "var(--color-success-50)", text: "var(--color-success-700)", border: "var(--color-success-100)" },
  B: { bg: "var(--color-warning-50)", text: "var(--color-warning-700)", border: "var(--color-warning-100)" },
  C: { bg: "var(--color-danger-50)", text: "var(--color-danger-700)", border: "var(--color-danger-100)" },
};

const XYZ_COLORS: Record<string, { bg: string; text: string; border: string }> = {
  X: { bg: "var(--color-info-50)", text: "var(--color-info-700)", border: "var(--color-info-100)" },
  Y: { bg: "var(--color-branch-admin-50)", text: "var(--color-branch-admin-700)", border: "var(--color-branch-admin-100)" },
  Z: { bg: "var(--color-sales-50)", text: "var(--color-sales-700)", border: "var(--color-sales-100)" },
};

const MATRIX_COLORS: Record<string, { bg: string; text: string }> = {
  AX: { bg: "var(--color-success-100)", text: "var(--color-success-700)" },
  AY: { bg: "var(--color-success-50)", text: "var(--color-success-700)" },
  AZ: { bg: "var(--color-warning-50)", text: "var(--color-warning-700)" },
  BX: { bg: "var(--color-info-50)", text: "var(--color-info-700)" },
  BY: { bg: "var(--color-branch-admin-50)", text: "var(--color-branch-admin-700)" },
  BZ: { bg: "var(--color-sales-50)", text: "var(--color-sales-700)" },
  CX: { bg: "var(--color-warning-50)", text: "var(--color-warning-700)" },
  CY: { bg: "var(--color-sales-50)", text: "var(--color-sales-700)" },
  CZ: { bg: "var(--color-danger-50)", text: "var(--color-danger-700)" },
};

/* ── Classification Badge ── */
function ClassBadge({ value, type }: { value: string | null; type: "abc" | "xyz" }) {
  if (!value) return <span className="text-xs text-[var(--color-text-muted)]">—</span>;

  const colorMap = type === "abc" ? ABC_COLORS : XYZ_COLORS;
  const c = colorMap[value] || { bg: "var(--color-surface-alt)", text: "var(--color-text)", border: "var(--color-border)" };

  return (
    <span
      className="inline-flex items-center justify-center w-7 h-7 rounded-md border text-xs font-bold"
      style={{ backgroundColor: c.bg, color: c.text, borderColor: c.border }}
    >
      {value}
    </span>
  );
}

/* ── Matrix Cell ── */
function MatrixCell({ abc, xyz, count, total }: { abc: string; xyz: string; count: number; total: number }) {
  const pct = total > 0 ? ((count / total) * 100).toFixed(1) : "0";
  const key = `${abc}${xyz}`;
  const c = MATRIX_COLORS[key] || { bg: "var(--color-surface-alt)", text: "var(--color-text)" };

  return (
    <div
      className="rounded-lg p-3 text-center"
      style={{ backgroundColor: c.bg, color: c.text }}
    >
      <div className="text-2xl font-bold">{count}</div>
      <div className="text-xs font-medium opacity-75">{pct}%</div>
    </div>
  );
}

/* ── Main Page ── */
export default function AbcXyzPage() {
  const [products, setProducts] = useState<ProductClassification[]>([]);
  const [stats, setStats] = useState<Stats | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const [search, setSearch] = useState("");
  const [filterAbc, setFilterAbc] = useState<string>("");
  const [filterXyz, setFilterXyz] = useState<string>("");
  const [view, setView] = useState<"table" | "matrix">("table");
  const [saving, setSaving] = useState<string | null>(null);

  const fetchData = useCallback(async () => {
    try {
      setLoading(true);
      const res = await fetch("/api/master/analytics/abc-xyz");
      const raw = await res.json();
      if (!res.ok) throw new Error(raw.error?.message ?? raw.message ?? "Error al cargar datos");
      const json = unwrapApiData(raw);
      setProducts(json.products || []);
      setStats(json.stats || null);
    } catch (error) {
      setError(getErrorMessage(error, "Error al cargar datos"));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { fetchData(); }, [fetchData]);

  const updateClassification = async (productId: string, field: ClassificationField, value: string | null) => {
    try {
      setSaving(productId);
      setError(null);
      const res = await apiFetch(`/api/master/analytics/abc-xyz/${productId}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ [field]: value }),
      });
      const raw = await res.json();
      if (!res.ok) throw new Error(raw.error?.message ?? raw.message ?? "Error al actualizar");
      // Update local state
      setProducts((prev) =>
        prev.map((p) => {
          if (p.id !== productId) return p;
          const updated = { ...p, [field]: value, lastClassificationAt: new Date().toISOString() };
          const hasSuggestion = Boolean(
            updated.suggestedAbcClassification && updated.suggestedXyzClassification,
          );
          const hasApplied = Boolean(updated.abcClassification && updated.xyzClassification);
          return {
            ...updated,
            isManualOverride:
              hasApplied &&
              hasSuggestion &&
              (updated.abcClassification !== updated.suggestedAbcClassification ||
                updated.xyzClassification !== updated.suggestedXyzClassification),
          };
        }),
      );

      // Recalculate stats
      const updated = products.map((p) =>
        p.id === productId ? { ...p, [field]: value } : p,
      );
      setStats({
        total: updated.length,
        classified: updated.filter((p) => p.abcClassification && p.xyzClassification).length,
        unclassified: updated.filter((p) => !p.abcClassification || !p.xyzClassification).length,
        byAbc: {
          A: updated.filter((p) => p.abcClassification === "A").length,
          B: updated.filter((p) => p.abcClassification === "B").length,
          C: updated.filter((p) => p.abcClassification === "C").length,
        },
        byXyz: {
          X: updated.filter((p) => p.xyzClassification === "X").length,
          Y: updated.filter((p) => p.xyzClassification === "Y").length,
          Z: updated.filter((p) => p.xyzClassification === "Z").length,
        },
      });

      setSuccess("Clasificación actualizada");
      setTimeout(() => setSuccess(null), 2000);
    } catch (error) {
      setError(getErrorMessage(error, "Error al actualizar"));
    } finally {
      setSaving(null);
    }
  };

  const applySuggestedClassification = async (product: ProductClassification) => {
    if (!product.suggestedAbcClassification || !product.suggestedXyzClassification) return;
    try {
      setSaving(product.id);
      setError(null);
      const res = await apiFetch(`/api/master/analytics/abc-xyz/${product.id}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          abcClassification: product.suggestedAbcClassification,
          xyzClassification: product.suggestedXyzClassification,
        }),
      });
      const rawApply = await res.json();
      if (!res.ok) throw new Error(rawApply.error?.message ?? rawApply.message ?? "No se pudo aplicar sugerencia");

      setProducts((prev) =>
        prev.map((row) =>
          row.id === product.id
            ? {
                ...row,
                abcClassification: product.suggestedAbcClassification,
                xyzClassification: product.suggestedXyzClassification,
                lastClassificationAt: new Date().toISOString(),
                isManualOverride: false,
              }
            : row,
        ),
      );
      setSuccess("Sugerencia aplicada correctamente");
      setTimeout(() => setSuccess(null), 2000);
    } catch (error) {
      setError(getErrorMessage(error, "No se pudo aplicar sugerencia"));
    } finally {
      setSaving(null);
    }
  };

  const filtered = products.filter((p) => {
    if (search && !p.name.toLowerCase().includes(search.toLowerCase()) && !p.sku.toLowerCase().includes(search.toLowerCase())) return false;
    if (filterAbc && p.abcClassification !== filterAbc) return false;
    if (filterXyz && p.xyzClassification !== filterXyz) return false;
    return true;
  });

  // Matrix data
  const matrixData: Record<string, number> = {};
  for (const abc of ["A", "B", "C"]) {
    for (const xyz of ["X", "Y", "Z"]) {
      matrixData[`${abc}${xyz}`] = products.filter(
        (p) => p.abcClassification === abc && p.xyzClassification === xyz,
      ).length;
    }
  }

  return (
    <section className="space-y-6">
      {/* Header */}
      <div className="flex items-center gap-3">
        <div
          className="h-8 w-1 rounded-full"
          style={{
            background: "linear-gradient(to bottom, var(--color-master-400), var(--color-master-600))",
          }}
        />
        <div>
          <h1 className="text-xl font-bold tracking-tight text-[var(--color-text)]">
            Análisis ABC-XYZ
          </h1>
          <p className="text-sm text-[var(--color-text-muted)]">
            Clasificación asistida por datos reales de ventas (90 días), con override manual opcional.
          </p>
        </div>
      </div>

      {/* Messages */}
      {error && (
        <div className="rounded-lg border bg-[var(--color-danger-50)] border-[var(--color-danger-100)] px-4 py-3 text-sm text-[var(--color-danger-700)] flex items-center gap-2">
          <AlertTriangle className="h-4 w-4 flex-shrink-0" /> {error}
          <button onClick={() => setError(null)} className="ml-auto text-[var(--color-danger-500)] hover:text-[var(--color-danger-700)]">✕</button>
        </div>
      )}
      {success && (
        <div className="rounded-lg border bg-[var(--color-success-50)] border-[var(--color-success-100)] px-4 py-3 text-sm text-[var(--color-success-700)] flex items-center gap-2">
          <CheckCircle className="h-4 w-4 flex-shrink-0" /> {success}
        </div>
      )}

      {loading ? (
        <div className="flex items-center justify-center py-12">
          <Loader2 className="h-6 w-6 animate-spin text-[var(--color-master-500)]" />
          <span className="ml-2 text-sm text-[var(--color-text-muted)]">Cargando productos...</span>
        </div>
      ) : (
        <>
          {/* Stats */}
          {stats && (
            <div className="grid grid-cols-2 md:grid-cols-5 gap-4">
              <div className="rounded-lg border border-[var(--color-border)] bg-[var(--color-surface)] p-4 text-center">
                <div className="text-2xl font-bold text-[var(--color-text)]">{stats.total}</div>
                <div className="text-xs text-[var(--color-text-muted)]">Total Productos</div>
              </div>
              <div className="rounded-lg border p-4 text-center" style={{ borderColor: "var(--color-success-100)", backgroundColor: "var(--color-success-50)" }}>
                <div className="text-2xl font-bold" style={{ color: "var(--color-success-700)" }}>{stats.classified}</div>
                <div className="text-xs" style={{ color: "var(--color-success-600)" }}>Clasificados</div>
              </div>
              <div className="rounded-lg border p-4 text-center" style={{ borderColor: "var(--color-warning-100)", backgroundColor: "var(--color-warning-50)" }}>
                <div className="text-2xl font-bold" style={{ color: "var(--color-warning-700)" }}>{stats.unclassified}</div>
                <div className="text-xs" style={{ color: "var(--color-warning-600)" }}>Sin Clasificar</div>
              </div>
              <div className="rounded-lg border border-[var(--color-border)] bg-[var(--color-surface)] p-4">
                <div className="text-xs font-semibold text-[var(--color-text-secondary)] mb-1">ABC</div>
                <div className="flex gap-2 text-sm">
                  <span style={{ color: "var(--color-success-700)" }} className="font-bold">A:{stats.byAbc.A}</span>
                  <span style={{ color: "var(--color-warning-700)" }} className="font-bold">B:{stats.byAbc.B}</span>
                  <span style={{ color: "var(--color-danger-700)" }} className="font-bold">C:{stats.byAbc.C}</span>
                </div>
              </div>
              <div className="rounded-lg border border-[var(--color-border)] bg-[var(--color-surface)] p-4">
                <div className="text-xs font-semibold text-[var(--color-text-secondary)] mb-1">XYZ</div>
                <div className="flex gap-2 text-sm">
                  <span style={{ color: "var(--color-info-700)" }} className="font-bold">X:{stats.byXyz.X}</span>
                  <span style={{ color: "var(--color-branch-admin-700)" }} className="font-bold">Y:{stats.byXyz.Y}</span>
                  <span style={{ color: "var(--color-sales-700)" }} className="font-bold">Z:{stats.byXyz.Z}</span>
                </div>
              </div>
            </div>
          )}

          {/* View Toggle & Filters */}
          <div className="flex flex-wrap items-center gap-3">
            <div className="flex rounded-lg border border-[var(--color-border)] overflow-hidden">
              <button
                onClick={() => setView("table")}
                className={`flex items-center gap-1.5 px-3 py-1.5 text-sm font-medium transition-colors ${
                  view === "table"
                    ? "bg-[var(--color-master-600)] text-white"
                    : "bg-[var(--color-surface)] text-[var(--color-text-secondary)] hover:bg-[var(--color-surface-alt)]"
                }`}
              >
                <Table className="h-3.5 w-3.5" /> Tabla
              </button>
              <button
                onClick={() => setView("matrix")}
                className={`flex items-center gap-1.5 px-3 py-1.5 text-sm font-medium transition-colors ${
                  view === "matrix"
                    ? "bg-[var(--color-master-600)] text-white"
                    : "bg-[var(--color-surface)] text-[var(--color-text-secondary)] hover:bg-[var(--color-surface-alt)]"
                }`}
              >
                <Grid3x3 className="h-3.5 w-3.5" /> Matriz
              </button>
            </div>

            {view === "table" && (
              <>
                <div className="relative flex-1 min-w-[200px]">
                  <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-[var(--color-text-muted)]" />
                  <input
                    type="text"
                    value={search}
                    onChange={(e) => setSearch(e.target.value)}
                    placeholder="Buscar por nombre o SKU..."
                    className="w-full rounded-lg border border-[var(--color-border)] bg-[var(--color-surface)] pl-9 pr-3 py-1.5 text-sm text-[var(--color-text)]"
                  />
                </div>

                <div className="flex gap-1">
                  {["", "A", "B", "C"].map((v) => (
                    <button
                      key={`abc-${v}`}
                      onClick={() => setFilterAbc(v)}
                      className={`rounded px-2 py-1 text-xs font-medium border transition-colors ${
                        filterAbc === v
                          ? "bg-[var(--color-master-600)] text-white border-[var(--color-master-600)]"
                          : "bg-[var(--color-surface)] text-[var(--color-text-secondary)] border-[var(--color-border)]"
                      }`}
                    >
                      {v || "ABC"}
                    </button>
                  ))}
                </div>
                <div className="flex gap-1">
                  {["", "X", "Y", "Z"].map((v) => (
                    <button
                      key={`xyz-${v}`}
                      onClick={() => setFilterXyz(v)}
                      className={`rounded px-2 py-1 text-xs font-medium border transition-colors ${
                        filterXyz === v
                          ? "bg-[var(--color-master-600)] text-white border-[var(--color-master-600)]"
                          : "bg-[var(--color-surface)] text-[var(--color-text-secondary)] border-[var(--color-border)]"
                      }`}
                    >
                      {v || "XYZ"}
                    </button>
                  ))}
                </div>
              </>
            )}
          </div>

          {/* Matrix View */}
          {view === "matrix" && (
            <div className="rounded-lg border border-[var(--color-border)] bg-[var(--color-surface)] p-6">
              <h3 className="text-sm font-semibold text-[var(--color-text)] mb-4">
                Matriz ABC-XYZ — Distribución de Productos
              </h3>
              <div className="grid grid-cols-4 gap-3">
                {/* Header row */}
                <div />
                <div className="text-center text-sm font-bold" style={{ color: "var(--color-info-700)" }}>X (Estable)</div>
                <div className="text-center text-sm font-bold" style={{ color: "var(--color-branch-admin-700)" }}>Y (Variable)</div>
                <div className="text-center text-sm font-bold" style={{ color: "var(--color-sales-700)" }}>Z (Errática)</div>

                {/* A row */}
                <div className="flex items-center justify-center text-sm font-bold" style={{ color: "var(--color-success-700)" }}>A (Alta rotación)</div>
                <MatrixCell abc="A" xyz="X" count={matrixData["AX"] || 0} total={stats?.total || 0} />
                <MatrixCell abc="A" xyz="Y" count={matrixData["AY"] || 0} total={stats?.total || 0} />
                <MatrixCell abc="A" xyz="Z" count={matrixData["AZ"] || 0} total={stats?.total || 0} />

                {/* B row */}
                <div className="flex items-center justify-center text-sm font-bold" style={{ color: "var(--color-warning-700)" }}>B (Media rotación)</div>
                <MatrixCell abc="B" xyz="X" count={matrixData["BX"] || 0} total={stats?.total || 0} />
                <MatrixCell abc="B" xyz="Y" count={matrixData["BY"] || 0} total={stats?.total || 0} />
                <MatrixCell abc="B" xyz="Z" count={matrixData["BZ"] || 0} total={stats?.total || 0} />

                {/* C row */}
                <div className="flex items-center justify-center text-sm font-bold" style={{ color: "var(--color-danger-700)" }}>C (Baja rotación)</div>
                <MatrixCell abc="C" xyz="X" count={matrixData["CX"] || 0} total={stats?.total || 0} />
                <MatrixCell abc="C" xyz="Y" count={matrixData["CY"] || 0} total={stats?.total || 0} />
                <MatrixCell abc="C" xyz="Z" count={matrixData["CZ"] || 0} total={stats?.total || 0} />
              </div>

              <div className="mt-4 grid grid-cols-3 gap-4 text-xs text-[var(--color-text-muted)]">
                <div>
                  <strong style={{ color: "var(--color-success-700)" }}>A:</strong> Alta rotación — productos con mayor volumen de ventas
                </div>
                <div>
                  <strong style={{ color: "var(--color-warning-700)" }}>B:</strong> Media rotación — productos con ventas moderadas
                </div>
                <div>
                  <strong style={{ color: "var(--color-danger-700)" }}>C:</strong> Baja rotación — productos de lento movimiento
                </div>
                <div>
                  <strong style={{ color: "var(--color-info-700)" }}>X:</strong> Demanda estable — predecible
                </div>
                <div>
                  <strong style={{ color: "var(--color-branch-admin-700)" }}>Y:</strong> Demanda variable — semi-predecible
                </div>
                <div>
                  <strong style={{ color: "var(--color-sales-700)" }}>Z:</strong> Demanda errática — impredecible
                </div>
              </div>
            </div>
          )}

          {/* Table View */}
          {view === "table" && (
            <div className="rounded-lg border border-[var(--color-border)] bg-[var(--color-surface)] overflow-hidden">
              <div className="overflow-x-auto">
                <table className="w-full min-w-[1020px] text-sm">
                <thead>
                  <tr className="border-b border-[var(--color-border)] bg-[var(--color-surface-alt)]">
                    <th className="px-4 py-3 text-left font-semibold text-[var(--color-text-secondary)]">SKU</th>
                    <th className="px-4 py-3 text-left font-semibold text-[var(--color-text-secondary)]">Producto</th>
                    <th className="px-4 py-3 text-left font-semibold text-[var(--color-text-secondary)]">Categoría</th>
                    <th className="px-4 py-3 text-right font-semibold text-[var(--color-text-secondary)]">Precio</th>
                    <th className="px-4 py-3 text-center font-semibold text-[var(--color-text-secondary)]">Sugerida</th>
                    <th className="px-4 py-3 text-center font-semibold text-[var(--color-text-secondary)]">Aplicada</th>
                    <th className="px-4 py-3 text-left font-semibold text-[var(--color-text-secondary)]">Estado</th>
                    <th className="px-4 py-3 text-center font-semibold text-[var(--color-text-secondary)]">Estado aplicado</th>
                  </tr>
                </thead>
                <tbody>
                  {filtered.map((p) => (
                    <tr key={p.id} className="border-b border-[var(--color-border)] hover:bg-[var(--color-surface-alt)] transition-colors">
                      <td className="px-4 py-2.5 font-mono text-xs text-[var(--color-text-muted)]">{p.sku}</td>
                      <td className="px-4 py-2.5 text-[var(--color-text)] font-medium">{p.name}</td>
                      <td className="px-4 py-2.5 text-[var(--color-text-secondary)]">{p.category.name}</td>
                      <td className="px-4 py-2.5 text-right text-[var(--color-text)]">C${Number(p.standardSalePrice).toFixed(2)}</td>
                      <td className="px-4 py-2.5 text-center">
                        {p.suggestedAbcClassification && p.suggestedXyzClassification ? (
                          <span className="inline-flex gap-0.5">
                            <ClassBadge value={p.suggestedAbcClassification} type="abc" />
                            <ClassBadge value={p.suggestedXyzClassification} type="xyz" />
                          </span>
                        ) : (
                          <span className="text-xs text-[var(--color-text-muted)]">—</span>
                        )}
                      </td>
                      <td className="px-4 py-2.5 text-center space-y-1">
                        <span className="inline-flex gap-0.5">
                          <select
                            value={p.abcClassification || ""}
                            onChange={(e) => updateClassification(p.id, "abcClassification", e.target.value || null)}
                            disabled={saving === p.id}
                            className="rounded border border-[var(--color-border)] bg-[var(--color-surface)] px-1.5 py-1 text-xs text-[var(--color-text)] font-medium w-14 text-center disabled:opacity-50"
                          >
                            <option value="">—</option>
                            <option value="A">A</option>
                            <option value="B">B</option>
                            <option value="C">C</option>
                          </select>
                          <select
                            value={p.xyzClassification || ""}
                            onChange={(e) => updateClassification(p.id, "xyzClassification", e.target.value || null)}
                            disabled={saving === p.id}
                            className="rounded border border-[var(--color-border)] bg-[var(--color-surface)] px-1.5 py-1 text-xs text-[var(--color-text)] font-medium w-14 text-center disabled:opacity-50"
                          >
                            <option value="">—</option>
                            <option value="X">X</option>
                            <option value="Y">Y</option>
                            <option value="Z">Z</option>
                          </select>
                        </span>
                        {p.abcClassification && p.xyzClassification ? (
                          <span className="inline-flex gap-0.5 justify-center">
                            <ClassBadge value={p.abcClassification} type="abc" />
                            <ClassBadge value={p.xyzClassification} type="xyz" />
                          </span>
                        ) : (
                          <span className="text-xs text-[var(--color-text-muted)]">Sin clasificar</span>
                        )}
                      </td>
                      <td className="px-4 py-2.5">
                        {p.suggestionStatus === "READY" ? (
                          <span className="inline-flex items-center rounded-md border border-[var(--color-success-100)] bg-[var(--color-success-50)] px-2 py-1 text-xs font-medium text-[var(--color-success-700)]">
                            Suficiente data (90 días)
                          </span>
                        ) : (
                          <span className="inline-flex items-center rounded-md border border-[var(--color-warning-100)] bg-[var(--color-warning-50)] px-2 py-1 text-xs font-medium text-[var(--color-warning-700)]">
                            {p.suggestionReason ?? "Historial insuficiente"}
                          </span>
                        )}
                      </td>
                      <td className="px-4 py-2.5 text-center">
                        {p.abcClassification && p.xyzClassification ? (
                          <div className="space-y-1">
                            <span
                              className={`inline-flex rounded-full px-2 py-0.5 text-xs font-semibold ${
                                p.isManualOverride
                                  ? "bg-[var(--color-warning-50)] text-[var(--color-warning-700)]"
                                  : p.suggestedAbcClassification && p.suggestedXyzClassification
                                    ? "bg-[var(--color-success-50)] text-[var(--color-success-700)]"
                                    : "bg-[var(--color-info-50)] text-[var(--color-info-700)]"
                              }`}
                            >
                              {p.isManualOverride
                                ? "Override manual"
                                : p.suggestedAbcClassification && p.suggestedXyzClassification
                                  ? "Alineado a sugerencia"
                                  : "Manual sin sugerencia"}
                            </span>
                            {p.suggestedAbcClassification && p.suggestedXyzClassification ? (
                              <button
                                type="button"
                                disabled={saving === p.id}
                                onClick={() => applySuggestedClassification(p)}
                                className="rounded-md border border-[var(--color-master-200)] bg-[var(--color-master-50)] px-2 py-1 text-xs font-semibold text-[var(--color-master-700)] disabled:opacity-50"
                              >
                                {p.isManualOverride ? "Revertir a sugerida" : "Reaplicar sugerida"}
                              </button>
                            ) : null}
                          </div>
                        ) : (
                          <span className="text-xs text-[var(--color-text-muted)]">Pendiente aplicar</span>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
                </table>
              </div>
              {filtered.length === 0 && (
                <div className="p-8 text-center text-sm text-[var(--color-text-muted)]">
                  No se encontraron productos con los filtros seleccionados.
                </div>
              )}
            </div>
          )}
        </>
      )}
    </section>
  );
}
