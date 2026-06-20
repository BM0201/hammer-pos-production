"use client";

/**
 * Sales Card — Vista mobile de historial de ventas
 * FASE 4 — H.A.M.M.E.R. POS/ERP
 */

import { Badge } from "@/components/ui/badge";

type HistoryEntry = {
  id: string;
  type: "sale" | "payment" | "production" | "operational_day";
  date: string;
  reference: string;
  branchName: string;
  branchCode: string;
  description: string;
  amount: number;
  status: string;
  user: string;
};

const STATUS_LABELS: Record<string, string> = {
  DRAFT: "Borrador",
  PENDING_PAYMENT: "Pendiente",
  PAID: "Pagada",
  DISPATCHED: "Despachada",
  CANCELLED: "Cancelada",
  POSTED: "Aplicado",
  COMPLETED: "Completado",
};

type SalesCardProps = {
  entry: HistoryEntry;
  onView?: () => void;
};

export function SalesCard({ entry, onView }: SalesCardProps) {
  const statusLabel = STATUS_LABELS[entry.status] ?? entry.status;

  return (
    <div
      onClick={onView}
      className="border border-[var(--color-border)] rounded-lg p-4 bg-[var(--color-surface)] hover:shadow-md transition-shadow cursor-pointer"
    >
      <div className="flex items-start justify-between mb-2">
        <div>
          <p className="font-mono text-sm font-bold">{entry.reference}</p>
          <p className="text-xs text-[var(--color-text-muted)]">{entry.branchName}</p>
        </div>
        <Badge variant="neutral" className="text-xs">
          {statusLabel}
        </Badge>
      </div>

      <p className="text-sm mb-2">{entry.description}</p>

      <div className="flex items-center justify-between text-xs text-[var(--color-text-muted)]">
        <span>{new Date(entry.date).toLocaleDateString("es-NI")}</span>
        <span className="font-bold text-base text-[var(--color-text)]">
          C$ {entry.amount.toFixed(2)}
        </span>
      </div>

      <p className="text-xs text-[var(--color-text-muted)] mt-2">Por: {entry.user}</p>
    </div>
  );
}
