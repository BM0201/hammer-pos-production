"use client";

import { useEffect, useMemo, useState } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import Link from "next/link";
import type { Route } from "next";
import {
  LayoutDashboard, Receipt, Users, Truck, BarChart3, ArrowRight, Info, Landmark,
} from "lucide-react";
import { useSession } from "@/lib/client/session";
import { canInAnyAssignedBranch, CAPABILITIES } from "@/modules/rbac/policies";
import { ExpenseManager } from "@/components/expenses/expense-manager";
import { FinanceSummaryPanel } from "@/components/finance/finance-summary-panel";
import { PayrollFinancePanel } from "@/components/finance/payroll-finance-panel";
import { BanksTreasuryPanel } from "@/components/finance/banks-treasury-panel";

/**
 * Finanzas & Contabilidad — contenedor principal.
 *
 * Reúne, en un solo lugar, lo que antes estaba disperso: proyección comercial
 * (antes en Inventario), gastos operativos, planilla, fletes y reportes.
 * Reutiliza ExpenseManager (gastos/fletes) y EmployeeManager (planilla) sin
 * duplicar lógica. Precios y márgenes se mudaron a la zona Precios
 * (/app/master/pricing) en la Fase 3 (prompt-mudanza-zona-precios.md) — ya
 * no es contabilidad, es una decisión comercial sobre el producto.
 *
 * TODO(finance-extract): mover progresivamente la lógica de ExpenseManager a
 * components/finance/{operating-expenses,freight-costs}-panel.tsx.
 * Planilla ya vive en payroll-finance-panel.tsx (Planilla V2).
 */

type FinanceTabKey = "summary" | "expenses" | "payroll" | "freight" | "banks" | "reports";

/**
 * Fase 3.3 (prompt-mudanza-zona-precios.md) — enlaces viejos a las pestañas
 * retiradas ("pricing" = calculadora, "config" = políticas por categoría, y
 * "policies" por si algún enlace la usó con ese nombre) redirigen a la zona
 * Precios con la pestaña equivalente, en vez de caer en blanco o en Resumen
 * sin explicación.
 */
const RETIRED_TAB_TO_PRICING_ZONE: Record<string, string> = {
  pricing: "calculator",
  config: "policies",
  policies: "policies",
};

export function FinanceAccountingManager() {
  const sessionState = useSession();
  const session = sessionState.status === "authenticated" ? sessionState.session : null;
  // La planilla expone salarios → solo con permiso explícito (caja/sales no la ven).
  const canViewPayroll = Boolean(session && canInAnyAssignedBranch(session, CAPABILITIES.FINANCE_VIEW_PAYROLL));
  const canManageTreasury = Boolean(session && canInAnyAssignedBranch(session, CAPABILITIES.TREASURY_MANAGE));

  const searchParams = useSearchParams();
  const router = useRouter();
  // Los cortes quincenales viven DENTRO de Planilla (tab "Cortes Quincenales"
  // del panel): el tab "biweekly" de Finanzas duplicaba ese flujo de pago.
  // Los enlaces viejos ?tab=biweekly caen en Planilla.
  const rawTab = searchParams.get("tab") ?? "summary";

  useEffect(() => {
    const zoneTab = RETIRED_TAB_TO_PRICING_ZONE[rawTab];
    if (zoneTab) router.replace(`/app/master/pricing?tab=${zoneTab}` as Parameters<typeof router.replace>[0]);
  }, [rawTab, router]);

  const requestedTab = (rawTab === "biweekly" ? "payroll" : rawTab) as FinanceTabKey;

  const tabs = useMemo(() => {
    const base: Array<{ key: FinanceTabKey; label: string; icon: React.ElementType }> = [
      { key: "summary", label: "Resumen", icon: LayoutDashboard },
      { key: "expenses", label: "Gastos operativos", icon: Receipt },
    ];
    if (canViewPayroll) {
      base.push({ key: "payroll", label: "Planilla", icon: Users });
    }
    base.push({ key: "freight", label: "Fletes / costos internos", icon: Truck });
    if (canManageTreasury) {
      base.push({ key: "banks", label: "Bancos y efectivo", icon: Landmark });
    }
    base.push({ key: "reports", label: "Reportes", icon: BarChart3 });
    return base;
  }, [canViewPayroll, canManageTreasury]);

  const initialTab: FinanceTabKey = tabs.some((t) => t.key === requestedTab) ? requestedTab : "summary";
  const [activeTab, setActiveTab] = useState<FinanceTabKey>(initialTab);
  const pathname = usePathname();

  // Sincroniza tab ↔ URL en ambas direcciones: cambiar de tab actualiza ?tab=
  // (compartible/refrescable), y navegar a un enlace con ?tab= estando ya en la
  // página cambia el tab (antes solo funcionaba en la carga inicial).
  useEffect(() => {
    if (tabs.some((t) => t.key === requestedTab)) setActiveTab(requestedTab);
  }, [requestedTab, tabs]);

  function selectTab(key: FinanceTabKey) {
    setActiveTab(key);
    const params = new URLSearchParams(searchParams.toString());
    if (key === "summary") params.delete("tab");
    else params.set("tab", key);
    router.replace(`${pathname}${params.size ? `?${params}` : ""}` as Parameters<typeof router.replace>[0], { scroll: false });
  }

  return (
    <div className="space-y-5">
      {/* Tabs */}
      <div className="flex gap-1 bg-[var(--color-surface-raised)] rounded-lg p-1 overflow-x-auto">
        {tabs.map(({ key, label, icon: Icon }) => (
          <button
            key={key}
            onClick={() => selectTab(key)}
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

      {/* Fase 3.4 (prompt-mudanza-zona-precios.md) — aviso de mudanza, temporal
          (tres meses desde 2026-08-27, después se saca). */}
      <p className="text-xs text-[var(--color-text-muted)]">
        Precios y Políticas por categoría se movieron a{" "}
        <Link href={"/app/master/pricing" as Route} className="font-medium text-[var(--color-info-700)] hover:underline">
          Precios
        </Link>
        .
      </p>

      {/* Contenido por tab */}
      {activeTab === "summary" && <FinanceSummaryPanel />}

      {/* Gastos operativos / Fletes reutilizan ExpenseManager (un tab a la vez
          vía forcedTab; la barra interna se oculta). */}
      {activeTab === "expenses" && <ExpenseManager forcedTab="expenses" hideTabBar />}
      {activeTab === "freight" && <ExpenseManager forcedTab="freight" hideTabBar />}

      {/* Planilla V2: el banner informativo (ahora descartable), el hero de costo
          y la tabla viven dentro del panel; los tabs Calcular Nómina / Préstamos /
          Historial se reutilizan de EmployeeManager con tab fijo. */}
      {activeTab === "payroll" && canViewPayroll && <PayrollFinancePanel />}

      {activeTab === "banks" && canManageTreasury && <BanksTreasuryPanel />}

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
