"use client";

import { money } from "@/lib/format";
import type { CashSessionProblem } from "../types";

type RealtimeSummary = {
  paidSalesTotal?: number;
  paidSalesCount?: number;
  pendingPaymentTotal?: number;
} | null;

type PosSummaryCardsProps = {
  realtimeSummary: RealtimeSummary;
  summaryUpdatedAt: string | null;
  activeCashSessionId: string | null;
  cashSessionProblem?: CashSessionProblem | null;
};

// Bug reportado: este pill colapsaba TODO lo que no fuera "sesión OPEN
// asignada a mí" a "Caja cerrada" — incluyendo una caja en conciliación
// (RECONCILING) o auto-cerrada pendiente de revisión, que NO están
// realmente cerradas, están a mitad del cierre. Eso contradecía al panel
// de Caja (que sí muestra "EN CONCILIACIÓN") en la misma pantalla. El dato
// ya existía en el contexto (`cashSessionProblem`, /api/pos/v2/context) —
// solo faltaba usarlo acá.
function pillState(activeCashSessionId: string | null, cashSessionProblem?: CashSessionProblem | null) {
  if (cashSessionProblem === "CASH_SESSION_RECONCILING") return { label: "En conciliación", dot: "bg-[var(--color-warning-500)]" };
  if (cashSessionProblem === "CASH_SESSION_AUTO_CLOSED_PENDING_REVIEW") return { label: "Pendiente de revisión", dot: "bg-[var(--color-warning-500)]" };
  if (activeCashSessionId) return { label: "Caja activa", dot: "bg-[var(--color-pay)]" };
  return { label: "Caja cerrada", dot: "bg-[var(--color-sidebar-section)]" };
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div
      className="flex flex-col border-l border-[var(--color-sidebar-hover)] px-4"
      style={{ lineHeight: 1.2 }}
    >
      <span className="text-[10.5px] text-[var(--color-sidebar-section)]">{label}</span>
      <span className="text-[15px] font-semibold tabular-nums text-[var(--color-sidebar-text-active)]">
        {value}
      </span>
    </div>
  );
}

export function PosSummaryCards({
  realtimeSummary,
  activeCashSessionId,
  cashSessionProblem,
}: PosSummaryCardsProps) {
  const pill = pillState(activeCashSessionId, cashSessionProblem);
  return (
    <div className="flex items-center" data-testid="pos-summary-chips">
      {/* Caja pill */}
      <div className="mr-3 inline-flex items-center gap-2 rounded-full border border-[var(--color-sidebar-hover)] bg-[var(--color-sidebar)] px-3 py-1.5 text-[12.5px] text-[var(--color-sidebar-text)]">
        <span className={`h-2 w-2 flex-shrink-0 rounded-full ${pill.dot}`} />
        <span>{pill.label}</span>
      </div>

      <Stat label="Ventas hoy" value={money(realtimeSummary?.paidSalesTotal ?? 0)} />
      <Stat label="Cobradas" value={String(realtimeSummary?.paidSalesCount ?? 0)} />
      <Stat label="Por cobrar" value={money(realtimeSummary?.pendingPaymentTotal ?? 0)} />
    </div>
  );
}
