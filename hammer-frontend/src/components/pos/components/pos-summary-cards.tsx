"use client";

import { money } from "@/lib/format";

type RealtimeSummary = {
  paidSalesTotal?: number;
  paidSalesCount?: number;
  pendingPaymentTotal?: number;
} | null;

type PosSummaryCardsProps = {
  realtimeSummary: RealtimeSummary;
  summaryUpdatedAt: string | null;
  activeCashSessionId: string | null;
};

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
}: PosSummaryCardsProps) {
  return (
    <div className="flex items-center" data-testid="pos-summary-chips">
      {/* Caja pill */}
      <div className="mr-3 inline-flex items-center gap-2 rounded-full border border-[var(--color-sidebar-hover)] bg-[var(--color-sidebar)] px-3 py-1.5 text-[12.5px] text-[var(--color-sidebar-text)]">
        <span
          className={[
            "h-2 w-2 flex-shrink-0 rounded-full",
            activeCashSessionId
              ? "bg-[var(--color-pay)]"
              : "bg-[var(--color-sidebar-section)]",
          ].join(" ")}
        />
        <span>{activeCashSessionId ? "Caja activa" : "Caja cerrada"}</span>
      </div>

      <Stat label="Ventas hoy" value={money(realtimeSummary?.paidSalesTotal ?? 0)} />
      <Stat label="Cobradas" value={String(realtimeSummary?.paidSalesCount ?? 0)} />
      <Stat label="Por cobrar" value={money(realtimeSummary?.pendingPaymentTotal ?? 0)} />
    </div>
  );
}
