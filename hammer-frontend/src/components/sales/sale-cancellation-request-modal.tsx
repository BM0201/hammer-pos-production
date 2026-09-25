"use client";

import { useState } from "react";
import toast from "react-hot-toast";
import { X, Check } from "lucide-react";
import { apiFetch } from "@/lib/client/api";
import { money } from "@/lib/format";

/**
 * prompt-historial-sucursal.md Fase 3.1 — solicitar la anulación de una
 * orden desde el historial. El backend (POST /api/sales/cancellations,
 * approve vía la cola genérica) ya existía; esta pantalla era el hueco.
 * A diferencia del "Anular" directo de Master (POST
 * /api/master/sales-orders/[id]/cancel), esto crea una SaleCancellation
 * REQUESTED que otro usuario debe aprobar — nunca anula nada por sí sola.
 */

const ERROR_MESSAGES: Record<string, string> = {
  SALE_ORDER_NOT_CANCELLABLE: "Esta orden ya no está en un estado que permita anularla.",
  SALE_CANCELLATION_ALREADY_PENDING: "Ya hay una solicitud de anulación en curso para esta orden.",
};

export function SaleCancellationRequestModal({
  orderId,
  orderNumber,
  total,
  onClose,
  onRequested,
}: {
  orderId: string;
  orderNumber: string;
  total: number;
  onClose: () => void;
  onRequested: () => void;
}) {
  const [reason, setReason] = useState("");
  const [saving, setSaving] = useState(false);
  const canConfirm = !saving && reason.trim().length >= 3;

  async function submit() {
    if (!canConfirm) return;
    setSaving(true);
    try {
      const res = await apiFetch("/api/sales/cancellations", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ saleOrderId: orderId, reason: reason.trim() }),
      });
      const raw = await res.json().catch(() => null);
      if (!res.ok) {
        const code = raw?.error?.code as string | undefined;
        throw new Error((code && ERROR_MESSAGES[code]) || raw?.error?.message || "No se pudo solicitar la anulación.");
      }
      toast.success("Anulación solicitada — pendiente de aprobación.");
      onRequested();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "No se pudo solicitar la anulación.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
      <div className="w-full max-w-md space-y-4 rounded-xl bg-[var(--color-surface)] p-5 shadow-2xl">
        <div className="flex items-center justify-between">
          <h3 className="text-sm font-semibold text-[var(--color-text)]">Solicitar anulación — {orderNumber}</h3>
          <button type="button" onClick={onClose} className="text-[var(--color-text-muted)] hover:text-[var(--color-text)]">
            <X className="h-4 w-4" />
          </button>
        </div>

        <p className="text-sm text-[var(--color-text-secondary)]">
          Total de la orden: <span className="font-semibold text-[var(--color-text)]">{money(total)}</span>
        </p>

        <div>
          <label className="mb-1 block text-xs font-semibold text-[var(--color-text-muted)]">Motivo</label>
          <textarea
            className="hm-input w-full"
            rows={3}
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            placeholder="Motivo de la anulación (mínimo 3 caracteres)"
            autoFocus
          />
        </div>

        <p className="rounded-lg border border-[var(--color-warning-200)] bg-[var(--color-warning-50)] px-3 py-2 text-xs text-[var(--color-warning-700)]">
          Queda pendiente hasta que otro usuario la apruebe en Aprobaciones — no podés aprobar tu propia solicitud.
        </p>

        <div className="flex justify-end gap-2">
          <button type="button" onClick={onClose} className="rounded-lg border border-[var(--color-border)] px-4 py-2 text-sm text-[var(--color-text-secondary)] hover:bg-[var(--color-surface-alt)]">
            Cancelar
          </button>
          <button
            type="button"
            onClick={() => void submit()}
            disabled={!canConfirm}
            className="flex items-center gap-1.5 rounded-lg bg-[var(--color-danger-700)] px-4 py-2 text-sm font-semibold text-white hover:bg-[var(--color-danger-800)] disabled:opacity-50"
          >
            <Check className="h-4 w-4" />
            {saving ? "Solicitando…" : "Solicitar anulación"}
          </button>
        </div>
      </div>
    </div>
  );
}
