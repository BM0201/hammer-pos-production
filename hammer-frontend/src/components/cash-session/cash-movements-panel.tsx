"use client";

import { useCallback, useEffect, useState } from "react";
import { apiFetch } from "@/lib/client/api";
import { useSession } from "@/lib/client/session";
import { canInBranch, CAPABILITIES } from "@/modules/rbac/policies";

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

/** Evento para que "Gastos del Local" (panel hermano) se refresque al registrar un gasto aquí. */
export const GASTOS_LOCAL_REFRESH_EVENT = "hammer:gastos-local-refresh";

/**
 * ÚNICO lugar donde el cajero registra salidas/entradas de caja — a prueba de
 * errores: botones con la razón ya escrita, solo se anota el monto.
 *
 *  - Botones de GASTO → POST /api/branch/expenses: el flujo COMPLETO (registra
 *    el gasto operativo del día Y descuenta la caja en un solo paso; el
 *    resumen "Gastos del Local" de abajo se refresca solo).
 *  - Botones de DINERO (retiro/depósito/entrada) → movimiento de caja puro
 *    (no son gastos: el dinero cambia de lugar, no se consume).
 *
 * La PLANILLA no se registra aquí ni en Gastos del Local: la postea Master y
 * aparece sola en el resumen el día de pago (descuento de caja automático).
 */
type MovementPreset = {
  key: string;
  label: string;
  emoji: string;
  hint: string;
} & (
  | { kind: "expense"; category: string; reason: string; requireDetail?: boolean }
  | { kind: "movement"; type: string; reason: string }
);

const MOVEMENT_PRESETS: MovementPreset[] = [
  { key: "food", kind: "expense", category: "FOOD", label: "Comida / refrigerio", emoji: "🍱", reason: "Comida / refrigerio", hint: "Almuerzos, café, agua para el equipo" },
  { key: "transport", kind: "expense", category: "TRANSPORT", label: "Transporte / flete", emoji: "🚚", reason: "Transporte / flete", hint: "Taxi, acarreo, combustible del momento" },
  { key: "utilities", kind: "expense", category: "UTILITIES", label: "Servicios (agua/luz)", emoji: "💡", reason: "Servicios (agua/luz/internet)", hint: "Recibos de agua, luz, internet pagados de caja" },
  { key: "maintenance", kind: "expense", category: "MAINTENANCE", label: "Reparación / mantenimiento", emoji: "🔧", reason: "Reparación / mantenimiento", hint: "Arreglos del local o del equipo" },
  { key: "supplies", kind: "expense", category: "OTHER", label: "Suministros / limpieza", emoji: "🧹", reason: "Suministros / limpieza", hint: "Bolsas, papel, artículos de limpieza" },
  { key: "other", kind: "expense", category: "OTHER", label: "Otro gasto…", emoji: "✏️", reason: "", requireDetail: true, hint: "Cualquier otro gasto del local — describe qué fue" },
  { key: "cashout", kind: "movement", type: "CASH_OUT", label: "Retiro de efectivo", emoji: "💵", reason: "Retiro de efectivo", hint: "Dinero que se lleva Master / va a la bóveda (no es gasto)" },
  { key: "deposit", kind: "movement", type: "BANK_DEPOSIT_OUT", label: "Depósito al banco", emoji: "🏦", reason: "Depósito bancario", hint: "Efectivo que sale hacia el banco (no es gasto)" },
  { key: "cashin", kind: "movement", type: "CASH_IN", label: "Entrada de efectivo", emoji: "➕", reason: "Entrada de efectivo", hint: "Dinero que ENTRA a la gaveta (vuelto, fondo)" },
];

export function CashMovementsPanel({ cashSessionId, branchId }: { cashSessionId: string; branchId: string }) {
  const sessionState = useSession();
  const session = sessionState.status === "authenticated" ? sessionState.session : null;
  const canMove = Boolean(session && canInBranch(session, branchId, CAPABILITIES.CASH_MOVEMENT_CREATE));
  const canExpense = Boolean(session && canInBranch(session, branchId, CAPABILITIES.OPERATING_EXPENSE_CREATE));
  const canCreate = canMove || canExpense;

  const [movements, setMovements] = useState<CashMovement[]>([]);
  const [loading, setLoading] = useState(true);
  const [open, setOpen] = useState(false);

  // form: botón elegido → solo falta el monto (y detalle opcional)
  const [preset, setPreset] = useState<MovementPreset | null>(null);
  const [amount, setAmount] = useState("");
  const [detail, setDetail] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [formError, setFormError] = useState("");
  // Aviso del presupuesto inteligente: el gasto quedó registrado, pero el
  // monto se salió de los valores normales de su categoría.
  const [lastWarning, setLastWarning] = useState("");

  const visiblePresets = MOVEMENT_PRESETS.filter((p) => (p.kind === "expense" ? canExpense : canMove));

  function resetForm() {
    setPreset(null);
    setAmount("");
    setDetail("");
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
    if (!preset) return;
    setFormError("");
    const amt = parseFloat(amount);
    if (!amount || isNaN(amt) || amt <= 0) {
      setFormError("Anota el monto (mayor a 0).");
      return;
    }
    const trimmedDetail = detail.trim();
    if (preset.kind === "expense" && preset.requireDetail && trimmedDetail.length < 2) {
      setFormError("Describe qué fue el gasto (mínimo 2 caracteres).");
      return;
    }
    const description = preset.reason
      ? trimmedDetail
        ? `${preset.reason} — ${trimmedDetail}`
        : preset.reason
      : trimmedDetail;

    setSubmitting(true);
    try {
      const response =
        preset.kind === "expense"
          ? // Flujo COMPLETO: gasto operativo del día + egreso de caja en un paso.
            await apiFetch("/api/branch/expenses", {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({ branchId, category: preset.category, description, amount: amt }),
            })
          : await apiFetch("/api/cashier/v2/cash-movements", {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({ cashSessionId, type: preset.type, amount: amt, reason: description, notes: null }),
            });
      const raw = await response.json();
      if (!response.ok) {
        setFormError(raw?.error?.message ?? "No se pudo registrar.");
        return;
      }
      const warning = (raw?.data as { warning?: string | null } | undefined)?.warning;
      setLastWarning(typeof warning === "string" && warning ? warning : "");
      if (preset.kind === "expense" && typeof window !== "undefined") {
        // El resumen "Gastos del Local" (componente hermano) se refresca solo.
        window.dispatchEvent(new CustomEvent(GASTOS_LOCAL_REFRESH_EVENT));
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

      {lastWarning && (
        <div className="flex items-start gap-2 border-b border-[var(--color-warning-200)] bg-[var(--color-warning-50)] px-4 py-2.5">
          <span aria-hidden="true">⚠️</span>
          <p className="flex-1 text-xs text-[var(--color-warning-700)]">{lastWarning}</p>
          <button
            type="button"
            className="text-xs font-bold text-[var(--color-warning-700)]"
            onClick={() => setLastWarning("")}
            aria-label="Cerrar aviso"
          >
            ✕
          </button>
        </div>
      )}

      {open && canCreate && (
        <div className="border-b border-[var(--color-border)] bg-[var(--color-surface-muted)] p-4 space-y-3">
          {/* Paso 1 — elegir QUÉ pasó (la razón ya viene escrita) */}
          {!preset && (
            <>
              <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
                {visiblePresets.map((p) => (
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
              </div>
              <p className="text-[0.6875rem] text-[var(--color-text-soft)]">
                Los gastos quedan registrados también en <strong>Gastos del Local</strong> (abajo) y descuentan la caja
                en un solo paso. La <strong>planilla aparece ahí sola el día de pago</strong> — la postea Master.
              </p>
            </>
          )}

          {/* Paso 2 — anotar el monto */}
          {preset && (
            <>
              <div className="flex items-center justify-between gap-2">
                <span className="inline-flex items-center gap-2 rounded-lg border border-[var(--color-border-strong)] bg-[var(--color-surface)] px-3 py-1.5 text-sm font-semibold text-[var(--color-text)]">
                  {preset.emoji} {preset.label}
                </span>
                <button
                  type="button"
                  className="text-xs font-semibold text-[var(--color-info-600)] hover:underline"
                  onClick={resetForm}
                >
                  ← Cambiar
                </button>
              </div>

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
                <label className="grid gap-1 text-xs">
                  <span className="font-medium text-[var(--color-text-secondary)]">
                    {preset.kind === "expense" && preset.requireDetail ? "¿Qué fue? *" : "Detalle (opcional)"}
                  </span>
                  <input
                    className="hm-input rounded-lg text-sm"
                    type="text"
                    placeholder={`Ej: ${preset.hint}`}
                    maxLength={160}
                    value={detail}
                    onChange={(e) => setDetail(e.target.value)}
                    disabled={submitting}
                  />
                </label>
              </div>

              {formError && (
                <p className="text-xs text-[var(--color-danger-600)]">{formError}</p>
              )}
              <button
                type="button"
                className="w-full rounded-lg bg-[var(--color-info-600)] hover:bg-[var(--color-info-700)] px-4 py-2.5 text-sm font-semibold text-white transition-colors disabled:opacity-50 disabled:cursor-not-allowed sm:w-auto"
                onClick={submit}
                disabled={submitting}
              >
                {submitting ? "Guardando..." : `Guardar — ${preset.label.replace("…", "")}`}
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
