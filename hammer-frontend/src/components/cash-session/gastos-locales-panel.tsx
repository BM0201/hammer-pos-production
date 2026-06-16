"use client";

import { useCallback, useEffect, useState } from "react";
import { apiFetch } from "@/lib/client/api";
import { useSession } from "@/lib/client/session";
import { canInBranch, CAPABILITIES } from "@/modules/rbac/policies";

type OperatingExpense = {
  id: string;
  category: string;
  description: string;
  amount: string | number;
  isAutoCalculated: boolean;
  effectiveFrom: string;
  effectiveTo: string | null;
  employee?: { fullName: string } | null;
};

const CATEGORY_LABELS: Record<string, string> = {
  PAYROLL:     "Nómina",
  UTILITIES:   "Servicios (agua/luz/internet)",
  RENT:        "Alquiler",
  FOOD:        "Alimentación",
  MAINTENANCE: "Mantenimiento",
  TRANSPORT:   "Transporte",
  MARKETING:   "Publicidad / Marketing",
  OTHER:       "Otro",
};

const CATEGORY_COLOR: Record<string, string> = {
  PAYROLL:     "text-[var(--color-info-700)] bg-[var(--color-info-50)] border-[var(--color-info-200)]",
  UTILITIES:   "text-[var(--color-warning-700)] bg-[var(--color-warning-50)] border-[var(--color-warning-200)]",
  RENT:        "text-[var(--color-danger-700)] bg-[var(--color-danger-50)] border-[var(--color-danger-200)]",
  FOOD:        "text-[var(--color-success-700)] bg-[var(--color-success-50)] border-[var(--color-success-200)]",
  MAINTENANCE: "text-[var(--color-warning-700)] bg-[var(--color-warning-50)] border-[var(--color-warning-200)]",
  TRANSPORT:   "text-[var(--color-text-muted)] bg-[var(--color-surface-alt)] border-[var(--color-border)]",
  MARKETING:   "text-[var(--color-text-muted)] bg-[var(--color-surface-alt)] border-[var(--color-border)]",
  OTHER:       "text-[var(--color-text-muted)] bg-[var(--color-surface-alt)] border-[var(--color-border)]",
};

const CREATABLE_CATEGORIES = [
  { value: "UTILITIES",   label: "Servicios (agua/luz/internet)" },
  { value: "RENT",        label: "Alquiler" },
  { value: "FOOD",        label: "Alimentación" },
  { value: "MAINTENANCE", label: "Mantenimiento" },
  { value: "TRANSPORT",   label: "Transporte" },
  { value: "MARKETING",   label: "Publicidad / Marketing" },
  { value: "OTHER",       label: "Otro" },
];

export function GastosLocalesPanel({ branchId }: { branchId: string }) {
  const sessionState = useSession();
  const canCreate =
    sessionState.status === "authenticated" &&
    canInBranch(sessionState.session, branchId, CAPABILITIES.OPERATING_EXPENSE_CREATE);

  const [expenses, setExpenses] = useState<OperatingExpense[]>([]);
  const [loading, setLoading] = useState(true);
  const [open, setOpen] = useState(false);

  // form
  const [category, setCategory] = useState("UTILITIES");
  const [description, setDescription] = useState("");
  const [amount, setAmount] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [formError, setFormError] = useState("");

  const load = useCallback(async () => {
    const response = await apiFetch(`/api/branch/expenses?branchId=${branchId}`);
    if (!response.ok) return;
    const raw = await response.json();
    setExpenses((raw?.data ?? raw) as OperatingExpense[]);
  }, [branchId]);

  useEffect(() => {
    setLoading(true);
    load().finally(() => setLoading(false));
  }, [load]);

  // Group by category for totals
  const byCategory: Record<string, OperatingExpense[]> = {};
  let grandTotal = 0;
  for (const exp of expenses) {
    if (!byCategory[exp.category]) byCategory[exp.category] = [];
    byCategory[exp.category].push(exp);
    grandTotal += Number(exp.amount);
  }

  async function submit() {
    setFormError("");
    const amt = parseFloat(amount);
    if (!amount || isNaN(amt) || amt <= 0) {
      setFormError("Ingresa un monto válido mayor a 0.");
      return;
    }
    if (!description.trim() || description.trim().length < 1) {
      setFormError("La descripción es obligatoria.");
      return;
    }
    setSubmitting(true);
    try {
      const response = await apiFetch("/api/branch/expenses", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ branchId, category, description: description.trim(), amount: amt }),
      });
      const raw = await response.json();
      if (!response.ok) {
        setFormError(raw?.error?.message ?? "No se pudo registrar el gasto.");
        return;
      }
      setDescription("");
      setAmount("");
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
      <div className="flex items-center justify-between px-4 py-3 border-b border-[var(--color-border)]">
        <div>
          <h3 className="text-sm font-semibold text-[var(--color-text)]">Gastos del Local</h3>
          <p className="text-xs text-[var(--color-text-muted)]">
            Costos operativos del mes — nómina, servicios, alquiler, etc.
            {expenses.length > 0 && (
              <span className="ml-1 font-semibold text-[var(--color-text-secondary)]">
                Total: C$ {grandTotal.toLocaleString("es-NI", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
              </span>
            )}
          </p>
        </div>
        {canCreate && (
          <button
            type="button"
            className="rounded-lg bg-[var(--color-warning-600)] hover:bg-[var(--color-warning-700)] px-3 py-1.5 text-xs font-semibold text-white transition-colors"
            onClick={() => setOpen((v) => !v)}
          >
            {open ? "Cancelar" : "+ Agregar gasto"}
          </button>
        )}
      </div>

      {open && canCreate && (
        <div className="border-b border-[var(--color-border)] bg-[var(--color-surface-muted)] p-4 space-y-3">
          <div className="grid gap-3 sm:grid-cols-2">
            <label className="grid gap-1 text-xs">
              <span className="font-medium text-[var(--color-text-secondary)]">Categoría</span>
              <select
                className="hm-input rounded-lg text-sm"
                value={category}
                onChange={(e) => setCategory(e.target.value)}
                disabled={submitting}
              >
                {CREATABLE_CATEGORIES.map((c) => (
                  <option key={c.value} value={c.value}>{c.label}</option>
                ))}
              </select>
            </label>
            <label className="grid gap-1 text-xs">
              <span className="font-medium text-[var(--color-text-secondary)]">Monto mensual (C$)</span>
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
            <span className="font-medium text-[var(--color-text-secondary)]">Descripción</span>
            <input
              className="hm-input rounded-lg text-sm"
              type="text"
              placeholder="Ej: Factura ENATREL agosto"
              maxLength={200}
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              disabled={submitting}
            />
          </label>
          {formError && (
            <p className="text-xs text-[var(--color-danger-600)]">{formError}</p>
          )}
          <div className="flex justify-end">
            <button
              type="button"
              className="rounded-lg bg-[var(--color-warning-600)] hover:bg-[var(--color-warning-700)] px-4 py-2 text-sm font-semibold text-white transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
              onClick={submit}
              disabled={submitting}
            >
              {submitting ? "Guardando..." : "Guardar gasto"}
            </button>
          </div>
        </div>
      )}

      <div className="divide-y divide-[var(--color-border)]">
        {loading ? (
          <p className="px-4 py-3 text-xs text-[var(--color-text-muted)] animate-pulse">Cargando gastos...</p>
        ) : expenses.length === 0 ? (
          <div className="px-4 py-5 text-center">
            <p className="text-xs text-[var(--color-text-muted)]">Sin gastos operativos registrados.</p>
            <p className="mt-1 text-[0.65rem] text-[var(--color-text-soft)]">
              La nómina aparece aquí automáticamente cuando el administrador la publica. Usa "+ Agregar gasto" para servicios, alquiler, etc.
            </p>
          </div>
        ) : (
          Object.entries(byCategory).map(([cat, items]) => {
            const catTotal = items.reduce((s, i) => s + Number(i.amount), 0);
            return (
              <div key={cat}>
                <div className="flex items-center justify-between bg-[var(--color-surface-muted)] px-4 py-2">
                  <span className={`rounded border px-1.5 py-0.5 text-[0.65rem] font-semibold ${CATEGORY_COLOR[cat] ?? CATEGORY_COLOR.OTHER}`}>
                    {CATEGORY_LABELS[cat] ?? cat}
                  </span>
                  <span className="text-xs font-bold text-[var(--color-text-secondary)]">
                    C$ {catTotal.toLocaleString("es-NI", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                  </span>
                </div>
                {items.map((exp) => (
                  <div key={exp.id} className="flex items-center justify-between gap-2 px-4 py-2.5">
                    <div className="min-w-0">
                      <p className="truncate text-sm text-[var(--color-text)]">{exp.description}</p>
                      {exp.employee && (
                        <p className="text-[0.65rem] text-[var(--color-text-muted)]">{exp.employee.fullName}</p>
                      )}
                      {exp.isAutoCalculated && (
                        <span className="text-[0.6rem] text-[var(--color-info-600)]">Calculado automáticamente</span>
                      )}
                    </div>
                    <span className="shrink-0 text-sm font-bold text-[var(--color-text)]">
                      C$ {Number(exp.amount).toLocaleString("es-NI", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                    </span>
                  </div>
                ))}
              </div>
            );
          })
        )}
      </div>

      {expenses.length > 0 && (
        <div className="flex justify-between items-center border-t border-[var(--color-border)] bg-[var(--color-surface-muted)] px-4 py-3">
          <span className="text-sm font-semibold text-[var(--color-text)]">Total gastos del mes</span>
          <span className="text-sm font-bold text-[var(--color-danger-700)]">
            C$ {grandTotal.toLocaleString("es-NI", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
          </span>
        </div>
      )}
    </div>
  );
}
