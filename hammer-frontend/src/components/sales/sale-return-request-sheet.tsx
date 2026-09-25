"use client";

import { useState } from "react";
import toast from "react-hot-toast";
import { X } from "lucide-react";
import { apiFetch, unwrapApiData } from "@/lib/client/api";
import { money } from "@/lib/format";

/**
 * prompt-pendientes-2026-09.md Fase 3 (PENDIENTES #8) — solicitar una
 * devolución desde el detalle de una orden. El backend (POST
 * /api/sales/returns) ya existía completo; esta pantalla era el hueco.
 * Extraído a su propio archivo para poder reutilizarlo desde una vista de
 * sucursal más adelante (hoy BranchPos no tiene historial de ventas — ver
 * el reporte final del prompt).
 */

export type ReturnCondition = "GOOD" | "DAMAGED" | "NOT_RETURNED";

export type SaleReturnCandidateLine = {
  id: string; // saleOrderLineId
  productName: string;
  sku: string | null;
  unit: string | null;
  quantity: number;
  lineSubtotal: number;
  pendingOrReturnedQuantity: number;
};

function round2(value: number): number {
  return Math.round(value * 100) / 100;
}

/** Regla dura del backend (assertReturnItemDestination) — el destino se deriva de la condición, no se pregunta. */
export function destinationForCondition(condition: ReturnCondition): "SELLABLE" | "DAMAGED" | "NONE" {
  if (condition === "GOOD") return "SELLABLE";
  if (condition === "DAMAGED") return "DAMAGED";
  return "NONE";
}

/** Espejo de calculateRefundableAmount (sales-returns/service.ts) — solo para el estimado en vivo; el backend vuelve a calcularlo al guardar. */
export function estimateRefundableAmount(input: { lineSubtotal: number; quantity: number; requestedQty: number }): number {
  if (input.quantity <= 0) return 0;
  return round2((input.lineSubtotal * input.requestedQty) / input.quantity);
}

/** TOTAL si se devuelve todo lo disponible de todas las líneas con algo disponible; si no, PARTIAL. */
export function deriveReturnType(rows: { available: number; requestedQty: number }[]): "PARTIAL" | "TOTAL" {
  const withStock = rows.filter((r) => r.available > 0);
  if (withStock.length === 0) return "PARTIAL";
  return withStock.every((r) => r.requestedQty >= r.available) ? "TOTAL" : "PARTIAL";
}

const CONDITION_LABEL: Record<ReturnCondition, string> = {
  GOOD: "Buena",
  DAMAGED: "Dañada",
  NOT_RETURNED: "No regresa físicamente",
};

const ERROR_MESSAGES: Record<string, string> = {
  SALE_ORDER_NOT_RETURNABLE: "Esta orden ya no está en un estado que permita devoluciones.",
  SALE_ORDER_NOT_PAID: "Esta orden no tiene pagos confirmados.",
  SALE_RETURN_QUANTITY_EXCEEDS_SOLD: "La cantidad supera lo vendido (o ya solicitado/devuelto) de esa línea.",
  SALE_RETURN_LINE_NOT_IN_ORDER: "Una de las líneas no pertenece a esta orden.",
};

export function SaleReturnRequestSheet({
  orderId,
  lines,
  onClose,
  onRequested,
}: {
  orderId: string;
  lines: SaleReturnCandidateLine[];
  onClose: () => void;
  onRequested: (returnNumber: string) => void;
}) {
  const [rows, setRows] = useState<Record<string, { qty: string; condition: ReturnCondition }>>({});
  const [reason, setReason] = useState("");
  const [saving, setSaving] = useState(false);

  function setQty(lineId: string, qty: string) {
    setRows((r) => ({ ...r, [lineId]: { condition: r[lineId]?.condition ?? "GOOD", qty } }));
  }
  function setCondition(lineId: string, condition: ReturnCondition) {
    setRows((r) => ({ ...r, [lineId]: { qty: r[lineId]?.qty ?? "", condition } }));
  }

  const candidates = lines.map((l) => {
    const available = Math.max(0, round2(l.quantity - l.pendingOrReturnedQuantity));
    const raw = rows[l.id];
    const requestedQty = Math.min(available, Math.max(0, Number(raw?.qty) || 0));
    const condition = raw?.condition ?? "GOOD";
    return { ...l, available, requestedQty, condition };
  });

  const touched = candidates.filter((c) => c.requestedQty > 0);
  const returnType = deriveReturnType(candidates.map((c) => ({ available: c.available, requestedQty: c.requestedQty })));
  const estimatedTotal = round2(
    touched.reduce((sum, c) => sum + estimateRefundableAmount({ lineSubtotal: c.lineSubtotal, quantity: c.quantity, requestedQty: c.requestedQty }), 0),
  );
  const canConfirm = !saving && touched.length > 0 && reason.trim().length >= 3;

  async function submit() {
    if (!canConfirm) return;
    setSaving(true);
    try {
      const res = await apiFetch("/api/sales/returns", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          saleOrderId: orderId,
          reason: reason.trim(),
          returnType,
          items: touched.map((c) => ({
            saleOrderLineId: c.id,
            quantity: c.requestedQty,
            condition: c.condition,
            inventoryDestination: destinationForCondition(c.condition),
          })),
        }),
      });
      const raw = await res.json().catch(() => null);
      if (!res.ok) {
        const code = raw?.error?.code as string | undefined;
        throw new Error((code && ERROR_MESSAGES[code]) || raw?.error?.message || "No se pudo solicitar la devolución.");
      }
      const saleReturn = unwrapApiData(raw) as { returnNumber: string };
      toast.success(`Devolución ${saleReturn.returnNumber} solicitada — pendiente de aprobación.`);
      onRequested(saleReturn.returnNumber);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "No se pudo solicitar la devolución.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
      <div className="max-h-[90vh] w-full max-w-2xl overflow-y-auto space-y-4 rounded-xl bg-[var(--color-surface)] p-5 shadow-2xl">
        <div className="flex items-center justify-between">
          <h3 className="text-sm font-semibold text-[var(--color-text)]">Solicitar devolución</h3>
          <button type="button" onClick={onClose} className="text-[var(--color-text-muted)] hover:text-[var(--color-text)]">
            <X className="h-4 w-4" />
          </button>
        </div>

        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-[var(--color-border)] text-left text-xs text-[var(--color-text-muted)]">
                <th className="py-2 pr-3">Producto</th>
                <th className="py-2 pr-3 text-right">Vendido</th>
                <th className="py-2 pr-3 text-right">Ya devuelto/solicitado</th>
                <th className="py-2 pr-3 text-right">A devolver</th>
                <th className="py-2">Condición</th>
              </tr>
            </thead>
            <tbody>
              {candidates.map((c) => (
                <tr key={c.id} className="border-b border-[var(--color-border)]">
                  <td className="py-2 pr-3">
                    <p className="font-medium">{c.productName}</p>
                    {c.sku && <p className="text-xs text-[var(--color-text-muted)]">{c.sku}</p>}
                  </td>
                  <td className="py-2 pr-3 text-right">{c.quantity} {c.unit ?? ""}</td>
                  <td className="py-2 pr-3 text-right text-[var(--color-text-muted)]">{c.pendingOrReturnedQuantity || "—"}</td>
                  <td className="py-2 pr-3 text-right">
                    <input
                      type="number"
                      min="0"
                      max={c.available}
                      step="0.01"
                      disabled={c.available <= 0}
                      value={rows[c.id]?.qty ?? ""}
                      onChange={(e) => setQty(c.id, e.target.value)}
                      className="hm-input w-20 text-right disabled:opacity-40"
                      placeholder="0"
                    />
                  </td>
                  <td className="py-2">
                    <select
                      className="hm-input disabled:opacity-40"
                      value={c.condition}
                      disabled={c.requestedQty <= 0}
                      onChange={(e) => setCondition(c.id, e.target.value as ReturnCondition)}
                    >
                      {(Object.keys(CONDITION_LABEL) as ReturnCondition[]).map((k) => (
                        <option key={k} value={k}>{CONDITION_LABEL[k]}</option>
                      ))}
                    </select>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          {candidates.every((c) => c.available <= 0) && (
            <p className="py-4 text-center text-sm text-[var(--color-text-muted)]">Nada disponible para devolver en esta orden.</p>
          )}
        </div>

        <div>
          <label className="mb-1 block text-xs font-semibold text-[var(--color-text-muted)]">Motivo</label>
          <textarea
            className="hm-input w-full"
            rows={2}
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            placeholder="Motivo de la devolución (mínimo 3 caracteres)"
          />
        </div>

        <div className="rounded-lg border border-[var(--color-border)] bg-[var(--color-surface-alt)] p-3 text-sm">
          <div className="flex items-center justify-between">
            <span className="text-[var(--color-text-secondary)]">Tipo</span>
            <span className="font-medium">{returnType === "TOTAL" ? "Total" : "Parcial"}</span>
          </div>
          <div className="flex items-center justify-between font-semibold">
            <span>Reembolsable estimado</span>
            <span>{money(estimatedTotal)}</span>
          </div>
          <p className="mt-1 text-xs text-[var(--color-text-muted)]">No incluye transporte. El backend recalcula el monto final al guardar.</p>
        </div>

        <div className="flex justify-end gap-2">
          <button type="button" onClick={onClose} className="rounded-lg border border-[var(--color-border)] px-4 py-2 text-sm text-[var(--color-text-secondary)] hover:bg-[var(--color-surface-alt)]">
            Cancelar
          </button>
          <button
            type="button"
            onClick={() => void submit()}
            disabled={!canConfirm}
            className="rounded-lg bg-[var(--color-master-600)] px-4 py-2 text-sm font-semibold text-white hover:bg-[var(--color-master-700)] disabled:opacity-50"
          >
            {saving ? "Solicitando…" : "Solicitar devolución"}
          </button>
        </div>
      </div>
    </div>
  );
}
