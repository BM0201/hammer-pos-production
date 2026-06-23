"use client";

import React from "react";
import { Check, Receipt, Trash2 } from "lucide-react";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import type { TicketLine, TicketOrder } from "../types";
import { PosCheckoutBar } from "./pos-checkout-bar";

type PosContextMessages = {
  noCashBoxes?: string | null;
  noAssignedSession?: string | null;
} | null | undefined;

type PosTicketPanelProps = {
  ticketPanelRef: { current: HTMLDivElement | null };
  onEscapeToSearch: () => void;

  order: TicketOrder | null;
  orderStatusLabel: string;
  hasTicketLines: boolean;
  ticketLines: TicketLine[];

  lineDraftQuantities: Record<string, string>;
  lineQuantityErrors: Record<string, string>;
  lineUpdatingId: string | null;
  isSubmittingPayment: boolean;
  isBusy: boolean;
  setLineDraftQuantities: React.Dispatch<React.SetStateAction<Record<string, string>>>;
  setLineQuantityErrors: React.Dispatch<React.SetStateAction<Record<string, string>>>;
  commitLineQuantity: (line: TicketLine, forcedValue?: number, silent?: boolean) => void;
  removeLine: (lineId: string) => void;

  includeTransport: boolean;
  setIncludeTransport: (v: boolean) => void;
  transportAmount: string;
  setTransportAmount: (v: string) => void;
  transportTouched: boolean;
  setTransportTouched: (v: boolean) => void;
  transportAmountValue: number;
  transportValidationError: string | null;
  onClearNotice: () => void;

  canCollectHere: boolean;
  canSendToCashier: boolean;
  activeCashSessionId: string | null;
  posContextMessages: PosContextMessages;

  displayedTotalAmount: number;
  sendButtonRef: { current: HTMLButtonElement | null };
  onCompleteQueue: () => void;
  onOpenChargeDialog: () => void;
  onUpdateNotes: (notes: string) => void;
};

export function PosTicketPanel({
  ticketPanelRef,
  onEscapeToSearch,
  order,
  orderStatusLabel,
  hasTicketLines,
  ticketLines,
  lineDraftQuantities,
  lineQuantityErrors,
  lineUpdatingId,
  isSubmittingPayment,
  isBusy,
  setLineDraftQuantities,
  setLineQuantityErrors,
  commitLineQuantity,
  removeLine,
  includeTransport,
  setIncludeTransport,
  transportAmount,
  setTransportAmount,
  transportTouched,
  setTransportTouched,
  transportAmountValue,
  transportValidationError,
  onClearNotice,
  canCollectHere,
  canSendToCashier,
  activeCashSessionId,
  posContextMessages,
  displayedTotalAmount,
  sendButtonRef,
  onCompleteQueue,
  onOpenChargeDialog,
  onUpdateNotes,
}: PosTicketPanelProps) {
  function handleKeyDown(event: React.KeyboardEvent<HTMLDivElement>) {
    if (event.key === "Tab" && !event.shiftKey) {
      event.preventDefault();
      sendButtonRef.current?.focus();
      return;
    }
    if (event.key === "Escape") {
      event.preventDefault();
      onEscapeToSearch();
    }
  }

  return (
    <div
      ref={ticketPanelRef}
      tabIndex={0}
      onKeyDown={handleKeyDown}
      className="h-full min-h-0 rounded-lg outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-border-strong)]"
      data-testid="pos-ticket-zone"
    >
      <Card noPadding className="flex h-full min-h-0 flex-col overflow-hidden rounded-lg border-[var(--color-border)] shadow-sm">
        {/* ── Flat header (no gradient) ── */}
        <div className="flex items-center gap-2 border-b border-[var(--color-border)] px-4 py-3">
          <Receipt className="h-4 w-4 text-[var(--color-text-muted)]" />
          <div>
            <h2 className="text-sm font-semibold leading-tight text-[var(--color-text)]">Ticket actual</h2>
            <p className="text-[0.7rem] text-[var(--color-text-muted)]">
              Orden: {order?.orderNumber ?? "preparando..."} · {orderStatusLabel}
            </p>
          </div>
        </div>

        <div className="min-h-0 flex-1 overflow-y-auto px-3 pb-2" data-testid="pos-ticket-lines">
          {/* ── Line items ── */}
          {hasTicketLines ? (
            <div className="overflow-x-auto">
              <table className="hm-table min-w-[34rem] w-full">
                <thead>
                  <tr>
                    <th className="text-[var(--color-text-muted)]">Producto</th>
                    <th className="text-[var(--color-text-muted)]">Precio c/u</th>
                    <th className="text-[var(--color-text-muted)]">Cant.</th>
                    <th className="text-[var(--color-text-muted)]">Subtotal</th>
                    <th />
                  </tr>
                </thead>
                <tbody>
                  {ticketLines.map((line) => {
                    const qtyError = lineQuantityErrors[line.id];
                    const qtyValue = lineDraftQuantities[line.id] ?? line.quantity;

                    return (
                      <tr key={line.id} className="border-b border-[var(--color-border)]">
                        <td className="py-2">
                          <div className="font-medium text-[var(--color-text)]">{line.product?.name ?? line.productId}</div>
                          {Number(line.discountAmount) > 0 ? (
                            <div className="text-[0.65rem] text-[var(--color-text-muted)]">
                              Desc: -C$ {Number(line.discountAmount).toFixed(2)}
                            </div>
                          ) : null}
                        </td>
                        <td className="tabular-nums text-[var(--color-text-secondary)]">
                          C$ {Number(line.unitPrice).toFixed(2)}
                        </td>
                        <td>
                          <div className="flex items-center gap-2">
                            <input
                              className={[
                                "w-20 rounded-lg border px-2 py-1 text-sm",
                                "bg-[var(--color-surface)] text-[var(--color-text)]",
                                "placeholder:text-[var(--color-text-soft)]",
                                qtyError
                                  ? "border-[var(--color-danger-500)]"
                                  : "border-[var(--color-border)]",
                              ].join(" ")}
                              type="text"
                              inputMode="decimal"
                              value={qtyValue}
                              disabled={lineUpdatingId === line.id || isSubmittingPayment}
                              data-testid={`pos-line-qty-${line.id}`}
                              onChange={(event) => {
                                const next = event.target.value;
                                setLineDraftQuantities((prev) => ({ ...prev, [line.id]: next }));
                                if (!next.trim()) {
                                  setLineQuantityErrors((prev) => ({ ...prev, [line.id]: "La cantidad es obligatoria." }));
                                  return;
                                }
                                setLineQuantityErrors((prev) => {
                                  const copy = { ...prev };
                                  delete copy[line.id];
                                  return copy;
                                });
                              }}
                              onBlur={() => commitLineQuantity(line)}
                              onKeyDown={(event) => {
                                if (event.key === "Enter") {
                                  event.preventDefault();
                                  commitLineQuantity(line);
                                }
                              }}
                            />
                            <Button
                              variant="secondary"
                              size="sm"
                              disabled={lineUpdatingId === line.id || isSubmittingPayment}
                              onClick={() => commitLineQuantity(line)}
                              data-testid={`pos-line-apply-${line.id}`}
                              icon={<Check className="h-3.5 w-3.5" />}
                            >
                              Aplicar
                            </Button>
                          </div>
                          {qtyError ? (
                            <p className="mt-1 text-[0.7rem] text-[var(--color-danger-600)]">{qtyError}</p>
                          ) : null}
                        </td>
                        <td className="tabular-nums font-semibold text-[var(--color-text)]">
                          C$ {Number(line.lineSubtotal).toFixed(2)}
                        </td>
                        <td>
                          <Button
                            variant="ghost"
                            size="sm"
                            disabled={lineUpdatingId === line.id || isSubmittingPayment}
                            data-testid={`pos-line-remove-${line.id}`}
                            onClick={() => removeLine(line.id)}
                            className="text-[var(--color-text-soft)] hover:text-[var(--color-danger-600)] hover:bg-[var(--color-danger-50)]"
                            icon={<Trash2 className="h-3.5 w-3.5" />}
                          />
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          ) : null}

          {/* ── Empty state ── */}
          {order && !hasTicketLines ? (
            <div className="mt-4 rounded-xl border border-dashed border-[var(--color-border-strong)] bg-[var(--color-surface-muted)] p-8 text-center">
              <p className="text-sm font-semibold text-[var(--color-text)]">Ticket vacío</p>
              <p className="mt-1 text-xs text-[var(--color-text-muted)]">Toca un producto para agregarlo.</p>
            </div>
          ) : null}

          {/* ── Totals ── */}
          {hasTicketLines ? (
            <div className="mt-3 space-y-1 border-t border-[var(--color-border)] pt-3 text-sm">
              <div className="flex justify-between">
                <span className="text-[var(--color-text-secondary)]">Subtotal</span>
                <span className="tabular-nums text-[var(--color-text-secondary)]">C$ {Number(order?.subtotal ?? 0).toFixed(2)}</span>
              </div>
              {Number(order?.discountTotal ?? 0) > 0 ? (
                <div className="flex justify-between">
                  <span className="text-[var(--color-text-secondary)]">Descuento</span>
                  <span className="tabular-nums text-[var(--color-text-secondary)]">-C$ {Number(order?.discountTotal ?? 0).toFixed(2)}</span>
                </div>
              ) : null}
              {Number(order?.taxTotal ?? 0) > 0 ? (
                <div className="flex justify-between">
                  <span className="text-[var(--color-text-secondary)]">IVA</span>
                  <span className="tabular-nums text-[var(--color-text-secondary)]">C$ {Number(order?.taxTotal ?? 0).toFixed(2)}</span>
                </div>
              ) : null}
              {includeTransport && transportAmountValue > 0 ? (
                <div className="flex justify-between">
                  <span className="text-[var(--color-text-secondary)]">Transporte</span>
                  <span className="tabular-nums text-[var(--color-text-secondary)]">C$ {transportAmountValue.toFixed(2)}</span>
                </div>
              ) : null}
            </div>
          ) : null}

          {/* ── Transport toggle ── */}
          <label
            className={[
              "mt-3 flex cursor-pointer select-none items-start gap-3 rounded-lg border p-3 transition-colors",
              includeTransport
                ? "border-[var(--color-pay)] bg-[color-mix(in_srgb,var(--color-pay)_6%,transparent)]"
                : "border-[var(--color-border)] bg-[var(--color-surface)]",
            ].join(" ")}
            data-testid="pos-transport-toggle"
          >
            <input
              type="checkbox"
              checked={includeTransport}
              onChange={(event) => {
                const checked = event.target.checked;
                setIncludeTransport(checked);
                if (!checked) {
                  setTransportAmount("");
                  setTransportTouched(false);
                }
              }}
              className="mt-0.5 h-4 w-4 rounded border-[var(--color-border)]"
              disabled={isBusy}
            />
            <span>
              <span className="block text-sm font-semibold text-[var(--color-text)]">Agregar transporte</span>
              <span className="block text-xs text-[var(--color-text-muted)]">Flete, envío o entrega a domicilio</span>
            </span>
          </label>

          {includeTransport ? (
            <div className="mt-2 space-y-1">
              <label className="block text-xs font-medium text-[var(--color-text-muted)]">Monto de transporte (C$)</label>
              <input
                className={[
                  "w-full rounded-lg border px-3 py-2 text-sm outline-none",
                  "bg-[var(--color-surface)] text-[var(--color-text)] placeholder:text-[var(--color-text-soft)]",
                  "focus:ring-2 transition-colors",
                  transportTouched && transportValidationError
                    ? "border-[var(--color-danger-500)] focus:border-[var(--color-danger-500)] focus:ring-[var(--color-danger-100)]"
                    : "border-[var(--color-border)] focus:border-[var(--color-pay)] focus:ring-[var(--color-pay)]/10",
                ].join(" ")}
                type="number"
                min="0"
                step="0.01"
                value={transportAmount}
                onChange={(event) => {
                  setTransportAmount(event.target.value);
                  if (transportTouched) onClearNotice();
                }}
                onBlur={() => setTransportTouched(true)}
                placeholder="Ej: 150.00"
                disabled={isBusy}
                data-testid="pos-transport-amount"
              />
              {transportTouched && transportValidationError ? (
                <p className="text-xs text-[var(--color-danger-600)]" data-testid="pos-transport-error">
                  {transportValidationError}
                </p>
              ) : null}
            </div>
          ) : null}

          {/* ── Notes ── */}
          {order ? (
            <div className="mt-3">
              <label className="mb-1 block text-xs font-medium text-[var(--color-text-muted)]">
                Notas / instrucciones
              </label>
              <textarea
                className="w-full resize-none rounded-lg border border-[var(--color-border)] bg-[var(--color-surface)] px-3 py-2 text-sm text-[var(--color-text)] outline-none placeholder:text-[var(--color-text-soft)] focus:border-[var(--color-pay)] focus:ring-2 focus:ring-[var(--color-pay)]/10"
                rows={2}
                maxLength={1000}
                placeholder="Instrucciones especiales, nombre del cliente, referencias..."
                defaultValue={order.notes ?? ""}
                disabled={isBusy}
                data-testid="pos-order-notes"
                onBlur={(e) => onUpdateNotes(e.currentTarget.value)}
              />
            </div>
          ) : null}

          {/* ── Backend workflow messages ── */}
          {posContextMessages?.noCashBoxes ? (
            <div
              className="mt-3 rounded-lg border border-[var(--color-danger-200)] bg-[var(--color-danger-50)] p-3"
              data-testid="pos-no-cashboxes"
            >
              <p className="text-xs font-medium text-[var(--color-danger-600)]">
                ⚠️ {posContextMessages.noCashBoxes}
              </p>
              <p className="mt-1 text-xs text-[var(--color-danger-600)]">
                Pide a un administrador que cree una caja física para esta sucursal.
              </p>
            </div>
          ) : posContextMessages?.noAssignedSession ? (
            <div
              className="mt-3 rounded-lg border border-[var(--color-warning-200)] bg-[var(--color-warning-50)] p-3"
              data-testid="pos-no-session"
            >
              <p className="text-xs font-medium text-[var(--color-warning-700)]">
                {posContextMessages.noAssignedSession}
              </p>
            </div>
          ) : null}

          {/* ── No-action warning ── */}
          {!canSendToCashier && !canCollectHere ? (
            <div
              className="mt-3 rounded-lg border border-[var(--color-border)] bg-[var(--color-surface-alt)] p-3"
              data-testid="pos-no-actions"
            >
              <p className="text-xs text-[var(--color-text-secondary)]">
                Tu perfil o la configuración de esta sucursal no permite enviar a caja ni cobrar aquí.
                Contacta a un administrador para revisar permisos.
              </p>
            </div>
          ) : null}
        </div>

        <PosCheckoutBar
          hasTicketLines={hasTicketLines}
          displayedTotalAmount={displayedTotalAmount}
          canSendToCashier={canSendToCashier}
          canCollectHere={canCollectHere}
          activeCashSessionId={activeCashSessionId}
          isBusy={isBusy}
          isSubmittingPayment={isSubmittingPayment}
          hasOrder={Boolean(order)}
          includeTransport={includeTransport}
          transportValidationError={transportValidationError}
          sendButtonRef={sendButtonRef}
          onCompleteQueue={onCompleteQueue}
          onOpenChargeDialog={onOpenChargeDialog}
        />
      </Card>
    </div>
  );
}
