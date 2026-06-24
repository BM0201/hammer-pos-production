"use client";

import { Boxes, CheckCircle2, PackageSearch, Truck } from "lucide-react";
import { money } from "@/lib/format";

export type BrainKpis = {
  openCritical: number;
  highRisk?: number;
  estimatedImpact: string | number;
  reorderSuggested: number;
  cashRisks: number;
  lowMarginPrices: number;
  lateDispatches?: number;
  manualReview?: number;
};

export function BrainSummary({ kpis }: { kpis: BrainKpis }) {
  const reorderVal = kpis.reorderSuggested;
  const marginVal = kpis.lowMarginPrices;
  const dispatchVal = kpis.lateDispatches ?? 0;
  const allClear = reorderVal === 0 && marginVal === 0 && dispatchVal === 0;

  return (
    <section className="grid gap-3 lg:grid-cols-[1fr_260px]">
      {/* Left: hero + 2×2 severity grid */}
      <div className="grid gap-3 sm:grid-cols-[1fr_200px]">
        {/* Hero */}
        <div className="flex flex-col justify-between rounded-2xl border border-[var(--color-border)] bg-[var(--color-surface)] p-5 shadow-[var(--shadow-card)]">
          <p className="text-[11px] font-semibold uppercase tracking-wider text-[var(--color-text-muted)]">
            Valor en juego
          </p>
          <div className="mt-3 font-mono text-3xl font-extrabold tracking-tight text-[var(--color-text)]">
            {money(kpis.estimatedImpact)}
          </div>
          <p className="mt-2 text-xs leading-5 text-[var(--color-text-soft)]">
            Impacto económico estimado en decisiones abiertas
          </p>
        </div>

        {/* Severity 2×2 */}
        <div className="grid grid-cols-2 gap-2">
          <SeverityCell label="Críticas"       value={kpis.openCritical}      activeColor="var(--color-danger-700)" />
          <SeverityCell label="Alto riesgo"    value={kpis.highRisk ?? 0}     activeColor="var(--color-warning-700)" />
          <SeverityCell label="Riesgos caja"   value={kpis.cashRisks}         activeColor="var(--color-warning-700)" />
          <SeverityCell label="Rev. manual"    value={kpis.manualReview ?? 0} activeColor="var(--color-info-700)" />
        </div>
      </div>

      {/* Right: operational summary */}
      <div className="flex flex-col justify-center gap-2.5 rounded-2xl border border-[var(--color-border)] bg-[var(--color-surface)] px-4 py-4 shadow-[var(--shadow-card)]">
        <p className="text-[11px] font-semibold uppercase tracking-wider text-[var(--color-text-muted)]">Operativo</p>
        {allClear ? (
          <div className="flex items-start gap-2">
            <CheckCircle2 className="mt-0.5 h-4 w-4 flex-shrink-0 text-[var(--color-success-600)]" />
            <p className="text-xs leading-5 text-[var(--color-text-muted)]">
              Reposiciones, margen y despachos sin alertas — todo en orden.
            </p>
          </div>
        ) : (
          <div className="flex flex-wrap gap-2">
            {reorderVal > 0 && <OperationalChip icon={Boxes}         label="Reposición" value={reorderVal} />}
            {marginVal  > 0 && <OperationalChip icon={PackageSearch} label="Margen"     value={marginVal} />}
            {dispatchVal > 0 && <OperationalChip icon={Truck}        label="Despachos"  value={dispatchVal} />}
          </div>
        )}
      </div>
    </section>
  );
}

function SeverityCell({
  label,
  value,
  activeColor,
}: {
  label: string;
  value: number;
  activeColor: string;
}) {
  return (
    <div className="flex flex-col rounded-xl border border-[var(--color-border)] bg-[var(--color-surface)] px-3 py-2.5">
      <span className="text-[11px] text-[var(--color-text-muted)]">{label}</span>
      <span
        className="mt-1 text-xl font-extrabold tabular-nums"
        style={{ color: value > 0 ? activeColor : "var(--color-text-soft)" }}
      >
        {value}
      </span>
    </div>
  );
}

function OperationalChip({
  icon: Icon,
  label,
  value,
}: {
  icon: typeof Boxes;
  label: string;
  value: number;
}) {
  return (
    <span className="inline-flex items-center gap-1.5 rounded-full border border-[var(--color-warning-200)] bg-[var(--color-warning-50)] px-2.5 py-1 text-xs font-bold text-[var(--color-warning-700)]">
      <Icon className="h-3.5 w-3.5" />
      {label}: {value}
    </span>
  );
}
