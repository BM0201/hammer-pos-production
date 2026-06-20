"use client";

import React from "react";
import { Check, Trash2 } from "lucide-react";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import type { TicketLine, TicketOrder } from "../types";
import { PosCheckoutBar } from "./pos-checkout-bar";

type PosContextMessages = {
  noCashBoxes?: string | null;
  noAssignedSession?: string | null;
} | null | undefined;

type PosTicketPanelProps = {
  // Ref for focus management (keyboard Tab from catalog)
  ticketPanelRef: { current: HTMLDivElement | null };
  /** Called on Escape key — returns focus to the search input. */
  onEscapeToSearch: () => void;

  // Order state
  order: TicketOrder | null;
  orderStatusLabel: string;
  hasTicketLines: boolean;
  ticketLines: TicketLine[];

  // Line editing
  lineDraftQuantities: Record<string, string>;
  lineQuantityErrors: Record<string, string>;
  lineUpdatingId: string | null;
  isSubmittingPayment: boolean;
  isBusy: boolean;
  setLineDraftQuantities: React.Dispatch<React.SetStateAction<Record<string, string>>>;
  setLineQuantityErrors: React.Dispatch<React.SetStateAction<Record<string, string>>>;
  commitLineQuantity: (line: TicketLine, forcedValue?: number, silent?: boolean) => void;
  removeLine: (lineId: string) => void;

  // Transport
  includeTransport: boolean;
  setIncludeTransport: (v: boolean) => void;
  transportAmount: string;
  setTransportAmount: (v: string) => void;
  transportTouched: boolean;
  setTransportTouched: (v: boolean) => void;
  transportAmountValue: number;
  transportValidationError: string | null;
  onClearNotice: () => void;

  // Payment / workflow
  canCollectHere: boolean;
  canSendToCashier: boolean;
  activeCashSessionId: string | null;
  paymentMethod: string;
  setPaymentMethod: (v: string) => void;
  referenceNumber: string;
  setReferenceNumber: (v: string) => void;
  posContextMessages: PosContextMessages;

  // Checkout bar
  displayedTotalAmount: number;
  sendButtonRef: { current: HTMLButtonElement | null };
  onCompleteTicket: (target: "QUEUE" | "DIRECT") => void;
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
  paymentMethod,
  setPaymentMethod,
  referenceNumber,
  setReferenceNumber,
  posContextMessages,
  displayedTotalAmount,
  sendButtonRef,
  onCompleteTicket,
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
        <div className="hm-card-header-green flex items-center gap-2.5">
          <Check className="h-4 w-4" />
          <div>
            <h2 className="text-sm font-semibold leading-tight">Ticket actual</h2>
            <p className="text-[0.7rem] text-white/85">
              Orden: {order?.orderNumber ?? "preparando..."} · Estado: {orderStatusLabel}
            </p>
          </div>
        </div>

        <div className="min-h-0 flex-1 overflow-y-auto px-3 pb-3" data-testid="pos-ticket-lines">
          <div className="overflow-x-auto">
            <table className="hm-table min-w-[34rem] w-full">
              <thead>
                <tr>
                  <th>Producto</th>
                  <th>Precio</th>
                  <th>Cant.</th>
                  <th>Subtotal</th>
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
                        <div>{line.product?.name ?? line.productId}</div>
                        {Number(line.discountAmount) > 0 ? (
                          <div className="text-[0.65rem] font-medium text-[var(--color-text-muted)]">
                            Desc: -C$ {Number(line.discountAmount).toFixed(2)}
                          </div>
                        ) : null}
                      </td>
                      <td>C$ {Number(line.unitPrice).toFixed(2)}</td>
                      <td>
                        <div className="flex items-center gap-2">
                          <input
                            className={`w-20 rounded-lg border px-2 py-1 ${qtyError ? "border-[var(--color-danger-500)]" : "border-[var(--color-border)]"}`}
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
                      <td className="font-medium">C$ {Number(line.lineSubtotal).toFixed(2)}</td>
                      <td>
                        <Button
                          variant="danger"
                          size="sm"
                          disabled={lineUpdatingId === line.id || isSubmittingPayment}
                          data-testid={`pos-line-remove-${line.id}`}
                          onClick={() => removeLine(line.id)}
                          icon={<Trash2 className="h-3.5 w-3.5" />}
                        >
                          Quitar
                        </Button>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>

          {order && !hasTicketLines ? (
            <div className="rounded-lg border border-dashed border-[var(--color-border-strong)] bg-[var(--color-surface-muted)] p-5 text-center">
              <p className="text-sm font-semibold text-[var(--color-text)]">Ticket vacio</p>
              <p className="mt-1 text-xs text-[var(--color-text-muted)]">Agrega productos desde el catalogo rapido.</p>
            </div>
          ) : null}

          {/* Order totals */}
          <div className="mt-3 grid gap-1 text-sm">
            <div className="flex justify-between">
              <span>Subtotal</span>
              <strong>C$ {Number(order?.subtotal ?? 0).toFixed(2)}</strong>
            </div>
            <div className="flex justify-between">
              <span>Descuento</span>
              <strong>C$ {Number(order?.discountTotal ?? 0).toFixed(2)}</strong>
            </div>
            {Number(order?.taxTotal ?? 0) > 0 ? (
              <div className="flex justify-between text-[var(--color-text)]">
                <span>IVA</span>
                <strong>C$ {Number(order?.taxTotal ?? 0).toFixed(2)}</strong>
              </div>
            ) : null}
            {includeTransport && transportAmountValue > 0 ? (
              <div className="flex justify-between text-[var(--color-text)]">
                <span>Transporte</span>
                <strong>C$ {transportAmountValue.toFixed(2)}</strong>
              </div>
            ) : null}
          </div>

          {/* Transport toggle */}
          <label
            className={`mt-3 flex cursor-pointer select-none items-start gap-3 rounded-lg border p-3 transition-colors ${includeTransport ? "border-[var(--color-info-300)] bg-[var(--color-info-50)]" : "border-[var(--color-border)] bg-[var(--color-surface)]"}`}
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
              className="mt-0.5 h-4 w-4 rounded border-[var(--color-border)] text-[var(--color-info-600)] focus:ring-[var(--color-info-500)]"
              disabled={isBusy}
            />
            <span>
              <span className="block text-sm font-semibold text-[var(--color-text)]">Agregar transporte</span>
              <span className="block text-xs text-[var(--color-text-muted)]">Flete, envio o entrega a domicilio</span>
            </span>
          </label>

          {includeTransport ? (
            <div className="mt-2 space-y-1">
              <label className="block text-xs font-medium text-[var(--color-text-muted)]">Monto de transporte (C$)</label>
              <input
                className={`w-full rounded-lg border px-3 py-2 text-sm outline-none focus:ring-2 ${transportTouched && transportValidationError ? "border-[var(--color-danger-500)] focus:border-[var(--color-danger-500)] focus:ring-[var(--color-danger-100)]" : "border-[var(--color-border)] focus:border-[var(--color-info-500)] focus:ring-[var(--color-info-100)]"}`}
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

          {/* Payment method selector (shown only when direct collect is available) */}
          {canCollectHere && (
            <div className="mt-3 space-y-2">
              <label className="block text-xs font-medium text-[var(--color-text-muted)]">Método de pago</label>
              <select
                className="w-full rounded-lg border border-[var(--color-border)] px-3 py-2 text-sm"
                value={paymentMethod}
                onChange={(e) => {
                  setPaymentMethod(e.target.value);
                  setReferenceNumber("");
                }}
                disabled={isBusy}
                data-testid="pos-payment-method"
              >
                <option value="CASH">Efectivo</option>
                <option value="CARD">Tarjeta</option>
                <option value="TRANSFER">Transferencia</option>
              </select>
              {(paymentMethod === "CARD" || paymentMethod === "TRANSFER") && (
                <div>
                  <label className="block text-xs font-medium text-[var(--color-text-muted)]">
                    Número de referencia <span className="text-[var(--color-danger-600)]">*</span>
                  </label>
                  <input
                    className="mt-1 w-full rounded-lg border border-[var(--color-border)] px-3 py-2 text-sm outline-none focus:border-[var(--color-info-500)] focus:ring-2 focus:ring-[var(--color-info-100)]"
                    type="text"
                    value={referenceNumber}
                    onChange={(e) => setReferenceNumber(e.target.value)}
                    placeholder="Nro. de autorización / transacción"
                    disabled={isBusy}
                    data-testid="pos-reference-number"
                  />
                  {!referenceNumber.trim() && (
                    <p className="mt-1 text-xs text-[var(--color-danger-600)]">
                      Requerido para tarjeta y transferencia.
                    </p>
                  )}
                </div>
              )}
              {!activeCashSessionId && (
                <div className="rounded-lg border border-[var(--color-danger-200)] bg-[var(--color-danger-50)] p-3">
                  <p className="text-xs text-[var(--color-danger-600)] font-medium">
                    ⚠️ No hay sesión de caja abierta para registrar venta directa.
                  </p>
                  <p className="text-xs text-[var(--color-danger-500)] mt-1">
                    Abra una sesión de caja desde el módulo de caja para poder realizar ventas.
                  </p>
                  <a
                    href="/app/branch/cashier/payments"
                    className="inline-block mt-2 text-xs font-medium text-[var(--color-primary-600)] hover:underline"
                  >
                    → Ir al módulo de caja
                  </a>
                </div>
              )}
            </div>
          )}

          {/* Backend workflow messages */}
          {posContextMessages?.noCashBoxes ? (
            <div
              className="mt-3 rounded-lg border border-[var(--color-danger-200)] bg-[var(--color-danger-50)] p-3"
              data-testid="pos-no-cashboxes"
            >
              <p className="text-xs font-medium text-[var(--color-danger-600)]">
                ⚠️ {posContextMessages.noCashBoxes}
              </p>
              <p className="text-xs text-[var(--color-danger-500)] mt-1">
                Pide a un administrador que cree una caja física para esta sucursal (Cajas Físicas).
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

          {/* No-action warning when profile/config disallows all payment flows */}
          {!canSendToCashier && !canCollectHere ? (
            <div
              className="mt-3 rounded-lg border border-[var(--color-border)] bg-[var(--color-surface-alt)] p-3"
              data-testid="pos-no-actions"
            >
              <p className="text-xs text-[var(--color-text-secondary)]">
                Tu perfil o la configuración de esta sucursal no permite enviar a caja ni cobrar aquí.
                Contacta a un administrador para revisar permisos o la configuración de pagos.
              </p>
            </div>
          ) : null}
        </div>

          {/* Order notes */}
          {order && (
            <div className="mt-3">
              <label className="block text-xs font-medium text-[var(--color-text-muted)] mb-1">
                Notas / instrucciones
              </label>
              <textarea
                className="w-full rounded-lg border border-[var(--color-border)] px-3 py-2 text-sm outline-none resize-none focus:border-[var(--color-info-400)] focus:ring-2 focus:ring-[var(--color-info-100)]"
                rows={2}
                maxLength={1000}
                placeholder="Instrucciones especiales, nombre del cliente, referencias..."
                defaultValue={order.notes ?? ""}
                disabled={isBusy}
                data-testid="pos-order-notes"
                onBlur={(e) => onUpdateNotes(e.currentTarget.value)}
              />
            </div>
          )}

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
          onCompleteQueue={() => onCompleteTicket("QUEUE")}
          onCompleteDirect={() => onCompleteTicket("DIRECT")}
        />
      </Card>
    </div>
  );
}
