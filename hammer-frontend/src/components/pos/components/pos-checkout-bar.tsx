"use client";

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
  onCompleteDirect: () => void;
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
  onCompleteDirect,
}: PosCheckoutBarProps) {
  const totalLabel = `C$ ${displayedTotalAmount.toFixed(2)}`;
  const transportBlocked = Boolean(includeTransport && transportValidationError);

  return (
    <div
      className="shrink-0 rounded-b-lg border-t border-[var(--color-border)] bg-[var(--color-surface-muted)] px-4 py-3 shadow-[0_-4px_12px_-8px_rgba(0,0,0,0.25)]"
      data-testid="pos-payment-zone"
    >
      <div className="flex items-center justify-between text-lg">
        <span className="font-medium text-[var(--color-text)]">Total</span>
        <strong data-testid="pos-total">{totalLabel}</strong>
      </div>
      <div className="mt-2 grid gap-2 sm:grid-cols-2">
        {canSendToCashier ? (
          <Button
            ref={sendButtonRef}
            variant="secondary"
            className="w-full rounded-lg text-sm"
            onClick={onCompleteQueue}
            disabled={isBusy || !hasOrder || !hasTicketLines || transportBlocked}
            data-testid="pos-send-to-payment"
            icon={<ShoppingCart className="h-5 w-5" />}
            loading={isSubmittingPayment}
          >
            {!hasTicketLines ? "Agrega productos" : `Enviar a caja - ${totalLabel}`}
          </Button>
        ) : null}
        {canCollectHere ? (
          <Button
            ref={!canSendToCashier ? sendButtonRef : undefined}
            variant="success"
            className="w-full rounded-lg text-sm"
            onClick={onCompleteDirect}
            disabled={isBusy || !hasOrder || !hasTicketLines || !activeCashSessionId || transportBlocked}
            data-testid="pos-direct-collect"
            icon={<Check className="h-5 w-5" />}
            loading={isSubmittingPayment}
          >
            {!hasTicketLines ? "Agrega productos" : `Cobrar aqui - ${totalLabel}`}
          </Button>
        ) : null}
      </div>
    </div>
  );
}
