"use client";

import { useEffect, useState, useCallback, use } from "react";
import Link from "next/link";
import { apiFetch, unwrapApiData } from "@/lib/client/api";

type InputProduct = { id: string; sku: string; name: string; unit: string };

type BatchInput = {
  id: string;
  plannedQuantity: number;
  actualQuantity: number | null;
  unit: string;
  unitCost: number | null;
  totalCost: number | null;
  inputProduct: InputProduct;
};

type Batch = {
  id: string;
  batchNumber: string;
  status: string;
  plannedQuantity: number;
  producedGoodQuantity: number | null;
  producedBadQuantity: number | null;
  materialsCost: number | null;
  laborCost: number | null;
  overheadCost: number | null;
  totalCost: number | null;
  unitCost: number | null;
  suggestedPrice: number | null;
  startedAt: string | null;
  completedAt: string | null;
  notes: string | null;
  createdAt: string;
  recipe: {
    id: string;
    name: string;
    code: string;
    targetMarginPct: number | null;
    finishedProduct: InputProduct;
    inputs: Array<{ inputProduct: InputProduct; quantity: number; unit: string }>;
  };
  branch: { id: string; code: string; name: string };
  createdBy: { id: string; fullName: string };
  inputs: BatchInput[];
};

const STATUS_LABELS: Record<string, { label: string; color: string }> = {
  DRAFT: { label: "Borrador", color: "bg-[var(--color-surface-alt)] text-[var(--color-text)]" },
  PLANNED: { label: "Planificado", color: "bg-[var(--color-info-50)] text-[var(--color-info-700)]" },
  IN_PROGRESS: { label: "En Proceso", color: "bg-[var(--color-warning-100)] text-[var(--color-warning-700)]" },
  COMPLETED: { label: "Completado", color: "bg-[var(--color-success-50)] text-[var(--color-success-700)]" },
  CANCELLED: { label: "Cancelado", color: "bg-[var(--color-danger-50)] text-[var(--color-danger-700)]" },
};

type InputActualRow = {
  inputProductId: string;
  actualQuantity: string;
  unitCost: string;
};

export default function BatchDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const [batch, setBatch] = useState<Batch | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [actionLoading, setActionLoading] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);

  // Completion form
  const [producedGood, setProducedGood] = useState("");
  const [producedBad, setProducedBad] = useState("0");
  const [laborCost, setLaborCost] = useState("0");
  const [overheadCost, setOverheadCost] = useState("0");
  const [inputActuals, setInputActuals] = useState<InputActualRow[]>([]);

  const loadBatch = useCallback(async () => {
    try {
      const res = await apiFetch(`/api/master/production/batches/${id}`);
      if (!res.ok) throw new Error("Error al cargar lote");
      const data = unwrapApiData(await res.json()) as Batch;
      return data;
    } catch (err) {
      throw err;
    }
  }, [id]);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const data = await loadBatch();
        if (cancelled) return;
        setBatch(data);
        setInputActuals(
          data.inputs.map((bi) => ({
            inputProductId: bi.inputProduct.id,
            actualQuantity: bi.actualQuantity != null ? String(bi.actualQuantity) : String(bi.plannedQuantity),
            unitCost: bi.unitCost != null ? String(bi.unitCost) : "0",
          })),
        );
        setProducedGood(data.producedGoodQuantity != null ? String(data.producedGoodQuantity) : String(data.plannedQuantity));
      } catch (err) {
        if (!cancelled) setError(err instanceof Error ? err.message : "Error desconocido");
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, [loadBatch]);

  const reloadBatchData = useCallback(async () => {
    const data = await loadBatch();
    setBatch(data);
    setInputActuals(
      data.inputs.map((bi) => ({
        inputProductId: bi.inputProduct.id,
        actualQuantity: bi.actualQuantity != null ? String(bi.actualQuantity) : String(bi.plannedQuantity),
        unitCost: bi.unitCost != null ? String(bi.unitCost) : "0",
      })),
    );
    setProducedGood(data.producedGoodQuantity != null ? String(data.producedGoodQuantity) : String(data.plannedQuantity));
  }, [loadBatch]);

  const changeStatus = async (newStatus: string) => {
    setActionLoading(true);
    setActionError(null);
    try {
      const res = await apiFetch(`/api/master/production/batches/${id}`, {
        method: "PATCH",
        body: JSON.stringify({ status: newStatus }),
      });
      if (!res.ok) {
        const errData = await res.json().catch(() => null);
        throw new Error(errData?.error?.message ?? errData?.message ?? "Error");
      }
      await reloadBatchData();
    } catch (err) {
      setActionError(err instanceof Error ? err.message : "Error");
    } finally {
      setActionLoading(false);
    }
  };

  const handleComplete = async (e: React.FormEvent) => {
    e.preventDefault();
    setActionLoading(true);
    setActionError(null);

    try {
      const body = {
        producedGoodQuantity: parseFloat(producedGood),
        producedBadQuantity: parseFloat(producedBad) || 0,
        laborCost: parseFloat(laborCost) || 0,
        overheadCost: parseFloat(overheadCost) || 0,
        inputs: inputActuals.map((ia) => ({
          inputProductId: ia.inputProductId,
          actualQuantity: parseFloat(ia.actualQuantity),
          unitCost: parseFloat(ia.unitCost),
        })),
      };

      const res = await apiFetch(`/api/master/production/batches/${id}/complete`, {
        method: "POST",
        body: JSON.stringify(body),
      });

      if (!res.ok) {
        const errData = await res.json().catch(() => null);
        throw new Error(errData?.error?.message ?? errData?.message ?? "Error al completar lote");
      }

      await reloadBatchData();
    } catch (err) {
      setActionError(err instanceof Error ? err.message : "Error");
    } finally {
      setActionLoading(false);
    }
  };

  const updateInputActual = (idx: number, field: keyof InputActualRow, value: string) => {
    setInputActuals((prev) => prev.map((r, i) => (i === idx ? { ...r, [field]: value } : r)));
  };

  if (loading) return <p className="text-center py-12 text-sm text-[var(--color-text-soft)]">Cargando lote...</p>;
  if (error) return <p className="text-center py-12 text-sm text-[var(--color-danger-600)]">{error}</p>;
  if (!batch) return <p className="text-center py-12 text-sm text-[var(--color-text-soft)]">Lote no encontrado</p>;

  const st = STATUS_LABELS[batch.status] ?? { label: batch.status, color: "bg-[var(--color-surface-alt)] text-[var(--color-text-muted)]" };
  const canStart = batch.status === "DRAFT" || batch.status === "PLANNED";
  const canComplete = batch.status === "IN_PROGRESS" || batch.status === "DRAFT" || batch.status === "PLANNED";
  const isFinished = batch.status === "COMPLETED" || batch.status === "CANCELLED";

  return (
    <section className="space-y-6 max-w-4xl">
      <div>
        <div className="flex items-center gap-3 mb-1">
          <div
            className="h-8 w-1 rounded-full"
            style={{ background: "linear-gradient(to bottom, var(--color-master-400), var(--color-master-600))" }}
          />
          <h1 className="text-2xl font-bold text-[var(--color-text)]">Lote {batch.batchNumber}</h1>
          <span className={`ml-2 inline-block px-2.5 py-0.5 rounded-full text-xs font-medium ${st.color}`}>
            {st.label}
          </span>
        </div>
      </div>

      <Link href="/app/master/production/batches" className="text-sm text-[var(--color-master-600)] hover:underline">
        ← Volver a lotes
      </Link>

      {actionError && (
        <div className="bg-[var(--color-danger-50)] border border-[var(--color-danger-200)] rounded-lg p-3 text-sm text-[var(--color-danger-700)]">{actionError}</div>
      )}

      {/* Batch info */}
      <div className="bg-[var(--color-surface)] rounded-xl border p-5 shadow-sm grid grid-cols-1 sm:grid-cols-2 gap-4 text-sm">
        <div><span className="text-[var(--color-text-muted)]">Receta:</span> <span className="font-medium text-[var(--color-text)]">{batch.recipe.name}</span></div>
        <div><span className="text-[var(--color-text-muted)]">Código:</span> <span className="font-mono text-[var(--color-text)]">{batch.recipe.code}</span></div>
        <div><span className="text-[var(--color-text-muted)]">Producto Final:</span> <span className="text-[var(--color-text)]">{batch.recipe.finishedProduct.name}</span></div>
        <div><span className="text-[var(--color-text-muted)]">Sucursal:</span> <span className="text-[var(--color-text)]">{batch.branch.name}</span></div>
        <div><span className="text-[var(--color-text-muted)]">Cantidad Planeada:</span> <span className="font-medium text-[var(--color-text)]">{batch.plannedQuantity.toLocaleString()}</span></div>
        <div><span className="text-[var(--color-text-muted)]">Creado por:</span> <span className="text-[var(--color-text)]">{batch.createdBy.fullName}</span></div>
        {batch.startedAt && <div><span className="text-[var(--color-text-muted)]">Iniciado:</span> <span className="text-[var(--color-text)]">{new Date(batch.startedAt).toLocaleString("es-NI")}</span></div>}
        {batch.completedAt && <div><span className="text-[var(--color-text-muted)]">Completado:</span> <span className="text-[var(--color-text)]">{new Date(batch.completedAt).toLocaleString("es-NI")}</span></div>}
        {batch.notes && <div className="sm:col-span-2"><span className="text-[var(--color-text-muted)]">Notas:</span> <span className="text-[var(--color-text)]">{batch.notes}</span></div>}
      </div>

      {/* Status-specific actions */}
      {canStart && batch.status !== "IN_PROGRESS" && (
        <div className="flex gap-3">
          <button
            onClick={() => changeStatus("IN_PROGRESS")}
            disabled={actionLoading}
            className="px-4 py-2 bg-yellow-500 text-white rounded-lg text-sm font-medium hover:bg-yellow-600 disabled:opacity-50 transition"
          >
            {actionLoading ? "Procesando..." : "▶ Iniciar Producción"}
          </button>
          <button
            onClick={() => changeStatus("CANCELLED")}
            disabled={actionLoading}
            className="px-4 py-2 bg-[var(--color-danger-50)] text-[var(--color-danger-700)] rounded-lg text-sm font-medium hover:bg-red-200 disabled:opacity-50 transition"
          >
            Cancelar Lote
          </button>
        </div>
      )}

      {batch.status === "IN_PROGRESS" && !isFinished && (
        <div className="flex gap-3">
          <button
            onClick={() => changeStatus("CANCELLED")}
            disabled={actionLoading}
            className="px-4 py-2 bg-[var(--color-danger-50)] text-[var(--color-danger-700)] rounded-lg text-sm font-medium hover:bg-red-200 disabled:opacity-50 transition"
          >
            Cancelar Lote
          </button>
        </div>
      )}

      {/* Planned inputs */}
      <div className="bg-[var(--color-surface)] rounded-xl border shadow-sm">
        <div className="px-4 py-3 border-b">
          <h2 className="text-sm font-semibold text-[var(--color-text)]">Insumos del Lote</h2>
        </div>
        <div className="overflow-x-auto">
          <table className="hm-table w-full text-sm">
            <thead className="bg-[var(--color-surface-alt)] text-[var(--color-text-muted)] text-xs uppercase tracking-wider">
              <tr>
                <th className="px-4 py-2 text-left font-medium">Insumo</th>
                <th className="px-4 py-2 text-right font-medium">Planeado</th>
                <th className="px-4 py-2 text-right font-medium">Real</th>
                <th className="px-4 py-2 text-left font-medium">Unidad</th>
                <th className="px-4 py-2 text-right font-medium">Costo Unit.</th>
                <th className="px-4 py-2 text-right font-medium">Costo Total</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-[var(--color-border)]">
              {batch.inputs.map((bi) => (
                <tr key={bi.id}>
                  <td className="px-4 py-2 text-[var(--color-text)]">{bi.inputProduct.name}</td>
                  <td className="px-4 py-2 text-right text-[var(--color-text-muted)]">{bi.plannedQuantity}</td>
                  <td className="px-4 py-2 text-right text-[var(--color-text)] font-medium">
                    {bi.actualQuantity != null ? bi.actualQuantity : "—"}
                  </td>
                  <td className="px-4 py-2 text-[var(--color-text-muted)]">{bi.unit}</td>
                  <td className="px-4 py-2 text-right text-[var(--color-text-muted)]">
                    {bi.unitCost != null ? `C$${bi.unitCost.toFixed(2)}` : "—"}
                  </td>
                  <td className="px-4 py-2 text-right text-[var(--color-text)]">
                    {bi.totalCost != null ? `C$${bi.totalCost.toFixed(2)}` : "—"}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {/* Completed summary */}
      {batch.status === "COMPLETED" && (
        <div className="bg-[var(--color-success-50)] border border-[var(--color-success-200)] rounded-xl p-5 space-y-2">
          <h2 className="text-sm font-bold text-[var(--color-success-700)]">Resumen de Producción</h2>
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 text-sm">
            <div>
              <p className="text-[var(--color-success-700)] text-xs">Unidades Buenas</p>
              <p className="font-bold text-green-900">{batch.producedGoodQuantity?.toLocaleString()}</p>
            </div>
            <div>
              <p className="text-[var(--color-success-700)] text-xs">Unidades Rechazadas</p>
              <p className="font-bold text-green-900">{batch.producedBadQuantity ?? 0}</p>
            </div>
            <div>
              <p className="text-[var(--color-success-700)] text-xs">Costo Total</p>
              <p className="font-bold text-green-900">C${batch.totalCost?.toFixed(2)}</p>
            </div>
            <div>
              <p className="text-[var(--color-success-700)] text-xs">Costo Unitario</p>
              <p className="font-bold text-green-900">C${batch.unitCost?.toFixed(2)}</p>
            </div>
          </div>
          {batch.suggestedPrice != null && (
            <div className="pt-2 border-t border-[var(--color-success-200)] mt-2">
              <p className="text-xs text-[var(--color-success-700)]">
                Precio Sugerido (margen {((batch.recipe.targetMarginPct ?? 0) * 100).toFixed(0)}%):
                <span className="font-bold text-green-900 ml-1">C${batch.suggestedPrice.toFixed(2)}</span>
              </p>
            </div>
          )}
          <div className="grid grid-cols-3 gap-3 text-xs text-[var(--color-success-700)] pt-1">
            <div>Materiales: C${batch.materialsCost?.toFixed(2)}</div>
            <div>Mano de obra: C${batch.laborCost?.toFixed(2)}</div>
            <div>Indirectos: C${batch.overheadCost?.toFixed(2)}</div>
          </div>
        </div>
      )}

      {/* Completion form */}
      {canComplete && !isFinished && (
        <form onSubmit={handleComplete} className="bg-[var(--color-surface)] rounded-xl border p-5 shadow-sm space-y-5">
          <h2 className="text-sm font-bold text-[var(--color-text)]">Completar Lote</h2>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div>
              <label className="block text-xs font-medium text-[var(--color-text-muted)] mb-1">Unidades Buenas Producidas *</label>
              <input
                type="number"
                value={producedGood}
                onChange={(e) => setProducedGood(e.target.value)}
                required
                min="0.01"
                step="any"
                className="w-full border rounded-lg px-3 py-2 text-sm"
              />
            </div>
            <div>
              <label className="block text-xs font-medium text-[var(--color-text-muted)] mb-1">Unidades Rechazadas</label>
              <input
                type="number"
                value={producedBad}
                onChange={(e) => setProducedBad(e.target.value)}
                min="0"
                step="any"
                className="w-full border rounded-lg px-3 py-2 text-sm"
              />
            </div>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div>
              <label className="block text-xs font-medium text-[var(--color-text-muted)] mb-1">Mano de Obra (C$)</label>
              <input
                type="number"
                value={laborCost}
                onChange={(e) => setLaborCost(e.target.value)}
                min="0"
                step="any"
                className="w-full border rounded-lg px-3 py-2 text-sm"
              />
            </div>
            <div>
              <label className="block text-xs font-medium text-[var(--color-text-muted)] mb-1">Costos Indirectos (C$)</label>
              <input
                type="number"
                value={overheadCost}
                onChange={(e) => setOverheadCost(e.target.value)}
                min="0"
                step="any"
                className="w-full border rounded-lg px-3 py-2 text-sm"
              />
            </div>
          </div>

          {/* Input actuals */}
          <div>
            <h3 className="text-xs font-semibold text-[var(--color-text)] mb-2">Consumo Real de Insumos</h3>
            <div className="space-y-2">
              {inputActuals.map((ia, idx) => {
                const batchInput = batch.inputs[idx];
                if (!batchInput) return null;
                return (
                  <div key={idx} className="flex gap-2 items-center">
                    <span className="text-sm text-[var(--color-text)] min-w-[160px] truncate">{batchInput.inputProduct.name}</span>
                    <div className="flex-1">
                      <input
                        type="number"
                        value={ia.actualQuantity}
                        onChange={(e) => updateInputActual(idx, "actualQuantity", e.target.value)}
                        required
                        min="0.01"
                        step="any"
                        className="w-full border rounded-lg px-2 py-1.5 text-sm"
                        placeholder="Cantidad real"
                      />
                    </div>
                    <span className="text-xs text-[var(--color-text-soft)] w-12">{batchInput.unit}</span>
                    <div className="w-28">
                      <input
                        type="number"
                        value={ia.unitCost}
                        onChange={(e) => updateInputActual(idx, "unitCost", e.target.value)}
                        required
                        min="0"
                        step="any"
                        className="w-full border rounded-lg px-2 py-1.5 text-sm"
                        placeholder="C$/und"
                      />
                    </div>
                  </div>
                );
              })}
            </div>
          </div>

          <div className="flex gap-3 pt-2">
            <button
              type="submit"
              disabled={actionLoading}
              className="px-6 py-2 bg-[var(--color-success-600)] text-white rounded-lg text-sm font-medium hover:bg-[var(--color-success-700)] disabled:opacity-50 transition"
            >
              {actionLoading ? "Completando..." : "✓ Completar Lote"}
            </button>
          </div>
        </form>
      )}
    </section>
  );
}
