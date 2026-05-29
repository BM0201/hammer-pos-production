"use client";

import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";

export type OperationalDay = {
  id: string;
  branchId: string;
  businessDate: string;
  status: "OPEN" | "CLOSING" | "CLOSED" | "CANCELLED";
  openedAt: string;
  closedAt?: string | null;
  salesTotal: string | number;
  paidOrdersTotal: string | number;
  pendingPaymentTotal: string | number;
  expectedCashTotal?: string | number | null;
  countedCashTotal?: string | number | null;
  cashDifferenceTotal?: string | number | null;
  openCashSessionsCount: number;
  autoClosedPendingReviewCount: number;
  pendingDispatchCount: number;
  criticalBrainDecisionCount: number;
  branch?: { id: string; code: string; name: string };
  openedBy?: { username: string; fullName?: string | null };
  cashSessions?: CashSessionRow[];
  summaryJson?: { paymentsByMethod?: Array<{ method: string; amount: number; count: number }> } | null;
};

export type CashSessionRow = {
  id: string;
  status: string;
  openingAmount: string | number;
  expectedCashAmount?: string | number | null;
  countedCashAmount?: string | number | null;
  differenceAmount?: string | number | null;
  openedAt: string;
  closedAt?: string | null;
  autoClosedAt?: string | null;
  requiresReview: boolean;
  physicalCashBox?: { code: string; description?: string | null };
  openedBy?: { username: string; fullName?: string | null };
};

function money(value: string | number | null | undefined) {
  return new Intl.NumberFormat("es-NI", { style: "currency", currency: "NIO" }).format(Number(value ?? 0));
}

export function OperationalDaySummary({ day }: { day: OperationalDay }) {
  const cards = [
    ["Ventas", money(day.salesTotal)],
    ["Pagadas", money(day.paidOrdersTotal)],
    ["Pendiente pago", money(day.pendingPaymentTotal)],
    ["Cajas abiertas", day.openCashSessionsCount],
    ["Auto-cierre pendiente", day.autoClosedPendingReviewCount],
    ["Diferencia caja", money(day.cashDifferenceTotal)],
    ["Despachos pendientes", day.pendingDispatchCount],
    ["Brain critico", day.criticalBrainDecisionCount],
  ];

  return (
    <section className="space-y-4">
      <Card className="p-5">
        <div className="flex flex-col gap-3 md:flex-row md:items-start md:justify-between">
          <div>
            <p className="text-xs font-semibold uppercase text-[var(--color-text-muted)]">Operacion de hoy</p>
            <h1 className="mt-1 text-2xl font-semibold text-[var(--color-text)]">{day.branch?.code ?? "Sucursal"} - {day.branch?.name ?? day.branchId}</h1>
            <p className="mt-1 text-sm text-[var(--color-text-muted)]">
              Fecha operativa {new Date(day.businessDate).toLocaleDateString("es-NI")} · abierto por {day.openedBy?.fullName ?? day.openedBy?.username ?? "usuario"}
            </p>
          </div>
          <Badge variant={day.status === "OPEN" ? "success" : day.status === "CLOSED" ? "neutral" : "warning"}>{day.status}</Badge>
        </div>
      </Card>

      <section className="hm-kpi-grid">
        {cards.map(([label, value]) => (
          <div key={label} className="hm-stat">
            <div className="text-xs font-semibold uppercase text-[var(--color-text-muted)]">{label}</div>
            <div className="mt-2 text-xl font-semibold text-[var(--color-text)]">{value}</div>
          </div>
        ))}
      </section>
    </section>
  );
}
