"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import type { Route } from "next";
import { useCashSessionStatus } from "@/lib/client/use-cash-session-status";
import { useOperationalPolling } from "@/lib/realtime/use-operational-polling";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { showToast } from "@/components/ui/toast";
import { mapPosErrorToSpanish, type ApiErrorPayload } from "@/lib/pos-ui";
import { apiFetch } from "@/lib/client/api";
import { PrintModal } from "@/components/print/print-modal";
import "@/styles/responsive.css";

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

export function CashierPayments({ branchId }: { branchId: string }) {
  const [orders, setOrders] = useState<PendingOrder[]>([]);
  const [selectedOrderId, setSelectedOrderId] = useState<string>("");
  const [method, setMethod] = useState("CASH");
  const [referenceNumber, setReferenceNumber] = useState("");
  const [message, setMessage] = useState<string>("");
  // FASE 3: el estado de la sesión de caja se lee en modo solo-lectura.
  // El control de apertura/cierre de caja vive ahora en la pantalla "Caja".
  const { state: cashSessionState, cashBoxLabel, operatorRequired, requiresCashBoxSelection } = useCashSessionStatus(branchId);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [isLoadingOrders, setIsLoadingOrders] = useState(true);
  const referenceRef = useRef<HTMLInputElement | null>(null);

  // ── Print Modal (FASE 3) ──
  const [printModalOrderId, setPrintModalOrderId] = useState<string | null>(null);
  const [printModalOrderNumber, setPrintModalOrderNumber] = useState<string>("");

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
        setMessage(mapPosErrorToSpanish({ payload: json, status: response.status, fallback: "No se pudo cargar la cola de cobro." }));
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
    intervalMs: 12_000,
    deps: [load],
    onError: () => {
      setIsLoadingOrders(false);
      setMessage("No se pudo cargar la cola de cobro.");
    },
  });

  const selected = useMemo(() => orders.find((order) => order.id === selectedOrderId), [orders, selectedOrderId]);

  const referenceRequired = method === "CARD" || method === "TRANSFER";

  const canSubmitPayment = Boolean(
    selected
    && cashSessionState.hasOpenSession
    && cashSessionState.cashSessionId
    && !isSubmitting
    && (!referenceRequired || referenceNumber.trim() !== ""),
  );

  /** Track recently-paid order IDs to prevent duplicate submissions from rapid clicks */
  const recentlyPaidRef = useRef<Set<string>>(new Set());

  const paySelected = useCallback(async () => {
    if (!selected || isSubmitting) return;

    // Double-payment guard: prevent submitting the same order within short timeframe
    if (recentlyPaidRef.current.has(selected.id)) {
      showToast("warning", "Esta orden ya se está procesando. Espera un momento.");
      return;
    }

    if (operatorRequired) {
      showToast("warning", "No puedes cobrar porque no eres operador de la sesión de caja activa. Pide al cajero que te asigne como operador.");
      return;
    }

    if (requiresCashBoxSelection) {
      showToast("warning", "Selecciona una caja fisica para continuar.");
      return;
    }

    if (!cashSessionState.hasOpenSession || !cashSessionState.cashSessionId) {
      if (cashSessionState.status === "AUTO_CLOSED_PENDING_REVIEW") {
        showToast("warning", "La caja fue cerrada automaticamente por horario y requiere revision. Abre una nueva caja para continuar.");
        return;
      }
      showToast("warning", "No puedes cobrar sin una sesión de caja abierta y válida.");
      return;
    }

    if (referenceRequired && !referenceNumber.trim()) {
      showToast("warning", "El método de pago seleccionado requiere un número de referencia. Ingresa el número antes de cobrar.");
      return;
    }

    const orderId = selected.id;
    let success = false;

    recentlyPaidRef.current.add(orderId);
    setIsSubmitting(true);
    setMessage("Registrando pago...");

    try {
      const response = await apiFetch("/api/cashier/payments", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          saleOrderId: orderId,
          cashSessionId: cashSessionState.cashSessionId,
          method,
          amount: Number(selected.grandTotal),
          referenceNumber: referenceNumber.trim() || null,
        }),
      });

      const json = (await response.json()) as ApiErrorPayload;

      if (!response.ok) {
        const apiMessage = mapPosErrorToSpanish({ payload: json, status: response.status, fallback: "No se pudo registrar el pago." });
        setMessage(apiMessage);
        showToast("error", apiMessage);
        return;
      }

      setMessage("Pago aplicado. Orden enviada al flujo de despacho. ✓");
      showToast("success", "Pago aplicado correctamente");
      setReferenceNumber("");

      // FASE 3: Mostrar modal de impresión post-pago
      if (selected) {
        setPrintModalOrderId(selected.id);
        setPrintModalOrderNumber(selected.orderNumber);
      }

      await load();
      referenceRef.current?.focus();
      success = true;
    } catch (error) {
      console.error("[CASHIER][paySelected]", error);
      const humanized = mapPosErrorToSpanish({ fallback: "No se pudo registrar el pago.", thrownError: error });
      setMessage(humanized);
      showToast("error", humanized);
    } finally {
      setIsSubmitting(false);
      // Clear the guard after a short delay so the same order can be retried if needed
      setTimeout(() => recentlyPaidRef.current.delete(orderId), 3000);
    }
  }, [cashSessionState, isSubmitting, load, method, operatorRequired, referenceNumber, referenceRequired, requiresCashBoxSelection, selected]);

  // Keep refs in sync so hotkey handler always reads latest values
  const canSubmitRef = useRef(canSubmitPayment);
  const isSubmittingRef = useRef(isSubmitting);
  useEffect(() => { canSubmitRef.current = canSubmitPayment; }, [canSubmitPayment]);
  useEffect(() => { isSubmittingRef.current = isSubmitting; }, [isSubmitting]);

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
      if (event.key === "Enter" && document.activeElement === referenceRef.current && canSubmitRef.current && !isSubmittingRef.current) {
        event.preventDefault();
        paySelected().catch(() => setMessage("No se pudo registrar el pago."));
      }
      if (event.key === "Escape") {
        setReferenceNumber("");
      }
    }

    window.addEventListener("keydown", handleHotkeys);
    return () => window.removeEventListener("keydown", handleHotkeys);
  }, [paySelected]);

  const transportAmt = selected ? Number(selected.transportAmount ?? 0) : 0;
  const subtotalAmt = selected ? Number(selected.subtotal ?? 0) : 0;

  return (
    <section className="space-y-4" data-testid="cashier-payments-root">
      <div className="flex flex-wrap items-center gap-3 rounded-lg border border-[var(--color-border)] bg-[var(--color-surface-alt)] px-4 py-2.5">
        <span className="text-[11px] font-semibold uppercase tracking-[0.06em] text-[var(--color-text-secondary)]">
          Estado de caja
        </span>
        {cashSessionState.hasOpenSession
          ? <Badge variant="success">ABIERTA</Badge>
          : cashSessionState.status === "RECONCILING"
            ? <Badge variant="warning">EN CONCILIACIÓN</Badge>
            : cashSessionState.status === "AUTO_CLOSED_PENDING_REVIEW"
              ? <Badge variant="warning">CIERRE AUTOMÁTICO PENDIENTE</Badge>
              : <Badge variant="warning">CERRADA</Badge>}
        <span className="text-xs tabular-nums text-[var(--color-text-secondary)]">
          {cashBoxLabel ?? "Sin caja asignada"}
          {cashSessionState.cashSessionId ? ` · ${cashSessionState.cashSessionId.slice(0, 8)}…` : ""}
        </span>
        {!cashSessionState.hasOpenSession ? (
          <Link
            href={"/app/branch/cash" as Route}
            className="text-xs font-semibold text-[var(--color-info-600)] underline hover:text-[var(--color-info-700)]"
          >
            Ir a Caja
          </Link>
        ) : null}
        <span className="ml-auto text-[11px] text-[var(--color-text-muted)]">
          F1 efectivo · F2 tarjeta · F3 transferencia
        </span>
      </div>

      {operatorRequired ? (
        <div className="rounded-lg border border-[var(--color-warning-200)] bg-[var(--color-warning-50)] px-4 py-3 text-sm text-[var(--color-warning-700)]">
          Hay una sesión de caja abierta pero <strong>no estás asignado como operador</strong>. Pide al cajero que te asigne para poder cobrar.
        </div>
      ) : requiresCashBoxSelection ? (
        <div className="rounded-lg border border-[var(--color-warning-200)] bg-[var(--color-warning-50)] px-4 py-3 text-sm text-[var(--color-warning-700)]">
          Selecciona una caja física para continuar.
        </div>
      ) : !cashSessionState.hasOpenSession ? (
        <div className="rounded-lg border border-[var(--color-warning-200)] bg-[var(--color-warning-50)] px-4 py-3 text-sm text-[var(--color-warning-700)]">
          La caja está cerrada. Debes abrir una sesión desde la pantalla{" "}
          <Link
            href={"/app/branch/cash" as Route}
            className="font-semibold text-[var(--color-info-600)] underline hover:text-[var(--color-info-700)]"
          >
            Caja
          </Link>{" "}
          antes de poder cobrar órdenes.
        </div>
      ) : null}

      <div className="grid gap-4 grid-cols-1 md:grid-cols-2 lg:grid-cols-[1fr_1.2fr_1fr]">
        <Card className="flex flex-col overflow-hidden rounded-lg" data-testid="cashier-order-list">
          <div className="border-b border-[var(--color-border)] px-4 py-3">
            <h2 className="text-sm font-semibold text-[var(--color-text)]">Órdenes para cobro</h2>
            <p className="text-xs text-[var(--color-text-muted)]">{orders.length} orden{orders.length !== 1 ? "es" : ""} pendiente{orders.length !== 1 ? "s" : ""}</p>
          </div>
          <ul className="max-h-[30rem] space-y-2 overflow-y-auto p-3">
            {isLoadingOrders ? (
              <li className="rounded-lg border border-[var(--color-border)] bg-[var(--color-surface-alt)] p-3 text-xs text-[var(--color-text-muted)]">
                Cargando órdenes pendientes…
              </li>
            ) : null}
            {!isLoadingOrders && orders.length === 0 ? (
              <li className="rounded-lg border border-[var(--color-border)] bg-[var(--color-surface-alt)] p-4 text-center text-xs text-[var(--color-text-muted)]">
                No hay órdenes pendientes de cobro.
              </li>
            ) : null}
            {orders.map((order) => (
              <li key={order.id}>
                <button
                  className={[
                    "w-full rounded-lg border p-3 text-left transition-colors",
                    selectedOrderId === order.id
                      ? "border-[var(--color-pay)] bg-[color-mix(in_srgb,var(--color-pay)_8%,transparent)] shadow-sm"
                      : "border-[var(--color-border)] hover:border-[var(--color-border-strong)] hover:bg-[var(--color-surface-alt)]",
                  ].join(" ")}
                  onClick={() => setSelectedOrderId(order.id)}
                  disabled={isSubmitting}
                  data-testid={`cashier-order-${order.id}`}
                >
                  <div className="flex items-center justify-between">
                    <span className="font-medium text-[var(--color-text)]">{order.orderNumber}</span>
                    {order.requiresTransport ? <Badge variant="warning">Transporte</Badge> : null}
                  </div>
                  <div className="mt-0.5 text-xs text-[var(--color-text-muted)]">
                    Total: <strong>C$ {Number(order.grandTotal).toFixed(2)}</strong>
                    {order.lines && <span className="ml-2">· {order.lines.length} producto{order.lines.length !== 1 ? "s" : ""}</span>}
                  </div>
                </button>
              </li>
            ))}
          </ul>
        </Card>

        <Card className="flex flex-col overflow-hidden rounded-lg" data-testid="cashier-order-detail">
          <div className="border-b border-[var(--color-border)] px-4 py-3">
            <h2 className="text-sm font-semibold text-[var(--color-text)]">Detalle de orden</h2>
            {selected && <p className="text-xs text-[var(--color-text-muted)]">{selected.orderNumber}</p>}
          </div>
          {selected && selected.lines ? (
            <div className="flex-1 overflow-y-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b bg-[var(--color-surface-muted)] text-left text-xs text-[var(--color-text-muted)]">
                    <th className="px-3 py-2">Producto</th>
                    <th className="px-2 py-2 text-right">Cant.</th>
                    <th className="px-2 py-2 text-right">P. Unit.</th>
                    <th className="px-3 py-2 text-right">Subtotal</th>
                  </tr>
                </thead>
                <tbody>
                  {selected.lines.map((line) => (
                    <tr key={line.id} className="border-b border-[var(--color-border)] transition-colors hover:bg-[var(--color-surface-alt)]">
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

              <div className="space-y-1 border-t border-[var(--color-border)] bg-[var(--color-surface-muted)] px-4 py-3 text-sm">
                <div className="flex justify-between">
                  <span className="text-[var(--color-text-muted)]">Subtotal productos</span>
                  <span className="font-mono font-medium">C$ {subtotalAmt.toFixed(2)}</span>
                </div>
                {transportAmt > 0 && (
                  <div className="flex justify-between text-[var(--color-info-600)]">
                    <span>Transporte</span>
                    <span className="font-mono font-medium">C$ {transportAmt.toFixed(2)}</span>
                  </div>
                )}
                <div className="mt-1 flex justify-between border-t border-[var(--color-border)] pt-1 text-base font-bold">
                  <span>Total a cobrar</span>
                  <span className="font-mono">C$ {Number(selected.grandTotal).toFixed(2)}</span>
                </div>
              </div>
            </div>
          ) : (
            <div className="flex flex-1 items-center justify-center p-6">
              <p className="text-center text-sm text-[var(--color-text-muted)]">Selecciona una orden para ver su detalle.</p>
            </div>
          )}
        </Card>

        <Card className="flex flex-col overflow-hidden rounded-lg" data-testid="cashier-payment-zone">
          <div className="border-b border-[var(--color-border)] px-4 py-3">
            <h2 className="text-sm font-semibold text-[var(--color-text)]">Cobro rápido</h2>
          </div>
          <div className="flex-1 space-y-4 p-4">
            {selected ? (
              <>
                <div className="space-y-1 rounded-lg bg-[var(--color-surface-muted)] p-3">
                  <div className="text-xs text-[var(--color-text-muted)]">Orden</div>
                  <div className="text-sm font-semibold text-[var(--color-text)]">{selected.orderNumber}</div>
                  <div className="mt-1 font-mono text-2xl font-bold text-[var(--color-pay)]">C$ {Number(selected.grandTotal).toFixed(2)}</div>
                  {transportAmt > 0 && <div className="text-xs text-[var(--color-text-muted)]">Incluye transporte: C$ {transportAmt.toFixed(2)}</div>}
                </div>

                <div className="grid gap-2">
                  <div className="text-xs font-medium text-[var(--color-text-muted)]">Método de pago</div>
                  <div className="flex gap-1 rounded-xl bg-[var(--color-surface-muted)] p-1">
                    {[
                      { code: "CASH", label: "Efectivo" },
                      { code: "CARD", label: "Tarjeta" },
                      { code: "TRANSFER", label: "Transfer." },
                    ].map((option) => (
                      <button
                        key={option.code}
                        onClick={() => setMethod(option.code)}
                        disabled={isSubmitting}
                        data-testid={`cashier-method-${option.code}`}
                        className={[
                          "flex flex-1 items-center justify-center rounded-lg py-2 text-sm font-medium transition-colors",
                          method === option.code
                            ? "bg-[var(--color-pay)] text-white shadow-sm"
                            : "text-[var(--color-text-secondary)] hover:bg-[var(--color-surface-alt)]",
                        ].join(" ")}
                      >
                        {option.label}
                      </button>
                    ))}
                  </div>
                </div>

                <div>
                  <label className="mb-1 block text-sm font-medium text-[var(--color-text-secondary)]">
                    Referencia
                    {referenceRequired
                      ? <span className="ml-1 text-[var(--color-danger-600)]">*</span>
                      : <span className="ml-1 text-[var(--color-text-soft)] font-normal">(opcional)</span>}
                  </label>
                  <Input
                    ref={referenceRef}
                    value={referenceNumber}
                    onChange={(event) => setReferenceNumber(event.target.value)}
                    placeholder={referenceRequired ? "Número de autorización / transacción (requerido)" : "Recibo / transacción"}
                    disabled={isSubmitting}
                    data-testid="cashier-reference-input"
                    className="rounded-lg"
                  />
                  {referenceRequired && !referenceNumber.trim() && (
                    <p className="mt-1 text-xs text-[var(--color-danger-600)]">
                      Este método de pago requiere número de referencia.
                    </p>
                  )}
                </div>

                <Button
                  variant="success"
                  onClick={paySelected}
                  disabled={!canSubmitPayment}
                  loading={isSubmitting}
                  data-testid="cashier-submit-payment"
                  className="w-full rounded-lg py-3 text-base"
                >
                  {isSubmitting ? "Procesando pago…" : `Cobrar C$ ${Number(selected.grandTotal).toFixed(2)}`}
                </Button>
              </>
            ) : (
              <div className="flex flex-1 items-center justify-center">
                <p className="text-center text-sm text-[var(--color-text-muted)]">Selecciona una orden para cobrar o espera nuevas órdenes.</p>
              </div>
            )}
          </div>
        </Card>
      </div>

      {message ? <p className="rounded-lg border border-[var(--color-border)] bg-[var(--color-surface-alt)] p-3 text-sm text-[var(--color-text-secondary)]" data-testid="cashier-message">{message}</p> : null}

      {/* FASE 3: Modal de impresión post-pago */}
      {printModalOrderId && (
        <PrintModal
          orderId={printModalOrderId}
          orderNumber={printModalOrderNumber}
          onClose={() => {
            setPrintModalOrderId(null);
            setPrintModalOrderNumber("");
          }}
        />
      )}
    </section>
  );
}
