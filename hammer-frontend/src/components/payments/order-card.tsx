"use client";

/**
 * Order Card — Vista mobile de órdenes pendientes
 * FASE 4 — H.A.M.M.E.R. POS/ERP
 */

import { Badge } from "@/components/ui/badge";

type OrderLine = {
  id: string;
  productId: string;
  quantity: string;
  product?: { name?: string };
};

type PendingOrder = {
  id: string;
  orderNumber: string;
  status: string;
  subtotal: string;
  grandTotal: string;
  requiresTransport: boolean;
  transportAmount: string;
  branchId: string;
  lines: OrderLine[];
};

type OrderCardProps = {
  order: PendingOrder;
  isSelected: boolean;
  onSelect: () => void;
};

export function OrderCard({ order, isSelected, onSelect }: OrderCardProps) {
  const total = Number(order.grandTotal);
  const itemCount = order.lines.reduce((sum, l) => sum + Number(l.quantity), 0);

  return (
    <button
      onClick={onSelect}
      className={`w-full text-left p-4 rounded-lg border-2 transition-all ${
        isSelected
          ? "border-[var(--color-primary-600)] bg-[var(--color-primary-50)]"
          : "border-[var(--color-border)] bg-[var(--color-surface)] hover:border-[var(--color-primary-300)]"
      }`}
    >
      <div className="flex items-start justify-between mb-2">
        <div>
          <p className="font-bold text-base">{order.orderNumber}</p>
          <p className="text-xs text-[var(--color-text-muted)]">{itemCount} items</p>
        </div>
        <Badge variant="info" className="text-xs">
          {order.status === "PENDING_PAYMENT" ? "Pendiente" : order.status}
        </Badge>
      </div>

      <div className="flex items-center justify-between">
        <div className="flex flex-col gap-1">
          {order.requiresTransport && (
            <span className="text-xs text-[var(--color-warning-600)]">
              🚚 +C$ {Number(order.transportAmount).toFixed(2)}
            </span>
          )}
        </div>
        <p className="text-xl font-bold">C$ {total.toFixed(2)}</p>
      </div>
    </button>
  );
}
