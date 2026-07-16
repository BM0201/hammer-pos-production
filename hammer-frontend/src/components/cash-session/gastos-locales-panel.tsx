"use client";

import { useCallback, useEffect, useState } from "react";
import { apiFetch } from "@/lib/client/api";
import { GASTOS_LOCAL_REFRESH_EVENT } from "./cash-movements-panel";

type OperatingExpense = {
  id: string;
  category: string;
  description: string;
  amount: string | number;
  isAutoCalculated: boolean;
  effectiveFrom: string;
  effectiveTo: string | null;
  employee?: { fullName: string } | null;
  /** Solo presente en categoría PAYROLL: true = ya descontado de una caja física, false = pagado pero pendiente de aplicar, null/undefined = sin desembolso asociado. */
  disbursementCashApplied?: boolean | null;
};

const CATEGORY_LABELS: Record<string, string> = {
  PAYROLL:     "Nómina",
  UTILITIES:   "Servicios (agua/luz/internet)",
  RENT:        "Alquiler",
  FOOD:        "Alimentación",
  MAINTENANCE: "Mantenimiento",
  TRANSPORT:   "Transporte",
  MARKETING:   "Publicidad / Marketing",
  TAXES:       "Impuestos (Alcaldía/DGI)",
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
  TAXES:       "text-[var(--color-danger-700)] bg-[var(--color-danger-50)] border-[var(--color-danger-200)]",
  OTHER:       "text-[var(--color-text-muted)] bg-[var(--color-surface-alt)] border-[var(--color-border)]",
};

/**
 * RESUMEN de solo lectura de los gastos operativos de HOY. El registro vive
 * ARRIBA, en "Gastos y retiros de caja" (un solo lugar, botones simples): al
 * guardar un gasto allá, este panel se refresca solo (evento). La PLANILLA
 * aparece aquí sola el día de pago — la postea Master, nadie la registra.
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

  // Refresco automático cuando el panel de arriba registra un gasto.
  useEffect(() => {
    const onRefresh = () => { void load(); };
    window.addEventListener(GASTOS_LOCAL_REFRESH_EVENT, onRefresh);
    return () => window.removeEventListener(GASTOS_LOCAL_REFRESH_EVENT, onRefresh);
  }, [load]);

  // Group by category for totals
  const byCategory: Record<string, OperatingExpense[]> = {};
  let grandTotal = 0;
  for (const exp of expenses) {
    if (!byCategory[exp.category]) byCategory[exp.category] = [];
    byCategory[exp.category].push(exp);
    grandTotal += Number(exp.amount);
  }

  return (
    <div className="rounded-xl border border-[var(--color-border)] bg-[var(--color-surface)] overflow-hidden">
      <div className="flex items-center justify-between px-4 py-3 border-b border-[var(--color-border)]">
        <div>
          <h3 className="text-sm font-semibold text-[var(--color-text)]">Gastos del Local (resumen de hoy)</h3>
          <p className="text-xs text-[var(--color-text-muted)]">
            Se registran arriba, en «Gastos y retiros de caja». La planilla aparece aquí sola el día de pago — la postea Master.
            {expenses.length > 0 && (
              <span className="ml-1 font-semibold text-[var(--color-text-secondary)]">
                Total: C$ {grandTotal.toLocaleString("es-NI", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
              </span>
            )}
          </p>
        </div>
      </div>

      <div className="divide-y divide-[var(--color-border)]">
        {loading ? (
          <p className="px-4 py-3 text-xs text-[var(--color-text-muted)] animate-pulse">Cargando gastos...</p>
        ) : expenses.length === 0 ? (
          <div className="px-4 py-5 text-center">
            <p className="text-xs text-[var(--color-text-muted)]">Sin gastos operativos registrados hoy.</p>
            <p className="mt-1 text-[0.65rem] text-[var(--color-text-soft)]">
              Los gastos que registres arriba aparecen aquí al instante y se limpian solos al cerrar el día.
              El día de pago (15 y fin de mes) también verás aquí la planilla, ya posteada por Master.
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
                      {exp.category === "PAYROLL" && exp.disbursementCashApplied != null && (
                        <span
                          className={`ml-1.5 inline-flex items-center rounded-full border px-1.5 py-0.5 text-[0.6rem] font-semibold ${
                            exp.disbursementCashApplied
                              ? "border-[var(--color-success-200)] bg-[var(--color-success-50)] text-[var(--color-success-700)]"
                              : "border-[var(--color-warning-200)] bg-[var(--color-warning-50)] text-[var(--color-warning-700)]"
                          }`}
                        >
                          {exp.disbursementCashApplied ? "✓ Descontado de caja" : "⏳ Pendiente de aplicar a caja"}
                        </span>
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
          <span className="text-sm font-semibold text-[var(--color-text)]">Total gastos del día</span>
          <span className="text-sm font-bold text-[var(--color-danger-700)]">
            C$ {grandTotal.toLocaleString("es-NI", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
          </span>
        </div>
      )}
    </div>
  );
}
