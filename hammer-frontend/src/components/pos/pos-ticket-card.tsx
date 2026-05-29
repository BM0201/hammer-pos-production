"use client";

/**
 * POS Ticket Card — Vista mobile de líneas de ticket
 * FASE 4 — H.A.M.M.E.R. POS/ERP
 */

type TicketLine = {
  id: string;
  productId: string;
  quantity: string;
  unitPrice: string;
  discountAmount: string;
  lineSubtotal: string;
  product?: { name?: string; sku?: string };
};

type TicketCardProps = {
  line: TicketLine;
  onUpdateQuantity: (lineId: string, newQuantity: string) => void;
  onRemove: (lineId: string) => void;
  isUpdating?: boolean;
};

export function TicketCard({ line, onUpdateQuantity, onRemove, isUpdating }: TicketCardProps) {
  const qty = Number(line.quantity);
  const price = Number(line.unitPrice);
  const discount = Number(line.discountAmount);
  const subtotal = Number(line.lineSubtotal);

  return (
    <div className="border border-[var(--color-border)] rounded-lg p-3 bg-[var(--color-surface)]">
      <div className="flex items-start justify-between mb-2">
        <div className="flex-1">
          <p className="font-medium text-sm">{line.product?.name ?? "Producto"}</p>
          <p className="text-xs text-[var(--color-text-muted)]">{line.product?.sku}</p>
        </div>
        <button
          onClick={() => onRemove(line.id)}
          disabled={isUpdating}
          className="text-[var(--color-danger-600)] hover:bg-[var(--color-danger-50)] p-2 rounded-lg transition-colors"
          aria-label="Eliminar"
        >
          ✕
        </button>
      </div>

      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <button
            onClick={() => onUpdateQuantity(line.id, String(Math.max(1, qty - 1)))}
            disabled={isUpdating || qty <= 1}
            className="bg-[var(--color-surface-alt)] hover:bg-[var(--color-border)] disabled:opacity-50 w-8 h-8 rounded-lg font-bold"
          >
            −
          </button>
          <span className="font-mono font-bold text-base w-8 text-center">{qty}</span>
          <button
            onClick={() => onUpdateQuantity(line.id, String(qty + 1))}
            disabled={isUpdating}
            className="bg-[var(--color-surface-alt)] hover:bg-[var(--color-border)] disabled:opacity-50 w-8 h-8 rounded-lg font-bold"
          >
            +
          </button>
        </div>
        <div className="text-right">
          <p className="text-xs text-[var(--color-text-muted)]">C$ {price.toFixed(2)} c/u</p>
          {discount > 0 && (
            <p className="text-xs text-[var(--color-success-600)]">-C$ {discount.toFixed(2)}</p>
          )}
          <p className="font-bold text-base">C$ {subtotal.toFixed(2)}</p>
        </div>
      </div>
    </div>
  );
}
