"use client";

import type { CashSessionProblem } from "../types";

type RealtimeSummary = {
  paidSalesCount?: number;
  pendingPaymentCount?: number;
} | null;

type PosSummaryCardsProps = {
  realtimeSummary: RealtimeSummary;
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
      className={`flex flex-col whitespace-nowrap border-l border-[var(--color-sidebar-hover)] px-2.5 sm:px-4`}
      style={{ lineHeight: 1.2 }}
    >
      <span className="text-[11px] text-[var(--color-sidebar-section)]">{label}</span>
      <span className="text-[14px] font-semibold tabular-nums text-[var(--color-sidebar-text-active)] sm:text-[15px]">
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
      {/* En teléfono solo el punto: el texto no cabe junto a las cifras. */}
      <div
        className="mr-2 inline-flex shrink-0 items-center gap-2 rounded-full border border-[var(--color-sidebar-hover)] bg-[var(--color-sidebar)] px-2.5 py-1.5 text-[12.5px] text-[var(--color-sidebar-text)] sm:mr-3 sm:px-3"
        title={pill.label}
      >
        <span className={`h-2.5 w-2.5 flex-shrink-0 rounded-full ${pill.dot}`} aria-hidden />
        <span className="sr-only sm:not-sr-only">{pill.label}</span>
      </div>

      {/* Solo cantidades: los montos dejarían sacar cuánto debe haber en la gaveta antes del conteo. */}
      <Stat label="Ventas hoy" value={String(realtimeSummary?.paidSalesCount ?? 0)} />
      <Stat label="Por cobrar" value={String(realtimeSummary?.pendingPaymentCount ?? 0)} />
    </div>
  );
}
