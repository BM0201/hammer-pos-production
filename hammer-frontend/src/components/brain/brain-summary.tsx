"use client";

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

function money(value: string | number | null | undefined) {
  return new Intl.NumberFormat("es-NI", { style: "currency", currency: "NIO" }).format(Number(value ?? 0));
}

export function BrainSummary({ kpis }: { kpis: BrainKpis }) {
  const cards = [
    ["Críticas abiertas", kpis.openCritical],
    ["Alto riesgo", kpis.highRisk ?? 0],
    ["Impacto estimado", money(kpis.estimatedImpact)],
    ["Reposiciones", kpis.reorderSuggested],
    ["Riesgos de caja", kpis.cashRisks],
    ["Margen bajo", kpis.lowMarginPrices],
    ["Despachos atrasados", kpis.lateDispatches ?? 0],
    ["Revisión manual", kpis.manualReview ?? 0],
  ];

  return (
    <section className="hm-kpi-grid">
      {cards.map(([label, value]) => (
        <div key={label} className="hm-stat">
          <div className="text-xs font-semibold uppercase text-[var(--color-text-muted)]">{label}</div>
          <div className="mt-2 text-xl font-semibold text-[var(--color-text)]">{value}</div>
        </div>
      ))}
    </section>
  );
}
