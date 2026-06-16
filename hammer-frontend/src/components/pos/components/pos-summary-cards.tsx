"use client";

import { Banknote, Clock, ReceiptText } from "lucide-react";
import { Card } from "@/components/ui/card";
import { money } from "@/lib/format";

type RealtimeSummary = {
  paidSalesTotal?: number;
  paidSalesCount?: number;
  pendingPaymentTotal?: number;
  lastSale?: { orderNumber: string; amount: number } | null;
} | null;

type PosSummaryCardsProps = {
  realtimeSummary: RealtimeSummary;
  summaryUpdatedAt: string | null;
  activeCashSessionId: string | null;
};

export function PosSummaryCards({ realtimeSummary, summaryUpdatedAt, activeCashSessionId }: PosSummaryCardsProps) {
  return (
    <div className="grid shrink-0 gap-3 md:grid-cols-5">
      <Card className="p-3">
        <p className="flex items-center gap-1.5 text-[0.68rem] font-semibold uppercase text-[var(--color-text-muted)]">
          <Banknote className="h-3.5 w-3.5" /> Ventas del dia
        </p>
        <p className="mt-1 text-lg font-bold text-[var(--color-text)]">{money(realtimeSummary?.paidSalesTotal ?? 0)}</p>
      </Card>
      <Card className="p-3">
        <p className="flex items-center gap-1.5 text-[0.68rem] font-semibold uppercase text-[var(--color-text-muted)]">
          <ReceiptText className="h-3.5 w-3.5" /> Cobradas
        </p>
        <p className="mt-1 text-lg font-bold text-[var(--color-text)]">{realtimeSummary?.paidSalesCount ?? 0}</p>
      </Card>
      <Card className="p-3">
        <p className="flex items-center gap-1.5 text-[0.68rem] font-semibold uppercase text-[var(--color-text-muted)]">
          <Clock className="h-3.5 w-3.5" /> Por cobrar
        </p>
        <p className="mt-1 text-lg font-bold text-[var(--color-text)]">{money(realtimeSummary?.pendingPaymentTotal ?? 0)}</p>
      </Card>
      <Card className="p-3 md:col-span-2">
        <p className="text-[0.68rem] font-semibold uppercase text-[var(--color-text-muted)]">Ultima venta</p>
        <p className="mt-1 truncate text-sm font-semibold text-[var(--color-text)]">
          {realtimeSummary?.lastSale
            ? `${realtimeSummary.lastSale.orderNumber} · ${money(realtimeSummary.lastSale.amount)}`
            : "Sin ventas cobradas"}
        </p>
        <p className="text-[0.68rem] text-[var(--color-text-muted)]">
          Caja {activeCashSessionId ? "activa" : "sin sesion"}
          {summaryUpdatedAt
            ? ` · actualizado ${new Date(summaryUpdatedAt).toLocaleTimeString("es-NI", { hour: "2-digit", minute: "2-digit", second: "2-digit" })}`
            : ""}
        </p>
      </Card>
    </div>
  );
}
