"use client";

import { useState } from "react";
import toast from "react-hot-toast";
import { X, Check, AlertTriangle } from "lucide-react";
import { apiFetch } from "@/lib/client/api";
import { CashRefundHandlingPicker, type CashRefundHandling } from "./cash-refund-handling-picker";

/**
 * prompt-historial-sucursal.md Fase 3.2 — ejecutar una anulación ya
 * APPROVED. Antes de esto nadie en la UI llamaba a
 * POST /api/sales/cancellations/[id]/execute — una anulación aprobada se
 * quedaba en APPROVED para siempre (la cola de aprobaciones solo aprueba,
 * no ejecuta). Se muestra tanto en modo master como branch: Master
 * también puede cerrar solicitudes aprobadas que quedaron colgadas.
 */

const ERROR_MESSAGES: Record<string, string> = {
  SALE_CANCELLATION_NOT_APPROVED: "Esta anulación todavía no fue aprobada.",
  SALE_CANCELLATION_ALREADY_EXECUTED: "Esta anulación ya fue ejecutada.",
  OPERATIONAL_DAY_ALREADY_CONFIRMED: "El día operativo de esta anulación ya fue confirmado — no se puede ejecutar.",
};

/**
 * Σ tender.amount de tenders CASH en pagos POSTED — mismo criterio que
 * resolveCancellationCashPlan (sales/cancellation-cash-policy.ts) del lado
 * del backend: cashTenderTotal <= 0 no tiene nada que decidir.
 */
export function needsCashRefundHandling(payments: { status: string; tenders: { method: string; amount: number }[] }[]): boolean {
  return payments.some((p) => p.status === "POSTED" && p.tenders.some((t) => t.method === "CASH" && t.amount > 0));
}

export function SaleCancellationExecuteModal({
  cancellationId,
  orderNumber,
  payments,
  onClose,
  onExecuted,
}: {
  cancellationId: string;
  orderNumber: string;
  payments: { status: string; tenders: { method: string; amount: number }[] }[];
  onClose: () => void;
  onExecuted: () => void;
}) {
  const [cashHandling, setCashHandling] = useState<CashRefundHandling>("REFUNDED_FROM_DRAWER");
  const [saving, setSaving] = useState(false);
  const showCashPicker = needsCashRefundHandling(payments);

  async function submit() {
    setSaving(true);
    try {
      const res = await apiFetch(`/api/sales/cancellations/${cancellationId}/execute`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ cashRefundHandling: showCashPicker ? cashHandling : null }),
      });
      const raw = await res.json().catch(() => null);
      if (!res.ok) {
        const code = raw?.error?.code as string | undefined;
        throw new Error((code && ERROR_MESSAGES[code]) || raw?.error?.message || "No se pudo ejecutar la anulación.");
      }
      toast.success(`Anulación de ${orderNumber} ejecutada.`);
      onExecuted();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "No se pudo ejecutar la anulación.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
      <div className="w-full max-w-md space-y-4 rounded-xl bg-[var(--color-surface)] p-5 shadow-2xl">
        <div className="flex items-center justify-between">
          <h3 className="text-sm font-semibold text-[var(--color-text)]">Ejecutar anulación — {orderNumber}</h3>
          <button type="button" onClick={onClose} className="text-[var(--color-text-muted)] hover:text-[var(--color-text)]">
            <X className="h-4 w-4" />
          </button>
        </div>

        <p className="flex items-start gap-1.5 rounded-lg border border-[var(--color-danger-200)] bg-[var(--color-danger-50)] px-3 py-2 text-xs text-[var(--color-danger-700)]">
          <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
          Esto revierte el inventario y anula los pagos de la orden. No se puede deshacer.
        </p>

        {showCashPicker && <CashRefundHandlingPicker value={cashHandling} onChange={setCashHandling} />}

        <div className="flex justify-end gap-2">
          <button type="button" onClick={onClose} disabled={saving} className="rounded-lg border border-[var(--color-border)] px-4 py-2 text-sm text-[var(--color-text-secondary)] hover:bg-[var(--color-surface-alt)] disabled:opacity-60">
            Cancelar
          </button>
          <button
            type="button"
            onClick={() => void submit()}
            disabled={saving}
            className="flex items-center gap-1.5 rounded-lg bg-[var(--color-danger-700)] px-4 py-2 text-sm font-semibold text-white hover:bg-[var(--color-danger-800)] disabled:opacity-50"
          >
            <Check className="h-4 w-4" />
            {saving ? "Ejecutando…" : "Ejecutar anulación"}
          </button>
        </div>
      </div>
    </div>
  );
}
