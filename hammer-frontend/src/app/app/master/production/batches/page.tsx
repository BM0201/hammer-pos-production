"use client";

import { useEffect, useState, useMemo, useCallback } from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { apiFetch, unwrapApiData } from "@/lib/client/api";

type Batch = {
  id: string;
  batchNumber: string;
  status: string;
  plannedQuantity: number;
  producedGoodQuantity: number | null;
  producedBadQuantity: number | null;
  materialsCost: number | null;
  totalCost: number | null;
  unitCost: number | null;
  suggestedPrice: number | null;
  createdAt: string;
  completedAt: string | null;
  recipe: { id: string; name: string; code: string };
  branch: { id: string; code: string; name: string };
  createdBy: { id: string; fullName: string };
  _count: { inputs: number };
};

const STATUS_LABELS: Record<string, { label: string; color: string }> = {
  DRAFT: { label: "Borrador", color: "bg-[var(--color-surface-alt)] text-[var(--color-text)]" },
  PLANNED: { label: "Planificado", color: "bg-[var(--color-info-50)] text-[var(--color-info-700)]" },
  IN_PROGRESS: { label: "En Proceso", color: "bg-[var(--color-warning-100)] text-[var(--color-warning-700)]" },
  COMPLETED: { label: "Completado", color: "bg-[var(--color-success-50)] text-[var(--color-success-700)]" },
  CANCELLED: { label: "Cancelado", color: "bg-[var(--color-danger-50)] text-[var(--color-danger-700)]" },
};

const ALL_STATUSES = ["", "DRAFT", "PLANNED", "IN_PROGRESS", "COMPLETED", "CANCELLED"];

function getCostDeviation(batch: Batch): { value: number; label: string; color: string } | null {
  if (batch.status !== "COMPLETED" || batch.unitCost == null || batch.plannedQuantity <= 0) return null;
  // Desviación = (costo real - costo estimado por materiales) / costo estimado
  if (batch.materialsCost == null || batch.materialsCost === 0) return null;
  const estimatedUnitCost = batch.materialsCost / batch.plannedQuantity;
  const deviation = ((batch.unitCost - estimatedUnitCost) / estimatedUnitCost) * 100;
  const absVal = Math.abs(deviation);
  if (absVal < 5) return { value: deviation, label: `${deviation > 0 ? "+" : ""}${deviation.toFixed(1)}%`, color: "text-[var(--color-success-700)]" };
  if (absVal < 15) return { value: deviation, label: `${deviation > 0 ? "+" : ""}${deviation.toFixed(1)}%`, color: "text-yellow-600" };
  return { value: deviation, label: `${deviation > 0 ? "+" : ""}${deviation.toFixed(1)}%`, color: "text-[var(--color-danger-600)]" };
}

export default function BatchesPage() {
  const searchParams = useSearchParams();
  const initialStatus = searchParams.get("status") ?? "";

  const [batches, setBatches] = useState<Batch[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState(initialStatus);
  const [dateFrom, setDateFrom] = useState("");
  const [dateTo, setDateTo] = useState("");

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await apiFetch("/api/master/production/batches?limit=200");
        if (!res.ok) throw new Error("Error al cargar lotes");
        const data = unwrapApiData(await res.json()) as Batch[];
        if (!cancelled) setBatches(data);
      } catch (err) {
        if (!cancelled) setError(err instanceof Error ? err.message : "Error desconocido");
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, []);

  const filtered = useMemo(() => {
    return batches.filter((b) => {
      if (statusFilter && b.status !== statusFilter) return false;
      if (search) {
        const q = search.toLowerCase();
        if (!b.batchNumber.toLowerCase().includes(q) && !b.recipe.name.toLowerCase().includes(q) && !b.recipe.code.toLowerCase().includes(q)) return false;
      }
      if (dateFrom) {
        const d = new Date(b.createdAt);
        if (d < new Date(dateFrom)) return false;
      }
      if (dateTo) {
        const d = new Date(b.createdAt);
        if (d > new Date(dateTo + "T23:59:59")) return false;
      }
      return true;
    });
  }, [batches, search, statusFilter, dateFrom, dateTo]);

  const exportToExcel = useCallback(() => {
    // Generate CSV and download
    const headers = ["Lote", "Receta", "Sucursal", "Estado", "Planificado", "Producido", "Costo Total", "Costo Unit.", "Fecha"];
    const rows = filtered.map((b) => [
      b.batchNumber,
      b.recipe.name,
      b.branch.name,
      STATUS_LABELS[b.status]?.label ?? b.status,
      b.plannedQuantity.toString(),
      b.producedGoodQuantity?.toString() ?? "",
      b.totalCost?.toFixed(2) ?? "",
      b.unitCost?.toFixed(2) ?? "",
      new Date(b.createdAt).toLocaleDateString("es"),
    ]);

    const csv = [headers.join(","), ...rows.map((r) => r.map((c) => `"${c}"`).join(","))].join("\n");
    const blob = new Blob(["\ufeff" + csv], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `lotes_produccion_${new Date().toISOString().slice(0, 10)}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  }, [filtered]);

  return (
    <section className="space-y-6">
      <div>
        <div className="flex items-center gap-3 mb-1">
          <div className="h-8 w-1 rounded-full" style={{ background: "linear-gradient(to bottom, var(--color-master-400), var(--color-master-600))" }} />
          <h1 className="text-2xl font-bold text-[var(--color-text)]">Lotes de Producción</h1>
        </div>
        <p className="text-sm text-[var(--color-text-muted)] ml-4">Listado y gestión de lotes de producción</p>
      </div>

      {/* Search and filters */}
      <div className="flex flex-col md:flex-row gap-3 items-start md:items-center flex-wrap">
        <input
          type="text"
          placeholder="Buscar por código de lote o receta..."
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          className="flex-1 min-w-[200px] px-3 py-2 border border-[var(--color-border)] rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-[var(--color-master-500)] focus:border-transparent"
        />
        <select
          value={statusFilter}
          onChange={(e) => setStatusFilter(e.target.value)}
          className="px-3 py-2 border border-[var(--color-border)] rounded-lg text-sm bg-[var(--color-surface)] focus:outline-none focus:ring-2 focus:ring-[var(--color-master-500)]"
        >
          <option value="">Todos los estados</option>
          {ALL_STATUSES.filter(Boolean).map((s) => (
            <option key={s} value={s}>{STATUS_LABELS[s]?.label ?? s}</option>
          ))}
        </select>
        <div className="flex items-center gap-2">
          <label className="text-xs text-[var(--color-text-muted)]">Desde:</label>
          <input type="date" value={dateFrom} onChange={(e) => setDateFrom(e.target.value)} className="px-2 py-1.5 border border-[var(--color-border)] rounded-lg text-sm" />
          <label className="text-xs text-[var(--color-text-muted)]">Hasta:</label>
          <input type="date" value={dateTo} onChange={(e) => setDateTo(e.target.value)} className="px-2 py-1.5 border border-[var(--color-border)] rounded-lg text-sm" />
        </div>
        <div className="flex gap-2">
          <button
            onClick={exportToExcel}
            className="px-4 py-2 bg-[var(--color-success-600)] text-white rounded-lg text-sm font-medium hover:bg-[var(--color-success-700)] transition"
            disabled={filtered.length === 0}
          >
            📥 Exportar Excel
          </button>
          <Link href="/app/master/production/batches/new" className="px-4 py-2 bg-[var(--color-master-600)] text-white rounded-lg text-sm font-medium hover:bg-[var(--color-master-700)] transition">+ Nuevo Lote</Link>
        </div>
      </div>

      <p className="text-xs text-[var(--color-text-muted)]">{filtered.length} lote{filtered.length !== 1 ? "s" : ""}</p>

      {/* Table */}
      <div className="bg-[var(--color-surface)] rounded-xl border shadow-sm">
        {loading && <p className="px-4 py-8 text-center text-sm text-[var(--color-text-soft)]">Cargando...</p>}
        {error && <p className="px-4 py-8 text-center text-sm text-[var(--color-danger-600)]">{error}</p>}
        {!loading && !error && filtered.length === 0 && (
          <p className="px-4 py-8 text-center text-sm text-[var(--color-text-soft)]">No se encontraron lotes.</p>
        )}

        {!loading && !error && filtered.length > 0 && (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-[var(--color-surface-alt)] text-[var(--color-text-muted)] text-xs uppercase tracking-wider">
                <tr>
                  <th className="px-4 py-2.5 text-left font-medium">Lote</th>
                  <th className="px-4 py-2.5 text-left font-medium">Receta</th>
                  <th className="px-4 py-2.5 text-left font-medium">Sucursal</th>
                  <th className="px-4 py-2.5 text-center font-medium">Estado</th>
                  <th className="px-4 py-2.5 text-right font-medium">Planificado</th>
                  <th className="px-4 py-2.5 text-right font-medium">Producido</th>
                  <th className="px-4 py-2.5 text-right font-medium">Costo Total</th>
                  <th className="px-4 py-2.5 text-right font-medium">Costo Unit.</th>
                  <th className="px-4 py-2.5 text-center font-medium">Desviación</th>
                  <th className="px-4 py-2.5 text-left font-medium">Fecha</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-[var(--color-border)]">
                {filtered.map((b) => {
                  const st = STATUS_LABELS[b.status] ?? { label: b.status, color: "bg-[var(--color-surface-alt)] text-[var(--color-text-muted)]" };
                  const dev = getCostDeviation(b);
                  return (
                    <tr key={b.id} className="hover:bg-[var(--color-surface-alt)]">
                      <td className="px-4 py-2.5">
                        {/* eslint-disable-next-line @typescript-eslint/no-explicit-any */}
                        <Link href={`/app/master/production/batches/${b.id}` as any} className="text-[var(--color-master-600)] hover:underline font-medium">{b.batchNumber}</Link>
                      </td>
                      <td className="px-4 py-2.5 text-[var(--color-text)]">{b.recipe.name}</td>
                      <td className="px-4 py-2.5 text-[var(--color-text-muted)]">{b.branch.name}</td>
                      <td className="px-4 py-2.5 text-center">
                        <span className={`inline-block px-2 py-0.5 rounded-full text-xs font-medium ${st.color}`}>{st.label}</span>
                      </td>
                      <td className="px-4 py-2.5 text-right text-[var(--color-text)]">{b.plannedQuantity.toLocaleString()}</td>
                      <td className="px-4 py-2.5 text-right text-[var(--color-text)]">{b.producedGoodQuantity != null ? b.producedGoodQuantity.toLocaleString() : "—"}</td>
                      <td className="px-4 py-2.5 text-right text-[var(--color-text)]">{b.totalCost != null ? `C$${b.totalCost.toFixed(2)}` : "—"}</td>
                      <td className="px-4 py-2.5 text-right text-[var(--color-text)]">{b.unitCost != null ? `C$${b.unitCost.toFixed(2)}` : "—"}</td>
                      <td className="px-4 py-2.5 text-center">
                        {dev ? (
                          <span className={`text-xs font-medium ${dev.color}`} title="Desviación costo real vs estimado">{dev.label}</span>
                        ) : (
                          <span className="text-[var(--color-text-soft)]">—</span>
                        )}
                      </td>
                      <td className="px-4 py-2.5 text-[var(--color-text-muted)] text-xs">{new Date(b.createdAt).toLocaleDateString("es")}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>

      <div className="mt-4">
        <Link href="/app/master/production" className="text-sm text-[var(--color-master-600)] hover:underline">← Volver al Dashboard</Link>
      </div>
    </section>
  );
}
