"use client";

import type { ReactNode } from "react";
import { Check, ShoppingCart } from "lucide-react";
import { Button } from "@/components/ui/button";

type PosCheckoutBarProps = {
  hasTicketLines: boolean;
  displayedTotalAmount: number;
  canSendToCashier: boolean;
  canCollectHere: boolean;
  activeCashSessionId: string | null;
  isBusy: boolean;
  isSubmittingPayment: boolean;
  hasOrder: boolean;
  includeTransport: boolean;
  transportValidationError: string | null;
  sendButtonRef: { current: HTMLButtonElement | null };
  onCompleteQueue: () => void;
  onOpenChargeDialog: () => void;
};

export function PosCheckoutBar({
  hasTicketLines,
  displayedTotalAmount,
  canSendToCashier,
  canCollectHere,
  activeCashSessionId,
  isBusy,
  isSubmittingPayment,
  hasOrder,
  includeTransport,
  transportValidationError,
  sendButtonRef,
  onCompleteQueue,
  onOpenChargeDialog,
}: PosCheckoutBarProps) {
  const totalLabel = `C$ ${displayedTotalAmount.toFixed(2)}`;
  const transportBlocked = Boolean(includeTransport && transportValidationError);
  const baseDisabled = isBusy || !hasOrder || !hasTicketLines || transportBlocked;

  // ── La zona de pago (shell + fila "Total") es la misma en los 3 casos;
  //    solo cambia la acción primaria por capacidad. ──
  let action: ReactNode;

  if (!canSendToCashier && !canCollectHere) {
    action = (
      <div className="px-4 pb-4">
        <button
          disabled
          className="w-full rounded-lg border border-[var(--color-border)] bg-[var(--color-surface-alt)] px-4 py-2.5 text-sm text-[var(--color-text-soft)] cursor-not-allowed"
        >
          Sin permiso para cobrar
        </button>
      </div>
    );
  } else if (canCollectHere) {
    // Cobrar (direct collect — opens charge dialog)
    const disabled = baseDisabled || !activeCashSessionId;
    action = (
      <div className="px-4 pb-4 flex flex-col gap-2">
        <Button
          ref={sendButtonRef}
          variant="success"
          className="w-full rounded-lg"
          onClick={onOpenChargeDialog}
          disabled={disabled}
          data-testid="pos-direct-collect"
          icon={<Check className="h-4 w-4" />}
          loading={isSubmittingPayment}
        >
          {!hasTicketLines ? "Agrega productos para cobrar" : `Cobrar  ${totalLabel}`}
        </Button>
        {hasTicketLines && !activeCashSessionId ? (
          <p className="text-center text-[11px] text-[var(--color-warning-700)]">
            Abre una sesión de caja para poder cobrar aquí.
          </p>
        ) : null}
        {canSendToCashier ? (
          <Button
            variant="ghost"
            size="sm"
            className="w-full rounded-lg text-[var(--color-text-muted)]"
            onClick={onCompleteQueue}
            disabled={baseDisabled}
            data-testid="pos-send-to-payment"
            icon={<ShoppingCart className="h-3.5 w-3.5" />}
          >
            Enviar a caja
          </Button>
        ) : null}
      </div>
    );
  } else {
    // Enviar a caja solo (vendedor sin cobro directo)
    action = (
      <div className="px-4 pb-4">
        <Button
          ref={sendButtonRef}
          variant="success"
          className="w-full rounded-lg"
          onClick={onCompleteQueue}
          disabled={baseDisabled}
          data-testid="pos-send-to-payment"
          icon={<ShoppingCart className="h-4 w-4" />}
          loading={isSubmittingPayment}
        >
          {!hasTicketLines ? "Agrega productos para cobrar" : `Enviar a caja  ${totalLabel}`}
        </Button>
      </div>
    );
  }

  return (
    <div
      className="shrink-0 rounded-b-lg border-t border-[var(--color-border)] bg-[var(--color-surface-muted)] shadow-[0_-4px_12px_-8px_rgba(0,0,0,0.15)]"
      data-testid="pos-payment-zone"
    >
      <div className="flex items-center justify-between px-4 pt-3 pb-2">
        <span className="text-sm font-medium text-[var(--color-text-secondary)]">Total</span>
        <strong className="text-lg tabular-nums text-[var(--color-text)]" data-testid="pos-total">
          {totalLabel}
        </strong>
      </div>
      {action}
    </div>
  );
}
