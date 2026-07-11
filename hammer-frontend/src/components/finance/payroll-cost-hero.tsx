"use client";

import { Building2, Info, Users } from "lucide-react";
import { PayrollCompositionBar, type PayrollSegmentAmounts } from "./payroll-composition-bar";
import { fmtC, type PayrollRates, DEFAULT_PAYROLL_RATES } from "./payroll-calc";

/**
 * Hero de costo de Planilla: la historia del costo total empresa del mes —
 * cifra grande + cadena Base → Cargas → Neto + barra de composición.
 * Reemplaza a los 3 KPI tiles que antes rendía EmployeeManager dentro de Finanzas.
 */

export type PayrollHeroTotals = {
  /** Nómina base (suma de salarios brutos). */
  base: number;
  /** Neto a pagar a empleados. */
  net: number;
  /** Retenciones (INSS laboral + IR). */
  ret: number;
  patronal: number;
  inatec: number;
  /** Provisiones incluidas en `cost` (0 si el toggle está apagado). */
  prov: number;
  /** Costo total empresa (los segmentos suman exactamente esto). */
  cost: number;
  activeEmployees: number;
  branchCount: number;
};

type Props = {
  totals: PayrollHeroTotals;
  /** Ej. "Julio 2026". */
  periodLabel: string;
  /** Ej. "MGA — Managua Central" o null cuando el filtro es "Todas". */
  branchLabel: string | null;
  provisionsIncluded: boolean;
  rates?: PayrollRates;
  /** true cuando los números son cálculo de cliente (backend sin desglose aún). */
  estimated?: boolean;
};

export function PayrollCostHero({ totals, periodLabel, branchLabel, provisionsIncluded, rates = DEFAULT_PAYROLL_RATES, estimated = false }: Props) {
  const surcharge = totals.base > 0 ? ((totals.cost / totals.base - 1) * 100).toFixed(1) : "0.0";
  const amounts: PayrollSegmentAmounts = {
    neto: totals.net,
    ret: totals.ret,
    patronal: totals.patronal,
    inatec: totals.inatec,
    prov: totals.prov,
  };

  return (
    <div className="hm-module-card overflow-hidden">
      {/* franja superior con el gradiente de los segmentos */}
      <div
        className="h-[3px]"
        style={{
          background:
            "linear-gradient(90deg, var(--pay-seg-neto) 0%, var(--pay-seg-ret) 58%, var(--pay-seg-patronal) 68%, var(--pay-seg-inatec) 82%, var(--pay-seg-prov) 100%)",
        }}
      />
      <div className="p-5">
        <div className="mb-4 flex flex-wrap items-start justify-between gap-4">
          <div>
            <p className="mb-1.5 text-[0.6563rem] font-bold uppercase tracking-[0.08em] text-[var(--color-text-soft)]">
              Costo total empresa · {periodLabel}
              {provisionsIncluded ? "" : " · sin provisiones"}
              {estimated && (
                <span className="hm-badge hm-badge-warning ml-2 align-middle text-[0.5313rem]">Estimado</span>
              )}
            </p>
            <p className="hm-num-2xl">
              {fmtC(totals.cost)}
              <span className="ml-2.5 inline-flex translate-y-[-6px] items-center gap-1 rounded-full border border-[var(--color-warning-100)] bg-[var(--color-warning-50)] px-2.5 py-0.5 align-middle text-[0.7rem] font-bold text-[var(--color-warning-700)]">
                +{surcharge}% sobre la base
                <span className="group relative inline-flex cursor-help" tabIndex={0}>
                  <Info className="h-3 w-3" />
                  <span className="pointer-events-none absolute bottom-[calc(100%+8px)] left-1/2 z-[60] w-[235px] -translate-x-1/2 rounded-lg border border-[var(--color-border-strong)] bg-[var(--color-surface)] px-3 py-2 text-left text-[0.71rem] font-normal normal-case leading-relaxed tracking-normal text-[var(--color-text-secondary)] opacity-0 shadow-[var(--shadow-modal)] transition-opacity group-hover:opacity-100 group-focus-visible:opacity-100">
                    Esta es la cifra que se compara contra el presupuesto en el desempeño real (presupuesto vs. real), no la
                    nómina base: incluye INSS patronal, INATEC y provisiones.
                  </span>
                </span>
              </span>
            </p>
            {/* Cadena: Nómina base → + Cargas patronales → Neto a pagar */}
            <div className="mt-3 flex flex-wrap gap-6">
              {[
                { k: "Nómina base", v: fmtC(totals.base), cls: "text-[var(--color-text-secondary)]" },
                { k: "+ Cargas patronales", v: fmtC(totals.cost - totals.base), cls: "text-[var(--color-warning-600)]" },
                { k: "Neto a pagar", v: fmtC(totals.net), cls: "text-[var(--color-success-600)]" },
              ].map((item, i) => (
                <span key={item.k} className={i > 0 ? "border-l border-[var(--color-border-strong)] pl-6" : ""}>
                  <span className="block text-[0.6875rem] font-semibold uppercase tracking-[0.05em] text-[var(--color-text-soft)]">
                    {item.k}
                  </span>
                  <span className={`block text-[0.9688rem] font-bold tabular-nums ${item.cls}`}>{item.v}</span>
                </span>
              ))}
            </div>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <span className="inline-flex items-center gap-1.5 rounded-full border border-[var(--color-border)] bg-[var(--color-surface-alt)] px-2.5 py-1 text-[0.7188rem] font-semibold text-[var(--color-text-secondary)]">
              <Users className="h-3 w-3" />
              {totals.activeEmployees} empleado{totals.activeEmployees !== 1 ? "s" : ""} activos
            </span>
            <span className="inline-flex items-center gap-1.5 rounded-full border border-[var(--color-border)] bg-[var(--color-surface-alt)] px-2.5 py-1 text-[0.7188rem] font-semibold text-[var(--color-text-secondary)]">
              <Building2 className="h-3 w-3" />
              {branchLabel ?? `${totals.branchCount} sucursal${totals.branchCount !== 1 ? "es" : ""}`}
            </span>
          </div>
        </div>

        <PayrollCompositionBar amounts={amounts} total={totals.cost} rates={rates} />
      </div>
    </div>
  );
}
