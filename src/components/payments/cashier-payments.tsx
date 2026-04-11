"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { CashSessionPanel } from "@/components/cash-session/cash-session-panel";
import { measurePosMetric } from "@/lib/telemetry";
import { useOperationalPolling } from "@/lib/realtime/use-operational-polling";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { showToast } from "@/components/ui/toast";

type OrderLine = {
  id: string;
  productId: string;
  quantity: string;
  unitPrice: string;
  discountAmount: string;
  lineSubtotal: string;
  product?: { name?: string; sku?: string };
};

type PendingOrder = {
  id: string;
  orderNumber: string;
  status: string;
  subtotal: string;
  grandTotal: string;
  transportAmount: string;
  requiresTransport: boolean;
  branchId: string;
  lines: OrderLine[];
};

const PAYMENT_REASON_MESSAGES: Record<string, string> = {
  PAYMENT_INVALID_STATUS: "La orden ya no está disponible para pago.",
  PAYMENT_ALREADY_POSTED: "La orden ya tiene pago registrado.",
  INVALID_PAYMENT_AMOUNT: "Monto inválido. Verifica total y método.",
  NO_ACTIVE_CASH_BOX: "No hay caja física activa para esta sucursal.",
  NO_ACTIVE_CASH_SESSION: "Debes abrir sesión de caja antes de cobrar.",
  FORBIDDEN_ROLE: "Tu rol no tiene permiso para cobrar.",
  FORBIDDEN_BRANCH: "No tienes acceso a esta sucursal.",
  INSUFFICIENT_STOCK: "Stock insuficiente para completar el pago.",
  INSUFFICIENT_STOCK_AT_PAYMENT: "Stock insuficiente al momento de procesar el pago. Otro usuario pudo haber agotado el inventario.",
};

function mapPaymentMessage(message?: string, reason?: string) {
  if (reason && PAYMENT_REASON_MESSAGES[reason]) return PAYMENT_REASON_MESSAGES[reason];
  if (message && PAYMENT_REASON_MESSAGES[message]) return PAYMENT_REASON_MESSAGES[message];
  return message ?? "No se pudo registrar el pago.";
}

export function CashierPayments({ branchId }: { branchId: string }) {
  const [orders, setOrders] = useState<PendingOrder[]>([]);
  const [selectedOrderId, setSelectedOrderId] = useState<string>("");
  const [method, setMethod] = useState("CASH");
  const [referenceNumber, setReferenceNumber] = useState("");
  const [message, setMessage] = useState<string>("");
  const [hasOpenSession, setHasOpenSession] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [isLoadingOrders, setIsLoadingOrders] = useState(true);
  const referenceRef = useRef<HTMLInputElement | null>(null);

  const selectedOrderIdRef = useRef(selectedOrderId);
  useEffect(() => {
    selectedOrderIdRef.current = selectedOrderId;
  }, [selectedOrderId]);

  const hasLoadedOnceRef = useRef(false);

  const load = useCallback(async () => {
    if (!hasLoadedOnceRef.current) setIsLoadingOrders(true);

    try {
      const query = new URLSearchParams({ branchId });
      const response = await fetch(`/api/cashier/orders/pending-payment?${query.toString()}`);
      const json = (await response.json()) as { data: PendingOrder[]; message?: string; reason?: string };

      if (!response.ok) {
        setMessage(mapPaymentMessage(json.message, json.reason));
        return;
      }

      const nextOrders = json.data ?? [];
      setOrders(nextOrders);

      if (nextOrders.length === 0) {
        setSelectedOrderId("");
        return;
      }

      const currentSelected = selectedOrderIdRef.current;
      if (!currentSelected || !nextOrders.some((item) => item.id === currentSelected)) {
        setSelectedOrderId(nextOrders[0].id);
      }
    } finally {
      hasLoadedOnceRef.current = true;
      setIsLoadingOrders(false);
    }
  }, [branchId]);

  useOperationalPolling({
    task: load,
    intervalMs: 6000,
    deps: [load],
    onError: () => {
      setIsLoadingOrders(false);
      setMessage("No se pudo cargar la cola de cobro.");
    },
  });

  const selected = useMemo(() => orders.find((order) => order.id === selectedOrderId), [orders, selectedOrderId]);

  async function paySelected() {
    if (!selected || isSubmitting) return;
    if (!hasOpenSession) {
      showToast("warning", "No puedes cobrar sin sesión de caja abierta.");
      return;
    }

    const stopMetric = measurePosMetric("payment_latency", { orderId: selected.id, method });
    let success = false;
    setIsSubmitting(true);
    setMessage("Registrando pago...");

    const response = await fetch("/api/cashier/payments", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        saleOrderId: selected.id,
        method,
        amount: Number(selected.grandTotal),
        referenceNumber: referenceNumber.trim() || null,
      }),
    });

    const json = (await response.json()) as { message?: string; reason?: string };

    if (!response.ok) {
      setMessage(mapPaymentMessage(json.message, json.reason));
      showToast("error", mapPaymentMessage(json.message, json.reason));
      setIsSubmitting(false);
      stopMetric(false);
      return;
    }

    setMessage("Pago aplicado. Orden enviada a despacho pendiente.");
    showToast("success", "Pago aplicado correctamente");
    setReferenceNumber("");
    setIsSubmitting(false);
    await load();
    referenceRef.current?.focus();
    success = true;
    stopMetric(success);
  }

  useEffect(() => {
    function handleHotkeys(event: KeyboardEvent) {
      if (event.key === "F1") {
        event.preventDefault();
        setMethod("CASH");
      }
      if (event.key === "F2") {
        event.preventDefault();
        setMethod("CARD");
      }
      if (event.key === "F3") {
        event.preventDefault();
        setMethod("TRANSFER");
      }
      if (event.key === "Enter" && document.activeElement === referenceRef.current && selected && hasOpenSession) {
        event.preventDefault();
        paySelected().catch(() => setMessage("No se pudo registrar el pago."));
      }
      if (event.key === "Escape") {
        setReferenceNumber("");
      }
    }

    window.addEventListener("keydown", handleHotkeys);
    return () => window.removeEventListener("keydown", handleHotkeys);
  }, [selected, hasOpenSession, method, referenceNumber, isSubmitting]);

  const transportAmt = selected ? Number(selected.transportAmount ?? 0) : 0;
  const subtotalAmt = selected ? Number(selected.subtotal ?? 0) : 0;

  return (
    <section className="space-y-4" data-testid="cashier-payments-root">
      {/* ── Session panel & status bar ── */}
      <CashSessionPanel branchId={branchId} onStatusChange={setHasOpenSession} />

      <Card className="flex items-center gap-3 px-4 py-2.5 rounded-xl">
        <span className="text-sm text-[var(--color-text-secondary)]">Estado de sesión:</span>
        {hasOpenSession
          ? <Badge variant="success">ABIERTA</Badge>
          : <Badge variant="danger">CERRADA</Badge>
        }
        <span className="ml-auto text-xs text-[var(--color-text-soft)]">F1 efectivo · F2 tarjeta · F3 transferencia</span>
      </Card>

      {/* ── Main three-column layout ── */}
      <div className="grid gap-4 lg:grid-cols-[1fr_1.2fr_1fr]">
        {/* Order queue */}
        <Card className="flex flex-col overflow-hidden rounded-2xl" data-testid="cashier-order-list">
          <div className="border-b border-[var(--color-border)] px-4 py-3">
            <h2 className="text-sm font-semibold text-[var(--color-text)]">Órdenes para cobro</h2>
            <p className="text-xs text-[var(--color-text-muted)]">{orders.length} orden{orders.length !== 1 ? "es" : ""} pendiente{orders.length !== 1 ? "s" : ""}</p>
          </div>
          <ul className="max-h-[30rem] space-y-2 overflow-y-auto p-3">
            {isLoadingOrders ? (
              <li className="rounded-xl border border-[var(--color-border)] bg-[var(--color-surface-alt)] p-3 text-xs text-[var(--color-text-soft)]">Cargando órdenes pendientes…</li>
            ) : null}
            {!isLoadingOrders && orders.length === 0 ? (
              <li className="rounded-xl border border-[var(--color-border)] bg-[var(--color-surface-alt)] p-4 text-center text-xs text-[var(--color-text-soft)]">
                <div className="text-2xl mb-1"></div>
                No hay órdenes pendientes de cobro.
              </li>
            ) : null}
            {orders.map((order) => (
              <li key={order.id}>
                <button
                  className={`w-full rounded-xl border p-3 text-left transition-all duration-150 ${
                    selectedOrderId === order.id
                      ? "border-[var(--color-success-600)] bg-[var(--color-success-50)] shadow-sm"
                      : "border-[var(--color-border)] hover:bg-[var(--color-surface-alt)] hover:border-[var(--color-border-strong)]"
                  }`}
                  onClick={() => setSelectedOrderId(order.id)}
                  disabled={isSubmitting}
                  data-testid={`cashier-order-${order.id}`}
                >
                  <div className="flex items-center justify-between">
                    <span className="font-medium text-[var(--color-text)]">{order.orderNumber}</span>
                    {order.requiresTransport && <span className="text-xs" title="Incluye transporte"></span>}
                  </div>
                  <div className="text-xs text-[var(--color-text-muted)] mt-0.5">
                    Total: <strong>C$ {Number(order.grandTotal).toFixed(2)}</strong>
                    {order.lines && <span className="ml-2">· {order.lines.length} producto{order.lines.length !== 1 ? "s" : ""}</span>}
                  </div>
                </button>
              </li>
            ))}
          </ul>
        </Card>

        {/* Order detail panel */}
        <Card className="flex flex-col overflow-hidden rounded-2xl" data-testid="cashier-order-detail">
          <div className="border-b border-[var(--color-border)] px-4 py-3">
            <h2 className="text-sm font-semibold text-[var(--color-text)]">Detalle de orden</h2>
            {selected && <p className="text-xs text-[var(--color-text-muted)]">{selected.orderNumber}</p>}
          </div>
          {selected && selected.lines ? (
            <div className="flex-1 overflow-y-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b text-left text-xs text-[var(--color-text-muted)] bg-[var(--color-surface-muted)]">
                    <th className="px-3 py-2">Producto</th>
                    <th className="px-2 py-2 text-right">Cant.</th>
                    <th className="px-2 py-2 text-right">P. Unit.</th>
                    <th className="px-3 py-2 text-right">Subtotal</th>
                  </tr>
                </thead>
                <tbody>
                  {selected.lines.map((line) => (
                    <tr key={line.id} className="border-b border-[var(--color-border)] hover:bg-[var(--color-surface-alt)] transition-colors">
                      <td className="px-3 py-2">
                        <div className="font-medium text-[var(--color-text)]">{line.product?.name ?? "—"}</div>
                        {line.product?.sku && <div className="text-[0.65rem] text-[var(--color-text-soft)]">SKU: {line.product.sku}</div>}
                      </td>
                      <td className="px-2 py-2 text-right font-mono text-xs">{Number(line.quantity).toFixed(2)}</td>
                      <td className="px-2 py-2 text-right font-mono text-xs">C$ {Number(line.unitPrice).toFixed(2)}</td>
                      <td className="px-3 py-2 text-right font-mono text-xs font-semibold">C$ {Number(line.lineSubtotal).toFixed(2)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>

              {/* Totals breakdown */}
              <div className="border-t border-[var(--color-border)] bg-[var(--color-surface-muted)] px-4 py-3 space-y-1 text-sm">
                <div className="flex justify-between">
                  <span className="text-[var(--color-text-muted)]">Subtotal productos</span>
                  <span className="font-mono font-medium">C$ {subtotalAmt.toFixed(2)}</span>
                </div>
                {transportAmt > 0 && (
                  <div className="flex justify-between text-[var(--color-primary-700)]">
                    <span>Transporte</span>
                    <span className="font-mono font-medium">C$ {transportAmt.toFixed(2)}</span>
                  </div>
                )}
                <div className="flex justify-between text-base font-bold border-t border-[var(--color-border)] pt-1 mt-1">
                  <span>Total a cobrar</span>
                  <span className="font-mono">C$ {Number(selected.grandTotal).toFixed(2)}</span>
                </div>
              </div>
            </div>
          ) : (
            <div className="flex-1 flex items-center justify-center p-6">
              <p className="text-sm text-[var(--color-text-muted)] text-center">
                <span className="text-3xl block mb-2"></span>
                Selecciona una orden para ver su detalle.
              </p>
            </div>
          )}
        </Card>

        {/* Quick-pay panel */}
        <Card className="flex flex-col overflow-hidden rounded-2xl" data-testid="cashier-payment-zone">
          <div className="border-b border-[var(--color-border)] px-4 py-3">
            <h2 className="text-sm font-semibold text-[var(--color-text)]">Cobro rápido</h2>
          </div>
          <div className="flex-1 space-y-4 p-4">
          {selected ? (
            <>
              <div className="rounded-xl bg-[var(--color-surface-muted)] p-3 space-y-1">
                <div className="text-xs text-[var(--color-text-muted)]">Orden</div>
                <div className="text-sm font-semibold text-[var(--color-text)]">{selected.orderNumber}</div>
                <div className="text-2xl font-bold text-[var(--color-success-700)] font-mono mt-1">C$ {Number(selected.grandTotal).toFixed(2)}</div>
                {transportAmt > 0 && (
                  <div className="text-xs text-[var(--color-text-muted)]">Incluye transporte: C$ {transportAmt.toFixed(2)}</div>
                )}
              </div>

              <div className="grid gap-2">
                <div className="text-xs font-medium text-[var(--color-text-muted)]">Método de pago</div>
                <div className="grid grid-cols-3 gap-2">
                  {[
                    { code: "CASH", label: "Efectivo", icon: "" },
                    { code: "CARD", label: "Tarjeta", icon: "" },
                    { code: "TRANSFER", label: "Transfer.", icon: "" },
                  ].map((option) => (
                    <Button
                      key={option.code}
                      variant={method === option.code ? "primary" : "secondary"}
                      size="sm"
                      onClick={() => setMethod(option.code)}
                      disabled={isSubmitting}
                      data-testid={`cashier-method-${option.code}`}
                      className="rounded-xl"
                    >
                      <span className="mr-1">{option.icon}</span> {option.label}
                    </Button>
                  ))}
                </div>
              </div>

              <div>
                <label className="block text-sm font-medium text-[var(--color-text-secondary)] mb-1">Referencia (opcional)</label>
                <Input
                  ref={referenceRef}
                  value={referenceNumber}
                  onChange={(event) => setReferenceNumber(event.target.value)}
                  placeholder="Recibo / transacción"
                  disabled={isSubmitting}
                  data-testid="cashier-reference-input"
                  className="rounded-xl"
                />
              </div>

              <Button
                variant="success"
                onClick={paySelected}
                disabled={!hasOpenSession || isSubmitting}
                loading={isSubmitting}
                data-testid="cashier-submit-payment"
                className="w-full rounded-xl text-base py-3"
              >
                {isSubmitting ? "Procesando pago…" : `Cobrar C$ ${Number(selected.grandTotal).toFixed(2)}`}
              </Button>
            </>
          ) : (
            <div className="flex-1 flex items-center justify-center">
              <p className="text-sm text-[var(--color-text-muted)] text-center">
                <span className="text-3xl block mb-2"></span>
                Selecciona una orden para cobrar o espera nuevas órdenes.
              </p>
            </div>
          )}
          </div>
        </Card>
      </div>

      {message ? <p className="rounded-xl border border-[var(--color-border)] bg-[var(--color-surface-alt)] p-3 text-sm text-[var(--color-text-secondary)]" data-testid="cashier-message">{message}</p> : null}
    </section>
  );
}
