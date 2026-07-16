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

/**
 * Registro SIMPLE para el día a día del cajero: botones de los gastos comunes
 * con la razón ya escrita — solo se anota el monto. "Otro" abre el formulario
 * completo (tipo + razón libre) para los casos raros. La PLANILLA no se
 * registra aquí: la postea y paga Master desde Finanzas › Planilla (el
 * descuento de caja por nómina es automático al pagar la quincena).
 */
type MovementPreset = {
  key: string;
  label: string;
  emoji: string;
  type: string;
  /** Razón prellenada — el cajero no tiene que redactar nada. */
  reason: string;
  hint: string;
};

const MOVEMENT_PRESETS: MovementPreset[] = [
  { key: "food", label: "Comida / refrigerio", emoji: "🍱", type: "EXPENSE_OUT", reason: "Comida / refrigerio", hint: "Almuerzos, café, agua para el equipo" },
  { key: "transport", label: "Transporte / flete", emoji: "🚚", type: "EXPENSE_OUT", reason: "Transporte / flete", hint: "Taxi, acarreo, combustible del momento" },
  { key: "supplies", label: "Suministros / limpieza", emoji: "🧹", type: "EXPENSE_OUT", reason: "Suministros / limpieza", hint: "Bolsas, papel, artículos de limpieza" },
  { key: "repair", label: "Reparación menor", emoji: "🔧", type: "EXPENSE_OUT", reason: "Reparación menor", hint: "Arreglos pequeños del local o equipo" },
  { key: "cashout", label: "Retiro de efectivo", emoji: "💵", type: "CASH_OUT", reason: "Retiro de efectivo", hint: "Dinero que se lleva Master / va a la bóveda" },
  { key: "deposit", label: "Depósito al banco", emoji: "🏦", type: "BANK_DEPOSIT_OUT", reason: "Depósito bancario", hint: "Efectivo que sale hacia el banco" },
  { key: "cashin", label: "Entrada de efectivo", emoji: "➕", type: "CASH_IN", reason: "Entrada de efectivo", hint: "Dinero que ENTRA a la gaveta (vuelto, fondo)" },
];

/** Tipos del formulario completo ("Otro") — casos que no calzan en un botón. */
const CREATABLE_TYPES = [
  { value: "EXPENSE_OUT", label: "Gasto de caja" },
  { value: "CASH_OUT", label: "Retiro de efectivo" },
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

  // form: preset elegido ("other" = formulario completo; null = solo botones)
  const [preset, setPreset] = useState<MovementPreset | null>(null);
  const [otherMode, setOtherMode] = useState(false);
  const [type, setType] = useState("EXPENSE_OUT");
  const [amount, setAmount] = useState("");
  const [reason, setReason] = useState("");
  const [notes, setNotes] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [formError, setFormError] = useState("");

  function resetForm() {
    setPreset(null);
    setOtherMode(false);
    setType("EXPENSE_OUT");
    setAmount("");
    setReason("");
    setNotes("");
    setFormError("");
  }

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
      setFormError("Anota el monto (mayor a 0).");
      return;
    }
    // Con botón: la razón ya viene escrita (el detalle es opcional).
    // Con "Otro": la razón libre sí es obligatoria.
    let finalType = type;
    let finalReason = reason.trim();
    if (preset) {
      finalType = preset.type;
      finalReason = finalReason ? `${preset.reason} — ${finalReason}` : preset.reason;
    } else if (!finalReason || finalReason.length < 2) {
      setFormError("Escribe una razón (mínimo 2 caracteres).");
      return;
    }
    setSubmitting(true);
    try {
      const response = await apiFetch("/api/cashier/v2/cash-movements", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ cashSessionId, type: finalType, amount: amt, reason: finalReason, notes: notes.trim() || null }),
      });
      const raw = await response.json();
      if (!response.ok) {
        setFormError(raw?.error?.message ?? "No se pudo registrar el movimiento.");
        return;
      }
      resetForm();
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
            <h3 className="text-sm font-semibold text-[var(--color-text)]">Gastos y retiros de caja</h3>
            <p className="text-xs text-[var(--color-text-muted)]">Toca qué salió de la caja y anota el monto — nada más</p>
          </div>
          {canCreate && (
            <button
              type="button"
              className="hidden sm:block shrink-0 rounded-lg bg-[var(--color-master-600)] hover:bg-[var(--color-master-700)] px-3 py-2 text-xs font-semibold text-white transition-colors"
              onClick={() => { resetForm(); setOpen((v) => !v); }}
            >
              {open ? "Cancelar" : "Registrar gasto o retiro"}
            </button>
          )}
        </div>
        {canCreate && (
          <button
            type="button"
            className="sm:hidden mt-2.5 w-full rounded-lg bg-[var(--color-master-600)] hover:bg-[var(--color-master-700)] px-4 py-2.5 text-sm font-semibold text-white transition-colors"
            onClick={() => { resetForm(); setOpen((v) => !v); }}
          >
            {open ? "Cancelar" : "+ Registrar gasto o retiro"}
          </button>
        )}
      </div>

      {open && canCreate && (
        <div className="border-b border-[var(--color-border)] bg-[var(--color-surface-muted)] p-4 space-y-3">
          {/* Paso 1 — elegir QUÉ pasó (botones grandes, razón ya escrita) */}
          {!preset && !otherMode && (
            <>
              <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
                {MOVEMENT_PRESETS.map((p) => (
                  <button
                    key={p.key}
                    type="button"
                    title={p.hint}
                    onClick={() => { setPreset(p); setFormError(""); }}
                    className="flex min-h-[64px] flex-col items-center justify-center gap-1 rounded-xl border-[1.5px] border-[var(--color-border)] bg-[var(--color-surface)] px-2 py-3 text-center transition-colors hover:border-[var(--color-info-400)] hover:bg-[var(--color-surface-alt)]"
                  >
                    <span className="text-xl leading-none" aria-hidden="true">{p.emoji}</span>
                    <span className="text-[0.7rem] font-semibold leading-tight text-[var(--color-text)]">{p.label}</span>
                  </button>
                ))}
                <button
                  type="button"
                  onClick={() => { setOtherMode(true); setFormError(""); }}
                  className="flex min-h-[64px] flex-col items-center justify-center gap-1 rounded-xl border-[1.5px] border-dashed border-[var(--color-border-strong)] bg-transparent px-2 py-3 text-center transition-colors hover:bg-[var(--color-surface-alt)]"
                >
                  <span className="text-xl leading-none" aria-hidden="true">✏️</span>
                  <span className="text-[0.7rem] font-semibold leading-tight text-[var(--color-text-muted)]">Otro…</span>
                </button>
              </div>
              <p className="text-[0.6875rem] text-[var(--color-text-soft)]">
                La <strong>planilla no se registra aquí</strong>: la postea y paga Master desde Finanzas › Planilla
                (el descuento de caja por nómina es automático).
              </p>
            </>
          )}

          {/* Paso 2 — anotar el monto (con botón la razón ya viene lista) */}
          {(preset || otherMode) && (
            <>
              <div className="flex items-center justify-between gap-2">
                <span className="inline-flex items-center gap-2 rounded-lg border border-[var(--color-border-strong)] bg-[var(--color-surface)] px-3 py-1.5 text-sm font-semibold text-[var(--color-text)]">
                  {preset ? <>{preset.emoji} {preset.label}</> : <>✏️ Otro movimiento</>}
                </span>
                <button
                  type="button"
                  className="text-xs font-semibold text-[var(--color-info-600)] hover:underline"
                  onClick={() => { resetForm(); }}
                >
                  ← Cambiar
                </button>
              </div>

              {otherMode && (
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
                    <span className="font-medium text-[var(--color-text-secondary)]">Razón *</span>
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
                </div>
              )}

              <div className="grid gap-3 sm:grid-cols-2">
                <label className="grid gap-1 text-xs">
                  <span className="font-medium text-[var(--color-text-secondary)]">Monto (C$) *</span>
                  <input
                    className="hm-input rounded-lg text-base font-semibold"
                    type="number"
                    min="0.01"
                    step="0.01"
                    placeholder="0.00"
                    autoFocus
                    value={amount}
                    onChange={(e) => setAmount(e.target.value)}
                    disabled={submitting}
                  />
                </label>
                {preset && (
                  <label className="grid gap-1 text-xs">
                    <span className="font-medium text-[var(--color-text-secondary)]">Detalle (opcional)</span>
                    <input
                      className="hm-input rounded-lg text-sm"
                      type="text"
                      placeholder={`Ej: ${preset.hint}`}
                      maxLength={160}
                      value={reason}
                      onChange={(e) => setReason(e.target.value)}
                      disabled={submitting}
                    />
                  </label>
                )}
              </div>

              {otherMode && (
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
              )}

              {formError && (
                <p className="text-xs text-[var(--color-danger-600)]">{formError}</p>
              )}
              <button
                type="button"
                className="w-full rounded-lg bg-[var(--color-info-600)] hover:bg-[var(--color-info-700)] px-4 py-2.5 text-sm font-semibold text-white transition-colors disabled:opacity-50 disabled:cursor-not-allowed sm:w-auto"
                onClick={submit}
                disabled={submitting}
              >
                {submitting ? "Guardando..." : `Guardar${preset ? ` — ${preset.label}` : " movimiento"}`}
              </button>
            </>
          )}
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
