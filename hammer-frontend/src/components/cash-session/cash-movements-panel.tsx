"use client";

import { useCallback, useEffect, useState } from "react";
import { apiFetch } from "@/lib/client/api";
import { useSession } from "@/lib/client/session";
import { canInAnyAssignedBranch, CAPABILITIES } from "@/modules/rbac/policies";

type CashMovement = {
  id: string;
  type: string;
  amount: string | number;
  reason: string;
  notes: string | null;
  createdAt: string;
  createdBy: { fullName: string; username: string } | null;
};

const TYPE_LABELS: Record<string, string> = {
  CASH_IN: "Entrada",
  CASH_OUT: "Retiro",
  EXPENSE_OUT: "Gasto",
  BANK_DEPOSIT_OUT: "Depósito banco",
  CHANGE_IN: "Cambio",
  REFUND_OUT: "Devolución",
  CORRECTION: "Corrección",
};

const TYPE_COLOR: Record<string, string> = {
  CASH_IN: "text-[var(--color-success-700)] bg-[var(--color-success-50)] border-[var(--color-success-200)]",
  CHANGE_IN: "text-[var(--color-success-700)] bg-[var(--color-success-50)] border-[var(--color-success-200)]",
  CASH_OUT: "text-[var(--color-danger-700)] bg-[var(--color-danger-50)] border-[var(--color-danger-200)]",
  EXPENSE_OUT: "text-[var(--color-danger-700)] bg-[var(--color-danger-50)] border-[var(--color-danger-200)]",
  BANK_DEPOSIT_OUT: "text-[var(--color-warning-700)] bg-[var(--color-warning-50)] border-[var(--color-warning-200)]",
  REFUND_OUT: "text-[var(--color-warning-700)] bg-[var(--color-warning-50)] border-[var(--color-warning-200)]",
  CORRECTION: "text-[var(--color-text-muted)] bg-[var(--color-surface-alt)] border-[var(--color-border)]",
};

const CREATABLE_TYPES = [
  { value: "CASH_OUT", label: "Retiro de efectivo" },
  { value: "EXPENSE_OUT", label: "Gasto de caja" },
  { value: "CASH_IN", label: "Entrada de efectivo" },
  { value: "BANK_DEPOSIT_OUT", label: "Depósito bancario" },
];

export function CashMovementsPanel({ cashSessionId }: { cashSessionId: string }) {
  const sessionState = useSession();
  const canCreate =
    sessionState.status === "authenticated" &&
    canInAnyAssignedBranch(sessionState.session, CAPABILITIES.CASH_MOVEMENT_CREATE);

  const [movements, setMovements] = useState<CashMovement[]>([]);
  const [loading, setLoading] = useState(true);
  const [open, setOpen] = useState(false);

  // form
  const [type, setType] = useState("CASH_OUT");
  const [amount, setAmount] = useState("");
  const [reason, setReason] = useState("");
  const [notes, setNotes] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [formError, setFormError] = useState("");

  const load = useCallback(async () => {
    const response = await apiFetch(`/api/cashier/v2/cash-movements?cashSessionId=${cashSessionId}`);
    if (!response.ok) return;
    const raw = await response.json();
    setMovements((raw?.data ?? raw) as CashMovement[]);
  }, [cashSessionId]);

  useEffect(() => {
    setLoading(true);
    load().finally(() => setLoading(false));
  }, [load]);

  async function submit() {
    setFormError("");
    const amt = parseFloat(amount);
    if (!amount || isNaN(amt) || amt <= 0) {
      setFormError("Ingresa un monto válido mayor a 0.");
      return;
    }
    if (!reason.trim() || reason.trim().length < 2) {
      setFormError("La razón debe tener al menos 2 caracteres.");
      return;
    }
    setSubmitting(true);
    try {
      const response = await apiFetch("/api/cashier/v2/cash-movements", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ cashSessionId, type, amount: amt, reason: reason.trim(), notes: notes.trim() || null }),
      });
      const raw = await response.json();
      if (!response.ok) {
        setFormError(raw?.error?.message ?? "No se pudo registrar el movimiento.");
        return;
      }
      setAmount("");
      setReason("");
      setNotes("");
      setOpen(false);
      await load();
    } catch {
      setFormError("Error de red. Intenta de nuevo.");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="rounded-xl border border-[var(--color-border)] bg-[var(--color-surface)] overflow-hidden">
      <div className="px-4 py-3 border-b border-[var(--color-border)]">
        <div className="flex items-center justify-between gap-3">
          <div className="min-w-0">
            <h3 className="text-sm font-semibold text-[var(--color-text)]">Retiros y movimientos</h3>
            <p className="text-xs text-[var(--color-text-muted)]">Retira efectivo o registra gastos sin cerrar la sesión</p>
          </div>
          {canCreate && (
            <button
              type="button"
              className="hidden sm:block shrink-0 rounded-lg bg-[var(--color-master-600)] hover:bg-[var(--color-master-700)] px-3 py-2 text-xs font-semibold text-white transition-colors"
              onClick={() => { setType("CASH_OUT"); setOpen((v) => !v); }}
            >
              {open ? "Cancelar" : "Registrar retiro"}
            </button>
          )}
        </div>
        {canCreate && (
          <button
            type="button"
            className="sm:hidden mt-2.5 w-full rounded-lg bg-[var(--color-master-600)] hover:bg-[var(--color-master-700)] px-4 py-2.5 text-sm font-semibold text-white transition-colors"
            onClick={() => { setType("CASH_OUT"); setOpen((v) => !v); }}
          >
            {open ? "Cancelar" : "+ Registrar retiro"}
          </button>
        )}
      </div>

      {open && canCreate && (
        <div className="border-b border-[var(--color-border)] bg-[var(--color-surface-muted)] p-4 space-y-3">
          <div className="grid gap-3 sm:grid-cols-2">
            <label className="grid gap-1 text-xs">
              <span className="font-medium text-[var(--color-text-secondary)]">Tipo</span>
              <select
                className="hm-input rounded-lg text-sm"
                value={type}
                onChange={(e) => setType(e.target.value)}
                disabled={submitting}
              >
                {CREATABLE_TYPES.map((t) => (
                  <option key={t.value} value={t.value}>{t.label}</option>
                ))}
              </select>
            </label>
            <label className="grid gap-1 text-xs">
              <span className="font-medium text-[var(--color-text-secondary)]">Monto (C$)</span>
              <input
                className="hm-input rounded-lg text-sm"
                type="number"
                min="0.01"
                step="0.01"
                placeholder="0.00"
                value={amount}
                onChange={(e) => setAmount(e.target.value)}
                disabled={submitting}
              />
            </label>
          </div>
          <label className="grid gap-1 text-xs">
            <span className="font-medium text-[var(--color-text-secondary)]">Razón / Descripción</span>
            <input
              className="hm-input rounded-lg text-sm"
              type="text"
              placeholder="Ej: Compra de suministros de oficina"
              maxLength={200}
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              disabled={submitting}
            />
          </label>
          <label className="grid gap-1 text-xs">
            <span className="font-medium text-[var(--color-text-secondary)]">Notas adicionales (opcional)</span>
            <textarea
              className="hm-input rounded-lg text-sm resize-none"
              rows={2}
              maxLength={500}
              placeholder="Información adicional..."
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              disabled={submitting}
            />
          </label>
          {formError && (
            <p className="text-xs text-[var(--color-danger-600)]">{formError}</p>
          )}
          <button
            type="button"
            className="w-full sm:w-auto rounded-lg bg-[var(--color-info-600)] hover:bg-[var(--color-info-700)] px-4 py-2.5 sm:py-2 text-sm font-semibold text-white transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
            onClick={submit}
            disabled={submitting}
          >
            {submitting ? "Guardando..." : "Guardar movimiento"}
          </button>
        </div>
      )}

      <div className="divide-y divide-[var(--color-border)]">
        {loading ? (
          <p className="px-4 py-3 text-xs text-[var(--color-text-muted)] animate-pulse">Cargando movimientos...</p>
        ) : movements.length === 0 ? (
          <p className="px-4 py-4 text-center text-xs text-[var(--color-text-muted)]">Sin movimientos registrados en esta sesión.</p>
        ) : (
          movements.map((m) => (
            <div key={m.id} className="flex items-start gap-3 px-4 py-3">
              <span
                className={`mt-0.5 shrink-0 rounded border px-1.5 py-0.5 text-[0.65rem] font-semibold ${TYPE_COLOR[m.type] ?? TYPE_COLOR.CORRECTION}`}
              >
                {TYPE_LABELS[m.type] ?? m.type}
              </span>
              <div className="min-w-0 flex-1">
                <div className="flex items-baseline justify-between gap-2">
                  <span className="truncate text-sm font-medium text-[var(--color-text)]">{m.reason}</span>
                  <span className="shrink-0 text-sm font-bold text-[var(--color-text)]">
                    C$ {Number(m.amount).toFixed(2)}
                  </span>
                </div>
                {m.notes && (
                  <p className="mt-0.5 truncate text-xs text-[var(--color-text-muted)]">{m.notes}</p>
                )}
                <p className="mt-0.5 text-[0.65rem] text-[var(--color-text-soft)]">
                  {m.createdBy?.fullName ?? m.createdBy?.username ?? "Sistema"} ·{" "}
                  {new Date(m.createdAt).toLocaleString("es-NI", { hour12: true, hour: "2-digit", minute: "2-digit", day: "2-digit", month: "short" })}
                </p>
              </div>
            </div>
          ))
        )}
      </div>
    </div>
  );
}
