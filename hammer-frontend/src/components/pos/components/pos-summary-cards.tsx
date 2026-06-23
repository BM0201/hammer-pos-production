"use client";

import type { ReactNode } from "react";
import { Banknote, Clock, ReceiptText } from "lucide-react";
import { money } from "@/lib/format";

type RealtimeSummary = {
  paidSalesTotal?: number;
  paidSalesCount?: number;
  pendingPaymentTotal?: number;
  lastSale?: { orderNumber: string; amount: number } | null;
} | null;

type PosSummaryChipsProps = {
  realtimeSummary: RealtimeSummary;
  summaryUpdatedAt: string | null;
  activeCashSessionId: string | null;
};

function Chip({ icon, label, value }: { icon: ReactNode; label: string; value: string }) {
  return (
    <div className="flex items-center gap-1.5 rounded-lg border border-[var(--color-sidebar-hover)] bg-[color-mix(in_srgb,var(--color-sidebar-text)_6%,transparent)] px-3 py-1.5">
      <span className="text-[var(--color-sidebar-text)] opacity-60">{icon}</span>
      <span className="text-[0.65rem] font-medium text-[var(--color-sidebar-text)] opacity-60">{label}</span>
      <span className="text-xs font-bold tabular-nums text-[var(--color-sidebar-text-active)]">{value}</span>
    </div>
  );
}

export function PosSummaryCards({ realtimeSummary, activeCashSessionId }: PosSummaryChipsProps) {
  return (
    <div className="flex items-center gap-2 flex-wrap" data-testid="pos-summary-chips">
      <Chip
        icon={<Banknote className="h-3 w-3" />}
        label="Ventas hoy"
        value={money(realtimeSummary?.paidSalesTotal ?? 0)}
      />
      <Chip
        icon={<ReceiptText className="h-3 w-3" />}
        label="Cobradas"
        value={String(realtimeSummary?.paidSalesCount ?? 0)}
      />
      <Chip
        icon={<Clock className="h-3 w-3" />}
        label="Por cobrar"
        value={money(realtimeSummary?.pendingPaymentTotal ?? 0)}
      />
      <span
        className={[
          "rounded-lg px-2.5 py-1.5 text-[0.65rem] font-semibold",
          activeCashSessionId
            ? "bg-[color-mix(in_srgb,var(--color-pay)_20%,transparent)] text-[var(--color-pay-on-dark)]"
            : "bg-[color-mix(in_srgb,var(--color-sidebar-text)_8%,transparent)] text-[var(--color-sidebar-text)] opacity-50",
        ].join(" ")}
      >
        {activeCashSessionId ? "● Caja activa" : "Caja cerrada"}
      </span>
    </div>
  );
}
