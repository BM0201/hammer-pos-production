"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import toast from "react-hot-toast";
import { mapPosErrorToSpanish, type ApiErrorPayload } from "@/lib/pos-ui";
import { apiFetch } from "@/lib/client/api";
import type { TicketLine, TicketOrder } from "../types";

type PrintableOrder = { id: string; orderNumber: string };

type PosCheckoutOpts = {
  order: TicketOrder | null;
  ticketLines: TicketLine[];
  reloadOrder: () => Promise<void>;
  canSendToCashier: boolean;
  canCollectHere: boolean;
  activeCashSessionId: string | null;
  paymentMethod: string;
  /** Only `enableDispatch` is read — structurally compatible with the full BranchConfig. */
  branchConfig: { enableDispatch: boolean } | null;
  loadRealtimeSummary: () => Promise<void>;
  autoPrintCompletedOrder: (order: PrintableOrder) => Promise<void>;
  setPrintModalOrderId: (id: string | null) => void;
  setPrintModalOrderNumber: (num: string) => void;
  onNotice: (msg: string, ms?: number) => void;
  /** Called after a successful checkout: reset catalog search and focus the search input. */
  onCompleted: () => void;
};

export function usePosCheckout(opts: PosCheckoutOpts) {
  // Mirror opts into a ref so completeTicket is always reading the latest
  // external state without capturing stale closures.
  const optsRef = useRef(opts);
  useEffect(() => { optsRef.current = opts; });

  const [isSubmittingPayment, setIsSubmittingPayment] = useState(false);
  const [includeTransport, setIncludeTransport] = useState(false);
  const [transportAmount, setTransportAmount] = useState("");
  const [transportTouched, setTransportTouched] = useState(false);
  const [referenceNumber, setReferenceNumber] = useState("");

  const transportAmountNumber = Number(transportAmount);
  const transportAmountValue =
    includeTransport && Number.isFinite(transportAmountNumber) && transportAmountNumber > 0
      ? transportAmountNumber
      : 0;

  const transportValidationError = useMemo(() => {
    if (!includeTransport) return null;
    if (!transportAmount.trim()) return "El transporte está activado, pero falta el monto.";
    const parsed = Number(transportAmount);
    if (!Number.isFinite(parsed) || parsed <= 0) {
      return "El monto de transporte debe ser un número mayor que 0.";
    }
    return null;
  }, [includeTransport, transportAmount]);

  async function completeTicket(target: "QUEUE" | "DIRECT") {
    const {
      order,
      ticketLines,
      reloadOrder,
      canSendToCashier,
      canCollectHere,
      activeCashSessionId,
      paymentMethod,
      branchConfig,
      loadRealtimeSummary,
      autoPrintCompletedOrder,
      setPrintModalOrderId,
      setPrintModalOrderNumber,
      onNotice,
      onCompleted,
    } = optsRef.current;

    if (!order || isSubmittingPayment || ticketLines.length === 0) return;

    if (includeTransport && transportValidationError) {
      setTransportTouched(true);
      onNotice(transportValidationError, 10000);
      return;
    }

    const isDirectSale = target === "DIRECT";

    if (!isDirectSale && !canSendToCashier) {
      onNotice("Tu perfil o la configuracion de la sucursal no permite enviar ventas a caja.", 10000);
      return;
    }

    if (isDirectSale && !canCollectHere) {
      onNotice("Tu perfil o la configuracion de la sucursal no permite cobrar aqui.", 10000);
      return;
    }

    if (isDirectSale && !activeCashSessionId) {
      onNotice("No hay sesión de caja abierta para registrar venta directa. Abra una sesión de caja primero.", 10000);
      return;
    }

    if (isDirectSale && paymentMethod === "CREDIT") {
      onNotice("Credito no disponible en venta directa: usa caja o selecciona otro metodo de pago.", 10000);
      return;
    }

    if (isDirectSale && (paymentMethod === "CARD" || paymentMethod === "TRANSFER") && !referenceNumber.trim()) {
      onNotice("El método de pago seleccionado requiere un número de referencia. Ingresa el número antes de cobrar.", 10000);
      return;
    }

    setIsSubmittingPayment(true);

    try {
      if (isDirectSale) {
        const body: Record<string, unknown> = {
          cashSessionId: activeCashSessionId,
          method: paymentMethod,
          requiresTransport: includeTransport,
        };
        if (includeTransport) body.transportAmount = transportAmountValue;
        if (referenceNumber.trim()) body.referenceNumber = referenceNumber.trim();

        const response = await apiFetch(`/api/sales/orders/${order.id}/direct-sale`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(body),
        });
        const json = (await response.json()) as ApiErrorPayload;

        if (!response.ok) {
          const errorCode =
            (json as Record<string, unknown>)?.error &&
            typeof (json as Record<string, unknown>).error === "object"
              ? ((json as Record<string, { code?: string }>).error?.code ?? "")
              : "";
          if (errorCode === "CASHIER_MODULE_ENABLED") {
            onNotice("El módulo de caja está activo. Use el flujo estándar de enviar a caja.", 10000);
          } else if (errorCode === "NO_ACTIVE_CASH_SESSION") {
            onNotice("No hay sesión de caja abierta para registrar venta directa.", 10000);
          } else {
            onNotice(
              mapPosErrorToSpanish({ payload: json, status: response.status, fallback: "No se pudo registrar la venta directa." }),
              10000,
            );
          }
          return;
        }

        const completionMsg =
          branchConfig?.enableDispatch === false
            ? "Venta completada y marcada como entregada automáticamente. ✓"
            : "Venta completada. Pendiente de despacho. ✓";
        onNotice(completionMsg);
        toast.success(completionMsg);
        await autoPrintCompletedOrder(order);
        setPrintModalOrderId(order.id);
        setPrintModalOrderNumber(order.orderNumber);
      } else {
        const body: Record<string, unknown> = { requiresTransport: includeTransport };
        if (includeTransport) body.transportAmount = transportAmountValue;

        const response = await apiFetch(`/api/sales/orders/${order.id}/submit`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(body),
        });
        const json = (await response.json()) as ApiErrorPayload;

        if (!response.ok) {
          onNotice(
            mapPosErrorToSpanish({ payload: json, status: response.status, fallback: "No se pudo enviar la orden a caja." }),
            10000,
          );
          return;
        }

        onNotice(
          includeTransport
            ? "Orden enviada a caja con transporte incluido. ✓"
            : "Orden enviada a caja: pendiente de pago. ✓",
        );
      }

      setIncludeTransport(false);
      setTransportAmount("");
      setTransportTouched(false);
      setReferenceNumber("");
      await reloadOrder();
      await loadRealtimeSummary();
      onCompleted();
    } catch (error) {
      console.error("[POS][completeTicket]", error);
      onNotice(
        mapPosErrorToSpanish({ fallback: "No se pudo completar la operación.", thrownError: error }),
        10000,
      );
    } finally {
      setIsSubmittingPayment(false);
    }
  }

  return {
    isSubmittingPayment,
    includeTransport,
    setIncludeTransport,
    transportAmount,
    setTransportAmount,
    transportTouched,
    setTransportTouched,
    transportAmountValue,
    transportValidationError,
    referenceNumber,
    setReferenceNumber,
    completeTicket,
  };
}
