"use client";

import { useMemo, useState } from "react";
import { useSearchParams } from "next/navigation";
import Link from "next/link";
import type { Route } from "next";
import {
  LayoutDashboard, Receipt, Calculator, Users, Truck, BarChart3, Settings, ArrowRight, Info,
} from "lucide-react";
import { useSession } from "@/lib/client/session";
import { canInAnyAssignedBranch, CAPABILITIES } from "@/modules/rbac/policies";
import { ExpenseManager } from "@/components/expenses/expense-manager";
import { EmployeeManager } from "@/components/payroll/employee-manager";
import { FinanceSummaryPanel } from "@/components/finance/finance-summary-panel";

/**
 * Finanzas & Contabilidad — contenedor principal.
 *
 * Reúne, en un solo lugar, lo que antes estaba disperso: proyección comercial
 * (antes en Inventario), gastos operativos, precios/márgenes, planilla, fletes y
 * reportes. Reutiliza ExpenseManager (gastos/precios/fletes/config) y EmployeeManager
 * (planilla) sin duplicar lógica.
 *
 * TODO(finance-extract): mover progresivamente la lógica de ExpenseManager a
 * components/finance/{operating-expenses,pricing-margins,freight-costs}-panel.tsx
 * y la de planilla a payroll-finance-panel.tsx. Ver components/finance/.
 */

type FinanceTabKey = "summary" | "expenses" | "pricing" | "payroll" | "freight" | "reports" | "config";

export function FinanceAccountingManager() {
  const sessionState = useSession();
  const session = sessionState.status === "authenticated" ? sessionState.session : null;
  // La planilla expone salarios → solo con permiso explícito (caja/sales no la ven).
  const canViewPayroll = Boolean(session && canInAnyAssignedBranch(session, CAPABILITIES.FINANCE_VIEW_PAYROLL));

  const searchParams = useSearchParams();
  const requestedTab = (searchParams.get("tab") ?? "summary") as FinanceTabKey;

  const tabs = useMemo(() => {
    const base: Array<{ key: FinanceTabKey; label: string; icon: React.ElementType }> = [
      { key: "summary", label: "Resumen", icon: LayoutDashboard },
      { key: "expenses", label: "Gastos operativos", icon: Receipt },
      { key: "pricing", label: "Precios y márgenes", icon: Calculator },
    ];
    if (canViewPayroll) base.push({ key: "payroll", label: "Planilla", icon: Users });
    base.push(
      { key: "freight", label: "Fletes / costos internos", icon: Truck },
      { key: "reports", label: "Reportes", icon: BarChart3 },
      { key: "config", label: "Configuración", icon: Settings },
    );
    return base;
  }, [canViewPayroll]);

  const initialTab: FinanceTabKey = tabs.some((t) => t.key === requestedTab) ? requestedTab : "summary";
  const [activeTab, setActiveTab] = useState<FinanceTabKey>(initialTab);

  return (
    <div className="space-y-5">
      {/* Tabs */}
      <div className="flex gap-1 bg-[var(--color-surface-raised)] rounded-lg p-1 overflow-x-auto">
        {tabs.map(({ key, label, icon: Icon }) => (
          <button
            key={key}
            onClick={() => setActiveTab(key)}
            className={`flex items-center justify-center gap-2 px-4 py-2.5 rounded-md text-sm font-medium transition-all whitespace-nowrap
              ${activeTab === key
                ? "bg-[var(--color-surface)] text-[var(--color-text)] shadow-sm"
                : "text-[var(--color-text-muted)] hover:text-[var(--color-text)]"}`}
          >
            <Icon className="h-4 w-4" />
            <span className="hidden sm:inline">{label}</span>
          </button>
        ))}
      </div>

      {/* Contenido por tab */}
      {activeTab === "summary" && <FinanceSummaryPanel />}

      {/* Gastos operativos / Precios / Fletes / Config reutilizan ExpenseManager
          (un tab a la vez vía forcedTab; la barra interna se oculta). */}
      {activeTab === "expenses" && <ExpenseManager forcedTab="expenses" hideTabBar />}
      {activeTab === "pricing" && <ExpenseManager forcedTab="pricing" hideTabBar />}
      {activeTab === "freight" && <ExpenseManager forcedTab="freight" hideTabBar />}
      {activeTab === "config" && <ExpenseManager forcedTab="policies" hideTabBar />}

      {activeTab === "payroll" && canViewPayroll && (
        <div className="space-y-3">
          <div className="hm-alert hm-alert-info flex items-start gap-2">
            <Info className="h-4 w-4 mt-0.5 flex-shrink-0" />
            <div>
              El cálculo de planilla, costo patronal y neto a pagar vive aquí (Finanzas). Para editar la
              ficha del empleado (datos, roles, sucursales) ve a{" "}
              <Link href={"/app/master/users" as Route} className="font-semibold underline">Personal &amp; Roles</Link>.
            </div>
          </div>
          {/* TODO(finance-extract): mover a payroll-finance-panel.tsx (corrida de nómina). */}
          <EmployeeManager />
        </div>
      )}

      {activeTab === "reports" && (
        <div className="space-y-3">
          <div className="hm-alert hm-alert-info flex items-start gap-2">
            <Info className="h-4 w-4 mt-0.5 flex-shrink-0" />
            <div>Reportes financieros y de nómina. Exportaciones y KPIs detallados disponibles en el módulo de reportes.</div>
          </div>
          <Link
            href={"/app/master/reports" as Route}
            className="inline-flex items-center gap-2 rounded-lg px-4 py-2 text-sm font-semibold"
            style={{ background: "var(--color-surface-alt)", border: "0.5px solid var(--color-border)", color: "var(--color-text)" }}
          >
            Ir a Reportes & KPIs <ArrowRight className="h-4 w-4" />
          </Link>
          {/* TODO(finance-extract): finance-reports-panel.tsx con export de gastos/planilla/utilidad. */}
        </div>
      )}
    </div>
  );
}
