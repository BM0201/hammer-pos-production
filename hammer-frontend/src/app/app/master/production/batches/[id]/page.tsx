"use client";

import { useEffect, useState, useCallback, use, useRef } from "react";
import Link from "next/link";
import { Factory, Undo2 } from "lucide-react";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { showToast } from "@/components/ui/toast";
import { apiFetch, unwrapApiData } from "@/lib/client/api";

/**
 * Producción v2 Fase 6 — "Cerrar lote" (mockup vista 3, LA MÁS IMPORTANTE).
 * El cierre ya no acepta costo ni cantidad de insumo del cliente — el
 * consumo estándar (receta × multiplicador, al WAC del sistema) se calcula
 * en el servidor. Solo se captura lo único que varía: buenas/malas. Antes de
 * cerrar, se pide un preview de inyección (costo/precio antes→después) y su
 * hash — si el inventario cambió entre medias, el cierre se rechaza en vez
 * de inyectar un costo obsoleto ("nadie inyecta sin ver").
 */

type InputProduct = { id: string; sku: string; name: string; unit: string };

type BatchInput = {
  id: string;
  plannedQuantity: number;
  actualQuantity: number | null;
  unit: string;
  unitCost: number | null;
  totalCost: number | null;
  reservedQuantity?: number;
  inputProduct: InputProduct;
};

type Batch = {
  id: string;
  batchNumber: string;
  status: string;
  pricePolicy: string;
  plannedQuantity: number;
  producedGoodQuantity: number | null;
  producedBadQuantity: number | null;
  materialsCost: number | null;
  laborCost: number | null;
  overheadCost: number | null;
  totalCost: number | null;
  unitCost: number | null;
  standardUnitCost: number | null;
  suggestedPrice: number | null;
  priceApprovalRequired: boolean;
  startedAt: string | null;
  completedAt: string | null;
  reversedAt: string | null;
  reversalReason: string | null;
  notes: string | null;
  createdAt: string;
  recipe: { id: string; name: string; code: string; targetMarginPct: number | null; finishedProduct: InputProduct };
  branch: { id: string; code: string; name: string };
  createdBy: { id: string; fullName: string };
  inputs: BatchInput[];
};

type InjectionPreview = {
  batchId: string;
  batchNumber: string;
  pricePolicy: string;
  lines: Array<{ inputProductId: string; productName: string; productSku: string; neededQuantity: number; unit: string; wacSaleUnit: number; lineCost: number; hasEnoughStock: boolean }>;
  materialsCost: number;
  laborCost: number;
  overheadCost: number;
  totalCost: number;
  unitCost: number;
  standardUnitCost: number;
  variancePct: number | null;
  yieldPct: number | null;
  warnings: string[];
  inject: {
    before: { unitCost: number | null; standardSalePrice: number | null; branchCost: number | null; branchPrice: number | null };
    after: { unitCost: number | null; standardSalePrice: number | null; branchCost: number | null; branchPrice: number | null };
    priceApprovalRequired: boolean;
  };
  hash: string;
};

const STATUS_VARIANT: Record<string, "neutral" | "info" | "warning" | "success" | "danger"> = {
  DRAFT: "neutral", PLANNED: "info", IN_PROGRESS: "warning", COMPLETED: "success", CANCELLED: "danger", REVERSED: "danger",
};
const STATUS_LABEL: Record<string, string> = {
  DRAFT: "Borrador", PLANNED: "Planificado", IN_PROGRESS: "En proceso", COMPLETED: "Completado", CANCELLED: "Cancelado", REVERSED: "Revertido",
};

const money = (v: number | null | undefined) => v == null ? "—" : `C$ ${v.toLocaleString("es-NI", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const pct = (v: number | null | undefined) => v == null ? "—" : `${(v * 100).toFixed(1)}%`;

export default function BatchDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const [batch, setBatch] = useState<Batch | null>(null);
  const [loading, setLoading] = useState(true);
  const [actionLoading, setActionLoading] = useState(false);

  const [producedGood, setProducedGood] = useState("");
  const [producedBad, setProducedBad] = useState("0");
  const [preview, setPreview] = useState<InjectionPreview | null>(null);
  const [previewLoading, setPreviewLoading] = useState(false);
  const [completing, setCompleting] = useState(false);

  const [showReverseForm, setShowReverseForm] = useState(false);
  const [reverseReason, setReverseReason] = useState("");
  const [reversing, setReversing] = useState(false);

  const loadBatch = useCallback(async () => {
    const res = await apiFetch(`/api/master/production/batches/${id}`);
    if (!res.ok) throw new Error("No se pudo cargar el lote.");
    return unwrapApiData(await res.json()) as Batch;
  }, [id]);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const data = await loadBatch();
        if (cancelled) return;
        setBatch(data);
        setProducedGood(data.producedGoodQuantity != null ? String(data.producedGoodQuantity) : String(data.plannedQuantity));
        setProducedBad(data.producedBadQuantity != null ? String(data.producedBadQuantity) : "0");
      } catch {
        if (!cancelled) showToast("error", "No se pudo cargar el lote.");
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, [loadBatch]);

  const canClose = batch ? ["DRAFT", "PLANNED", "IN_PROGRESS"].includes(batch.status) : false;

  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => {
    if (!batch || !canClose) return;
    const good = Number(producedGood || 0);
    const bad = Number(producedBad || 0);
    if (good < 0 || bad < 0) return;
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(async () => {
      setPreviewLoading(true);
      try {
        const res = await apiFetch(`/api/master/production/batches/${id}/injection-preview`, {
          method: "POST",
          body: JSON.stringify({ producedGoodQuantity: good, producedBadQuantity: bad }),
        });
        if (!res.ok) { setPreview(null); return; }
        setPreview(unwrapApiData(await res.json()) as InjectionPreview);
      } catch {
        setPreview(null);
      } finally {
        setPreviewLoading(false);
      }
    }, 400);
    return () => { if (debounceRef.current) clearTimeout(debounceRef.current); };
  }, [id, batch, canClose, producedGood, producedBad]);

  async function changeStatus(newStatus: string) {
    setActionLoading(true);
    try {
      const res = await apiFetch(`/api/master/production/batches/${id}`, { method: "PATCH", body: JSON.stringify({ status: newStatus }) });
      const raw = await res.json().catch(() => null);
      if (!res.ok) { showToast("error", raw?.error?.message ?? "No se pudo actualizar el lote."); return; }
      if (newStatus === "PLANNED") {
        const withShortfall = ((unwrapApiData(raw) as { reservation?: Array<{ shortfall: number }> }).reservation ?? []).filter((r) => r.shortfall > 0);
        showToast(withShortfall.length > 0 ? "warning" : "success", withShortfall.length > 0 ? `Planificado con ${withShortfall.length} insumo(s) sin reserva completa.` : "Lote planificado y stock reservado.");
      } else {
        showToast("success", "Lote actualizado.");
      }
      setBatch(await loadBatch());
    } catch {
      showToast("error", "Error de red.");
    } finally {
      setActionLoading(false);
    }
  }

  async function handleComplete() {
    if (!preview) return showToast("warning", "Esperá a que termine de calcular el preview.");
    setCompleting(true);
    try {
      const res = await apiFetch(`/api/master/production/batches/${id}/complete`, {
        method: "POST",
        body: JSON.stringify({
          producedGoodQuantity: Number(producedGood || 0),
          producedBadQuantity: Number(producedBad || 0),
          expectedHash: preview.hash,
        }),
      });
      const raw = await res.json().catch(() => null);
      if (!res.ok) {
        if (raw?.error?.code === "INJECTION_PREVIEW_STALE") {
          showToast("warning", "El inventario cambió — recalculando el preview…");
          setPreview(null);
          return;
        }
        showToast("error", raw?.error?.message ?? "No se pudo cerrar el lote.");
        return;
      }
      const result = unwrapApiData(raw) as { warnings?: string[] };
      (result.warnings ?? []).forEach((w) => showToast("warning", w));
      showToast("success", "Lote cerrado — costo y precio inyectados al producto terminado.");
      setBatch(await loadBatch());
    } catch {
      showToast("error", "Error de red al cerrar el lote.");
    } finally {
      setCompleting(false);
    }
  }

  async function handleReverse() {
    if (reverseReason.trim().length < 3) return showToast("warning", "Escribí un motivo de reversión.");
    setReversing(true);
    try {
      const res = await apiFetch(`/api/master/production/batches/${id}/reverse`, { method: "POST", body: JSON.stringify({ reason: reverseReason.trim() }) });
      const raw = await res.json().catch(() => null);
      if (!res.ok) { showToast("error", raw?.error?.message ?? "No se pudo revertir el lote."); return; }
      showToast("success", "Lote revertido: insumos devueltos, producto terminado retirado.");
      setShowReverseForm(false);
      setBatch(await loadBatch());
    } catch {
      showToast("error", "Error de red al revertir.");
    } finally {
      setReversing(false);
    }
  }

  if (loading) return <div className="py-10 text-center text-sm text-[var(--color-text-muted)]">Cargando lote…</div>;
  if (!batch) return <div className="py-10 text-center text-sm text-[var(--color-text-muted)]">Lote no encontrado.</div>;

  const yieldPct = preview?.yieldPct ?? (batch.producedGoodQuantity != null && batch.producedBadQuantity != null && (batch.producedGoodQuantity + batch.producedBadQuantity) > 0
    ? batch.producedGoodQuantity / (batch.producedGoodQuantity + batch.producedBadQuantity)
    : null);

  return (
    <section className="max-w-5xl space-y-4">
      <div className="flex flex-wrap items-center gap-3">
        <div className="hm-icon-wrap-md hm-icon-wrap"><Factory className="h-5 w-5" /></div>
        <div className="min-w-0 flex-1">
          <h1 className="text-lg font-bold text-[var(--color-text)]">Lote <span className="font-mono">{batch.batchNumber}</span></h1>
          <p className="text-[12.5px] text-[var(--color-text-muted)]">{batch.recipe.name} · {batch.branch.name}</p>
        </div>
        <Badge variant={STATUS_VARIANT[batch.status] ?? "neutral"}>{STATUS_LABEL[batch.status] ?? batch.status}</Badge>
        {canClose && (
          <Button variant="primary" size="sm" loading={completing} disabled={!preview} onClick={handleComplete}>
            ✓ Cerrar lote e inyectar costo
          </Button>
        )}
        <Link href="/app/master/production/batches" className="text-[12.5px] font-medium text-[var(--color-master-600)] hover:underline">Volver a lotes</Link>
      </div>

      {(batch.status === "DRAFT" || batch.status === "PLANNED") && (
        <div className="flex gap-2">
          {batch.status === "DRAFT" && <Button variant="secondary" size="sm" disabled={actionLoading} onClick={() => changeStatus("PLANNED")}>Planificar y reservar</Button>}
          {batch.status === "PLANNED" && <Button variant="secondary" size="sm" disabled={actionLoading} onClick={() => changeStatus("IN_PROGRESS")}>▶ Iniciar producción</Button>}
          <Button variant="ghost" size="sm" disabled={actionLoading} onClick={() => changeStatus("CANCELLED")}>Cancelar lote</Button>
        </div>
      )}
      {batch.status === "IN_PROGRESS" && (
        <div className="flex gap-2">
          <Button variant="ghost" size="sm" disabled={actionLoading} onClick={() => changeStatus("CANCELLED")}>Cancelar lote</Button>
        </div>
      )}

      {canClose && (
        <div className="grid gap-4 lg:grid-cols-2">
          <div className="space-y-4">
            <Card>
              <div className="hm-section-rule">¿Cuánto salió? · lo único que capturás</div>
              <div className="grid grid-cols-2 gap-3">
                <label className="block">
                  <span className="text-[11px] font-semibold uppercase text-[var(--color-text-muted)]">Unidades buenas</span>
                  <input type="number" min="0" step="any" value={producedGood} onChange={(e) => setProducedGood(e.target.value)} className="hm-input mt-1 w-full text-right" style={{ borderColor: "var(--color-master-400)" }} />
                </label>
                <label className="block">
                  <span className="text-[11px] font-semibold uppercase text-[var(--color-text-muted)]">Unidades malas</span>
                  <input type="number" min="0" step="any" value={producedBad} onChange={(e) => setProducedBad(e.target.value)} className="hm-input mt-1 w-full text-right" />
                </label>
              </div>
              <div className="hm-alert hm-alert-info mt-3">
                🧨 Las unidades malas se rompen y se reusan en el proceso — <b>sin movimiento de inventario</b>. Solo cuentan para el rendimiento del lote.
              </div>
              <div className="mt-2 flex justify-between text-[12.5px]">
                <span className="text-[var(--color-text-muted)]">Rendimiento</span>
                <b className="hm-num" style={{ color: yieldPct != null && yieldPct >= 0.9 ? "var(--color-success-700)" : "var(--color-warning-700)" }}>{pct(yieldPct)}</b>
              </div>
            </Card>

            <Card noPadding>
              <div className="border-b border-[var(--color-border)] bg-[var(--color-surface-muted)] px-3 py-2.5"><b className="text-[12.5px]">Consumo estándar (automático)</b></div>
              <table className="hm-sheet-table">
                <tbody>
                  {(preview?.lines ?? batch.inputs.map((bi) => ({ inputProductId: bi.inputProduct.id, productName: bi.inputProduct.name, neededQuantity: bi.plannedQuantity, unit: bi.unit, lineCost: 0 }))).map((line) => (
                    <tr key={line.inputProductId}>
                      <td>{line.productName}</td>
                      <td className="hm-num">{line.neededQuantity.toLocaleString("es-NI", { maximumFractionDigits: 4 })} {line.unit}</td>
                      <td className="hm-num">{previewLoading ? "…" : money(line.lineCost)}</td>
                    </tr>
                  ))}
                </tbody>
                <tfoot>
                  <tr><td colSpan={2}>Materiales (WAC del sistema)</td><td className="hm-num">{previewLoading ? "…" : money(preview?.materialsCost)}</td></tr>
                </tfoot>
              </table>
            </Card>
          </div>

          <Card>
            <div className="hm-section-rule">Costo del lote y qué se inyecta</div>
            <dl className="space-y-1.5 text-[12.5px]">
              <div className="flex justify-between"><dt className="text-[var(--color-text-muted)]">Materiales</dt><dd className="hm-num font-semibold">{money(preview?.materialsCost)}</dd></div>
              <div className="flex justify-between"><dt className="text-[var(--color-text-muted)]">Mano de obra</dt><dd className="hm-num font-semibold">{money(preview?.laborCost ?? 0)}</dd></div>
              <div className="flex justify-between"><dt className="text-[var(--color-text-muted)]">Overhead</dt><dd className="hm-num font-semibold">{money(preview?.overheadCost ?? 0)}</dd></div>
              <div className="flex justify-between border-t border-[var(--color-border)] pt-1.5"><dt className="text-[var(--color-text-muted)]">Costo total del lote</dt><dd className="hm-num font-bold">{money(preview?.totalCost)}</dd></div>
              <div className="flex justify-between"><dt className="text-[var(--color-text-muted)]">Costo unitario real (÷ {producedGood || 0} buenas)</dt><dd className="hm-num font-bold text-[14px]">{money(preview?.unitCost)}</dd></div>
            </dl>

            <div className="hm-section-rule mt-4">Se inyecta al producto terminado</div>
            {preview ? (
              <table className="hm-sheet-table">
                <tbody>
                  <tr><td>+{producedGood || 0} al stock de <b>{batch.recipe.finishedProduct.name}</b></td><td className="hm-num">PRODUCTION_OUTPUT</td></tr>
                  <tr><td>Costo (WAC / branchCost)</td><td className="hm-num"><span className="text-[var(--color-text-soft)]">{money(preview.inject.before.branchCost)}</span> → <b>{money(preview.inject.after.branchCost)}</b></td></tr>
                  <tr><td>Precio de venta</td><td className="hm-num"><span className="text-[var(--color-text-soft)]">{money(preview.inject.before.branchPrice)}</span> → <b style={{ color: preview.inject.priceApprovalRequired ? "var(--color-warning-700)" : "var(--color-success-700)" }}>{preview.inject.priceApprovalRequired ? `${money(preview.inject.before.branchPrice)} (pendiente aprobación)` : money(preview.inject.after.branchPrice)}</b></td></tr>
                </tbody>
              </table>
            ) : (
              <p className="text-[12.5px] text-[var(--color-text-muted)]">{previewLoading ? "Calculando preview…" : "Ingresá las unidades para calcular el preview."}</p>
            )}
            <div className="hm-alert hm-alert-info mt-3">
              💡 Política de precio: <b>{batch.pricePolicy}</b> — configurable por lote (recalcular con margen objetivo, dejar el precio como está, o pedir aprobación si se mueve más de X%).
            </div>
            {preview && preview.warnings.length > 0 && (
              <div className="hm-alert hm-alert-warning mt-2">{preview.warnings.map((w) => <p key={w}>{w}</p>)}</div>
            )}
          </Card>
        </div>
      )}

      {(batch.status === "COMPLETED" || batch.status === "REVERSED") && (
        <>
          <div className="grid gap-3 sm:grid-cols-4">
            <div className="hm-kpi-tile"><span>Unidades buenas</span><b className="hm-num-lg">{batch.producedGoodQuantity?.toLocaleString("es-NI")}</b></div>
            <div className="hm-kpi-tile"><span>Rendimiento</span><b className="hm-num-lg">{pct(yieldPct)}</b></div>
            <div className="hm-kpi-tile"><span>C.U. estándar</span><b className="hm-num-lg">{money(batch.standardUnitCost)}</b></div>
            <div className="hm-kpi-tile"><span>C.U. real</span><b className="hm-num-lg">{money(batch.unitCost)}</b></div>
          </div>
          <Card>
            <div className="hm-section-rule">Costo final del lote</div>
            <dl className="grid grid-cols-2 gap-2 text-[12.5px] sm:grid-cols-4">
              <div><dt className="text-[var(--color-text-muted)]">Materiales</dt><dd className="hm-num font-semibold">{money(batch.materialsCost)}</dd></div>
              <div><dt className="text-[var(--color-text-muted)]">Mano de obra</dt><dd className="hm-num font-semibold">{money(batch.laborCost)}</dd></div>
              <div><dt className="text-[var(--color-text-muted)]">Overhead</dt><dd className="hm-num font-semibold">{money(batch.overheadCost)}</dd></div>
              <div><dt className="text-[var(--color-text-muted)]">Total</dt><dd className="hm-num font-bold">{money(batch.totalCost)}</dd></div>
            </dl>
          </Card>

          {batch.status === "COMPLETED" && !showReverseForm && (
            <div className="hm-alert hm-alert-info flex items-center justify-between gap-3">
              <span>⏪ Si te equivocaste al cerrar, este lote completado se puede revertir con un movimiento inverso auditado.</span>
              <Button variant="ghost" size="sm" icon={<Undo2 className="h-4 w-4" />} onClick={() => setShowReverseForm(true)}>Revertir lote</Button>
            </div>
          )}
          {showReverseForm && (
            <Card className="border-[var(--color-danger-200)]">
              <div className="hm-section-rule">Revertir lote — motivo obligatorio</div>
              <input value={reverseReason} onChange={(e) => setReverseReason(e.target.value)} placeholder="Ej: cerrado con cantidades equivocadas…" className="hm-input w-full" />
              <div className="mt-3 flex justify-end gap-2">
                <Button variant="ghost" size="sm" onClick={() => setShowReverseForm(false)}>Cancelar</Button>
                <Button variant="danger" size="sm" loading={reversing} onClick={handleReverse}>Confirmar reversión</Button>
              </div>
            </Card>
          )}
          {batch.status === "REVERSED" && (
            <div className="hm-alert hm-alert-danger">Este lote fue revertido{batch.reversalReason ? ` — motivo: ${batch.reversalReason}` : ""}.</div>
          )}
        </>
      )}

      {batch.status === "CANCELLED" && <div className="hm-alert hm-alert-info">Este lote fue cancelado.</div>}
    </section>
  );
}
