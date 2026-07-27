"use client";

import { Suspense, useEffect, useState, useMemo } from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { Factory, Plus } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { showToast } from "@/components/ui/toast";
import { apiFetch, unwrapApiData } from "@/lib/client/api";

/**
 * Producción v2 Fase 6 — "Lotes y variancia" (mockup vista 4). Como el
 * costeo es solo de materiales, la variancia cuenta una historia limpia:
 * cuántas unidades se echaron a perder (rendimiento) y si el WAC de los
 * materiales subió entre lotes — sin ruido de mano de obra ni overhead.
 * standardUnitCost/unitCost ya vienen calculados y persistidos por el
 * servidor (Fase 5) — no se re-estima nada en el cliente.
 */

type Batch = {
  id: string;
  batchNumber: string;
  status: string;
  plannedQuantity: number;
  producedGoodQuantity: number | null;
  producedBadQuantity: number | null;
  standardUnitCost: number | null;
  unitCost: number | null;
  createdAt: string;
  completedAt: string | null;
  recipe: { id: string; name: string; code: string };
  branch: { id: string; code: string; name: string };
};

const STATUS_VARIANT: Record<string, "neutral" | "info" | "warning" | "success" | "danger"> = {
  DRAFT: "neutral", PLANNED: "info", IN_PROGRESS: "warning", COMPLETED: "success", CANCELLED: "danger", REVERSED: "danger",
};
const STATUS_LABEL: Record<string, string> = {
  DRAFT: "Borrador", PLANNED: "Planificado", IN_PROGRESS: "En proceso", COMPLETED: "Completado", CANCELLED: "Cancelado", REVERSED: "Revertido",
};
const ALL_STATUSES = ["DRAFT", "PLANNED", "IN_PROGRESS", "COMPLETED", "CANCELLED", "REVERSED"];

const money = (v: number | null | undefined) => v == null ? "—" : `C$${v.toLocaleString("es-NI", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const pct1 = (v: number) => `${v >= 0 ? "+" : ""}${(v * 100).toFixed(1)}%`;

function yieldOf(b: Batch): number | null {
  if (b.producedGoodQuantity == null || b.producedBadQuantity == null) return null;
  const total = b.producedGoodQuantity + b.producedBadQuantity;
  return total > 0 ? b.producedGoodQuantity / total : null;
}
function varianceOf(b: Batch): number | null {
  if (b.unitCost == null || b.standardUnitCost == null || b.standardUnitCost <= 0) return null;
  return b.unitCost / b.standardUnitCost - 1;
}

function BatchesContent() {
  const searchParams = useSearchParams();
  const initialStatus = searchParams.get("status") ?? "";

  const [batches, setBatches] = useState<Batch[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState(initialStatus);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await apiFetch("/api/master/production/batches?limit=200");
        if (!res.ok) throw new Error();
        const data = unwrapApiData(await res.json()) as Batch[];
        if (!cancelled) setBatches(data);
      } catch {
        if (!cancelled) showToast("error", "No se pudieron cargar los lotes.");
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, []);

  const filtered = useMemo(() => batches.filter((b) => {
    if (statusFilter && b.status !== statusFilter) return false;
    if (search) {
      const q = search.toLowerCase();
      if (!b.batchNumber.toLowerCase().includes(q) && !b.recipe.name.toLowerCase().includes(q) && !b.recipe.code.toLowerCase().includes(q)) return false;
    }
    return true;
  }), [batches, search, statusFilter]);

  const kpis = useMemo(() => {
    const now = new Date();
    const thisMonth = batches.filter((b) => {
      const d = new Date(b.createdAt);
      return d.getFullYear() === now.getFullYear() && d.getMonth() === now.getMonth();
    });
    const completed = batches.filter((b) => b.status === "COMPLETED" && b.producedGoodQuantity != null);
    const totalProduced = completed.reduce((s, b) => s + (b.producedGoodQuantity ?? 0), 0);
    const yields = completed.map(yieldOf).filter((y): y is number => y != null);
    const avgYield = yields.length ? yields.reduce((s, y) => s + y, 0) / yields.length : null;
    const variances = completed.map(varianceOf).filter((v): v is number => v != null);
    const avgVariance = variances.length ? variances.reduce((s, v) => s + v, 0) / variances.length : null;
    return { batchesThisMonth: thisMonth.length, totalProduced, avgYield, avgVariance };
  }, [batches]);

  return (
    <section className="space-y-4">
      <div className="flex flex-wrap items-center gap-3">
        <div className="hm-icon-wrap-md hm-icon-wrap"><Factory className="h-5 w-5" /></div>
        <div className="min-w-0 flex-1">
          <h1 className="text-lg font-bold text-[var(--color-text)]">Lotes y variancia</h1>
          <p className="text-[12.5px] text-[var(--color-text-muted)]">Estándar vs. real — el KPI que dice si producir vale la pena.</p>
        </div>
        <Link href="/app/master/production/batches/new"><Button variant="primary" size="sm" icon={<Plus className="h-4 w-4" />}>Nuevo lote</Button></Link>
      </div>

      <div className="grid gap-3 sm:grid-cols-4">
        <div className="hm-kpi-tile"><span>Lotes este mes</span><b className="hm-num-lg">{kpis.batchesThisMonth}</b></div>
        <div className="hm-kpi-tile"><span>Unidades producidas</span><b className="hm-num-lg">{kpis.totalProduced.toLocaleString("es-NI")}</b></div>
        <div className="hm-kpi-tile"><span>Rendimiento promedio</span><b className="hm-num-lg" style={{ color: "var(--color-success-700)" }}>{kpis.avgYield != null ? `${(kpis.avgYield * 100).toFixed(1)}%` : "—"}</b></div>
        <div className="hm-kpi-tile"><span>Variancia vs estándar</span><b className="hm-num-lg" style={{ color: "var(--color-danger-700)" }}>{kpis.avgVariance != null ? pct1(kpis.avgVariance) : "—"}</b></div>
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Buscar por código de lote o receta…" className="hm-input min-w-[220px] flex-1" />
        <select value={statusFilter} onChange={(e) => setStatusFilter(e.target.value)} className="hm-input w-52">
          <option value="">Todos los estados</option>
          {ALL_STATUSES.map((s) => <option key={s} value={s}>{STATUS_LABEL[s] ?? s}</option>)}
        </select>
      </div>

      <div className="rounded-lg border border-[var(--color-border)] bg-[var(--color-surface)]">
        {loading ? <p className="px-4 py-8 text-center text-sm text-[var(--color-text-muted)]">Cargando…</p>
          : filtered.length === 0 ? <p className="px-4 py-8 text-center text-sm text-[var(--color-text-muted)]">No se encontraron lotes.</p>
          : (
            <div className="overflow-x-auto">
              <table className="hm-sheet-table">
                <thead>
                  <tr>
                    <th>Lote</th><th>Producto</th><th className="r">Buenas / plan</th><th className="r">Rend.</th>
                    <th className="r">C.U. estándar</th><th className="r">C.U. real</th><th className="r">Variancia</th><th>Estado</th>
                  </tr>
                </thead>
                <tbody>
                  {filtered.map((b) => {
                    const y = yieldOf(b);
                    const v = varianceOf(b);
                    return (
                      <tr key={b.id} className="hm-row-dense">
                        <td>
                          <Link href={`/app/master/production/batches/${b.id}`} className="font-mono text-[11px] font-semibold text-[var(--color-master-600)] hover:underline">{b.batchNumber}</Link>
                          <br /><span className="text-[10.5px] text-[var(--color-text-muted)]">{new Date(b.createdAt).toLocaleDateString("es-NI")}</span>
                        </td>
                        <td>{b.recipe.name}</td>
                        <td className="hm-num">{b.producedGoodQuantity ?? "—"} / {b.plannedQuantity.toLocaleString("es-NI")}</td>
                        <td className="hm-num">{y != null ? `${(y * 100).toFixed(1)}%` : "—"}</td>
                        <td className="hm-num" style={{ color: "var(--color-text-soft)" }}>{money(b.standardUnitCost)}</td>
                        <td className="hm-num" style={{ fontWeight: 600 }}>{money(b.unitCost)}</td>
                        <td className="hm-num" style={{ color: v != null && v > 0 ? "var(--color-danger-700)" : v != null && v < 0 ? "var(--color-success-700)" : undefined }}>{v != null ? pct1(v) : "—"}</td>
                        <td><Badge variant={STATUS_VARIANT[b.status] ?? "neutral"}>{STATUS_LABEL[b.status] ?? b.status}</Badge></td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
      </div>

      <div className="hm-alert hm-alert-info">
        ⏪ <div><b>Reversar lote completado:</b> si te equivocaste al cerrar, un lote completado se puede revertir con un movimiento inverso auditado (devuelve los insumos al stock y retira el producto terminado) desde su detalle — sin ajustes manuales que descuadran el inventario.</div>
      </div>

      <Link href="/app/master/production" className="text-[12.5px] font-medium text-[var(--color-master-600)] hover:underline">← Volver al dashboard</Link>
    </section>
  );
}

export default function BatchesPage() {
  return (
    <Suspense fallback={null}>
      <BatchesContent />
    </Suspense>
  );
}
