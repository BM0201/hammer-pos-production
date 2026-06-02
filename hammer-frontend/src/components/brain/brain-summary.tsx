"use client";

import {
  AlertOctagon,
  AlertTriangle,
  Banknote,
  Boxes,
  ClipboardCheck,
  DollarSign,
  PackageSearch,
  Truck,
} from "lucide-react";
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
  const cards = [
    {
      label: "Criticas abiertas",
      value: kpis.openCritical,
      hint: "Riesgos que requieren atencion inmediata",
      icon: AlertOctagon,
      tone: "border-red-200 bg-red-50 text-red-700 shadow-red-500/10",
      accent: "bg-red-500",
    },
    {
      label: "Alto riesgo",
      value: kpis.highRisk ?? 0,
      hint: "Decisiones con prioridad operativa alta",
      icon: AlertTriangle,
      tone: "border-amber-200 bg-amber-50 text-amber-800 shadow-amber-500/10",
      accent: "bg-amber-500",
    },
    {
      label: "Impacto estimado",
      value: money(kpis.estimatedImpact),
      hint: "Valor economico potencial",
      icon: DollarSign,
      tone: "border-emerald-200 bg-emerald-50 text-emerald-700 shadow-emerald-500/10",
      accent: "bg-emerald-500",
    },
    {
      label: "Reposiciones",
      value: kpis.reorderSuggested,
      hint: "Compras o traslados sugeridos",
      icon: Boxes,
      tone: "border-blue-200 bg-blue-50 text-blue-700 shadow-blue-500/10",
      accent: "bg-blue-500",
    },
    {
      label: "Riesgos de caja",
      value: kpis.cashRisks,
      hint: "Alertas de pagos, caja o cierres",
      icon: Banknote,
      tone: "border-fuchsia-200 bg-fuchsia-50 text-fuchsia-700 shadow-fuchsia-500/10",
      accent: "bg-fuchsia-500",
    },
    {
      label: "Margen bajo",
      value: kpis.lowMarginPrices,
      hint: "Precios que deben revisarse",
      icon: PackageSearch,
      tone: "border-orange-200 bg-orange-50 text-orange-700 shadow-orange-500/10",
      accent: "bg-orange-500",
    },
    {
      label: "Despachos atrasados",
      value: kpis.lateDispatches ?? 0,
      hint: "Entregas con seguimiento pendiente",
      icon: Truck,
      tone: "border-cyan-200 bg-cyan-50 text-cyan-700 shadow-cyan-500/10",
      accent: "bg-cyan-500",
    },
    {
      label: "Revision manual",
      value: kpis.manualReview ?? 0,
      hint: "Casos esperando criterio humano",
      icon: ClipboardCheck,
      tone: "border-indigo-200 bg-indigo-50 text-indigo-700 shadow-indigo-500/10",
      accent: "bg-indigo-500",
    },
  ];

  return (
    <section className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
      {cards.map((card) => {
        const Icon = card.icon;
        return (
          <div key={card.label} className={`relative overflow-hidden rounded-2xl border p-4 shadow-lg ${card.tone}`}>
            <div className={`absolute inset-x-0 top-0 h-1 ${card.accent}`} />
            <div className="flex items-start justify-between gap-3">
              <div>
                <div className="text-[11px] font-bold uppercase tracking-wide opacity-75">{card.label}</div>
                <div className="mt-2 text-2xl font-extrabold tracking-tight text-[var(--color-text)]">{card.value}</div>
              </div>
              <div className="rounded-xl bg-white/80 p-2 shadow-sm">
                <Icon className="h-5 w-5" />
              </div>
            </div>
            <p className="mt-3 text-xs leading-5 text-[var(--color-text-muted)]">{card.hint}</p>
          </div>
        );
      })}
    </section>
  );
}
