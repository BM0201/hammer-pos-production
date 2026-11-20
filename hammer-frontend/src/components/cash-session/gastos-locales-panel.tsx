"use client";

import { useCallback, useEffect, useState } from "react";
import { apiFetch } from "@/lib/client/api";
import { money } from "@/lib/format";
import { CATEGORY_LABELS } from "@/components/expenses/expense-manager.types";
import { GASTOS_LOCAL_REFRESH_EVENT } from "./cash-movements-panel";

type OperatingExpense = {
  id: string;
  category: string;
  description: string;
  amount: string | number;
  isAutoCalculated: boolean;
  employee?: { fullName: string } | null;
  /** Solo presente en categoría PAYROLL: true = ya descontado de una caja física, false = pagado pero pendiente de aplicar, null/undefined = sin desembolso asociado. */
  disbursementCashApplied?: boolean | null;
};

/**
 * Resumen de solo lectura de los gastos de hoy. Se registran en "Salida de
 * dinero" con la caja abierta y este panel se refresca solo (evento). La
 * planilla aparece aquí el día de pago: la postea Master.
 */
export function GastosLocalesPanel({ branchId }: { branchId: string }) {
  const [expenses, setExpenses] = useState<OperatingExpense[]>([]);
  const [loading, setLoading] = useState(true);

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

  useEffect(() => {
    const onRefresh = () => { void load(); };
    window.addEventListener(GASTOS_LOCAL_REFRESH_EVENT, onRefresh);
    return () => window.removeEventListener(GASTOS_LOCAL_REFRESH_EVENT, onRefresh);
  }, [load]);

  const byCategory = new Map<string, OperatingExpense[]>();
  for (const exp of expenses) byCategory.set(exp.category, [...(byCategory.get(exp.category) ?? []), exp]);
  const grandTotal = expenses.reduce((sum, e) => sum + Number(e.amount), 0);

  return (
    <div className="overflow-hidden rounded-xl border border-[var(--color-border)] bg-[var(--color-surface)]">
      <div className="flex items-start justify-between gap-3 border-b border-[var(--color-border)] px-4 py-3">
        <div className="min-w-0">
          <h3 className="text-sm font-semibold text-[var(--color-text)]">Gastos de hoy</h3>
          <p className="text-xs text-[var(--color-text-muted)]">Se anotan en «Salida de dinero» con la caja abierta. La planilla la postea Master el día de pago.</p>
        </div>
        {expenses.length > 0 && (
          <span className="shrink-0 text-sm font-bold tabular-nums text-[var(--color-danger-700)]">{money(grandTotal)}</span>
        )}
      </div>

      {loading ? (
        <p className="animate-pulse px-4 py-3 text-xs text-[var(--color-text-muted)]">Cargando gastos…</p>
      ) : expenses.length === 0 ? (
        <p className="px-4 py-5 text-center text-sm text-[var(--color-text-muted)]">Todavía no hay gastos hoy.</p>
      ) : (
        <div className="divide-y divide-[var(--color-border)]">
          {[...byCategory.entries()].map(([cat, items]) => (
            <div key={cat}>
              <div className="flex items-center justify-between bg-[var(--color-surface-muted)] px-4 py-2">
                <span className="text-xs font-semibold text-[var(--color-text-secondary)]">{CATEGORY_LABELS[cat] ?? cat}</span>
                <span className="text-xs font-bold tabular-nums text-[var(--color-text-secondary)]">
                  {money(items.reduce((s, i) => s + Number(i.amount), 0))}
                </span>
              </div>
              {items.map((exp) => (
                <div key={exp.id} className="flex items-center justify-between gap-2 px-4 py-2.5">
                  <div className="min-w-0">
                    <p className="truncate text-sm text-[var(--color-text)]">{exp.description}</p>
                    {exp.employee && <p className="text-xs text-[var(--color-text-muted)]">{exp.employee.fullName}</p>}
                    {exp.isAutoCalculated && <span className="text-xs text-[var(--color-info-700)]">Calculado automáticamente</span>}
                    {exp.category === "PAYROLL" && exp.disbursementCashApplied != null && (
                      <span
                        className={`ml-1.5 inline-flex items-center rounded-full border px-1.5 py-0.5 text-[0.6875rem] font-semibold ${
                          exp.disbursementCashApplied
                            ? "border-[var(--color-success-200)] bg-[var(--color-success-50)] text-[var(--color-success-700)]"
                            : "border-[var(--color-warning-200)] bg-[var(--color-warning-50)] text-[var(--color-warning-700)]"
                        }`}
                      >
                        {exp.disbursementCashApplied ? "Descontado de caja" : "Pendiente de aplicar a caja"}
                      </span>
                    )}
                  </div>
                  <span className="shrink-0 text-sm font-bold tabular-nums text-[var(--color-text)]">{money(exp.amount)}</span>
                </div>
              ))}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
