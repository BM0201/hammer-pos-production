"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { useOperationalPolling } from "@/lib/realtime/use-operational-polling";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { mapDispatchStatusToSpanish, mapDispatchStatusVariant, mapPosErrorToSpanish, type ApiErrorPayload } from "@/lib/pos-ui";
import { apiFetch, unwrapApiData } from "@/lib/client/api";

type DispatchOrder = {
  id: string;
  orderNumber: string;
  status: string;
  grandTotal: string;
  requiresTransport?: boolean;
  branch: { code: string; name: string };
  transportServices?: Array<{
    id: string;
    customerName: string;
    price: string;
    status: "PENDING" | "ASSIGNED" | "IN_TRANSIT" | "DELIVERED" | "CANCELLED" | "FAILED";
    reference?: string | null;
    scheduledPaymentTime?: string | null;
  }>;
  createdAt?: string;
};

type DispatchTicket = {
  id: string;
  saleOrder: {
    orderNumber: string;
    grandTotal?: string;
    requiresTransport?: boolean;
    transportServices?: Array<{
      id: string;
      customerName: string;
      status: "PENDING" | "ASSIGNED" | "IN_TRANSIT" | "DELIVERED" | "CANCELLED" | "FAILED";
    }>;
  };
  branch: { code: string };
  dispatchedAt: string | null;
};

export function DispatchWorkspace({ branchId }: { branchId: string }) {
  const [pending, setPending] = useState<DispatchOrder[]>([]);
  const [history, setHistory] = useState<DispatchTicket[]>([]);
  const [message, setMessage] = useState("");
  const [busyOrderId, setBusyOrderId] = useState<string | null>(null);
  const [transportBusy, setTransportBusy] = useState(false);
  const [transportCustomerName, setTransportCustomerName] = useState("");
  const [transportPrice, setTransportPrice] = useState("");
  const [transportReference, setTransportReference] = useState("");
  const [transportPaymentTime, setTransportPaymentTime] = useState("");
  const [transportNotes, setTransportNotes] = useState("");
  const [selectedTransportOrderId, setSelectedTransportOrderId] = useState<string | null>(null);

  const recentIds = useMemo(() => new Set(history.slice(0, 5).map((item) => item.saleOrder.orderNumber)), [history]);
  const transportOrders = useMemo(
    () => pending.filter((order) => order.requiresTransport),
    [pending],
  );
  const selectedTransportOrder = useMemo(
    () => transportOrders.find((item) => item.id === selectedTransportOrderId) ?? null,
    [transportOrders, selectedTransportOrderId],
  );

  useEffect(() => {
    if (transportOrders.length === 0) {
      setSelectedTransportOrderId(null);
      return;
    }

    if (!selectedTransportOrderId || !transportOrders.some((item) => item.id === selectedTransportOrderId)) {
      setSelectedTransportOrderId(transportOrders[0].id);
    }
  }, [transportOrders, selectedTransportOrderId]);

  const load = useCallback(async () => {
    const query = new URLSearchParams({ branchId });
    const [pendingResponse, historyResponse] = await Promise.all([
      fetch(`/api/warehouse/dispatch/pending?${query.toString()}`),
      fetch(`/api/warehouse/dispatch/history?${query.toString()}`),
    ]);

    const pendingRaw = await pendingResponse.json();
    const historyRaw = await historyResponse.json();

    if (!pendingResponse.ok) {
      setMessage(mapPosErrorToSpanish({ payload: pendingRaw as ApiErrorPayload, status: pendingResponse.status, fallback: "No se pudo completar el despacho." }));
      return;
    }

    if (!historyResponse.ok) {
      setMessage(mapPosErrorToSpanish({ payload: historyRaw as ApiErrorPayload, status: historyResponse.status, fallback: "No se pudo cargar el historial de despacho." }));
      return;
    }

    const pendingData = unwrapApiData(pendingRaw);
    const historyData = unwrapApiData(historyRaw);
    setPending(Array.isArray(pendingData) ? pendingData : []);
    setHistory(Array.isArray(historyData) ? historyData : []);
  }, [branchId]);

  useOperationalPolling({
    task: load,
    intervalMs: 15_000,
    deps: [load],
    onError: () => setMessage("No se pudo cargar la mesa de despacho."),
  });

  useEffect(() => {
    function onKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") setMessage("");
    }

    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, []);

  async function markDispatched(orderId: string) {
    if (busyOrderId) return;

    setBusyOrderId(orderId);
    const response = await apiFetch(`/api/warehouse/dispatch/${orderId}/dispatch`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ notes: "Despachado desde mesa operativa" }),
    });
    const json = (await response.json()) as ApiErrorPayload & { status?: string };

    if (!response.ok) {
      setMessage(mapPosErrorToSpanish({ payload: json, status: response.status, fallback: "No se pudo completar el despacho." }));
      setBusyOrderId(null);
      return;
    }

    if (json.status === "REQUESTED") {
      setMessage("Solicitud enviada.");
      setBusyOrderId(null);
      return;
    }

    setMessage("Despacho registrado correctamente.");
    setBusyOrderId(null);
    await load();
  }

  function resetTransportForm() {
    setTransportCustomerName("");
    setTransportPrice("");
    setTransportReference("");
    setTransportPaymentTime("");
    setTransportNotes("");
  }

  async function registerTransport(order: DispatchOrder) {
    if (!transportCustomerName.trim()) {
      setMessage("El nombre del cliente es obligatorio para registrar transporte.");
      return;
    }
    if (!transportPrice.trim() || Number.isNaN(Number(transportPrice)) || Number(transportPrice) <= 0) {
      setMessage("El precio del transporte debe ser mayor a 0.");
      return;
    }

    setTransportBusy(true);
    const response = await apiFetch("/api/transport", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        saleOrderId: order.id,
        branchId,
        customerName: transportCustomerName.trim(),
        price: Number(transportPrice),
        reference: transportReference.trim() || null,
        scheduledPaymentTime: transportPaymentTime || null,
        notes: transportNotes.trim() || null,
      }),
    });
    const json = (await response.json()) as ApiErrorPayload;

    if (!response.ok) {
      setMessage(mapPosErrorToSpanish({ payload: json, status: response.status, fallback: "No se pudo registrar el servicio de transporte." }));
      setTransportBusy(false);
      return;
    }

    resetTransportForm();
    setMessage(`Servicio de transporte registrado para ${order.orderNumber}.`);
    await load();
    setTransportBusy(false);
  }

  async function changeTransportStatus(transportId: string, status: "IN_TRANSIT" | "DELIVERED") {
    setTransportBusy(true);
    const response = await apiFetch(`/api/transport/${transportId}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ status }),
    });
    const json = (await response.json()) as ApiErrorPayload;

    if (!response.ok) {
      setMessage(mapPosErrorToSpanish({ payload: json, status: response.status, fallback: "No se pudo actualizar el estado del transporte." }));
      setTransportBusy(false);
      return;
    }

    setMessage(status === "DELIVERED" ? "Transporte marcado como entregado." : "Transporte en tránsito.");
    await load();
    setTransportBusy(false);
  }

  return (
    <section className="space-y-4" data-testid="dispatch-root">
      <div className="rounded-lg border border-[var(--color-border)] p-3 text-sm text-[var(--color-text-secondary)]">
        <div><strong>Sucursal:</strong> {branchId}</div>
        <div><strong>Cola operativa:</strong> solo pendientes de despacho</div>
        <div><strong>Actualización:</strong> automática cada ~6 segundos</div>
      </div>

      <div className="grid gap-4 lg:grid-cols-[1.25fr_1fr]">
        <div className="rounded-lg border border-[var(--color-border)] p-3">
          <h2 className="mb-2 font-semibold">Cola de despacho</h2>
          <ul className="max-h-[28rem] space-y-2 overflow-y-auto pr-1" data-testid="dispatch-pending-list">
            {pending.map((order) => (
              <li key={order.id} className="rounded-lg border border-[var(--color-border)] p-3">
                <div className="flex items-center justify-between">
                  <div className="font-medium">{order.orderNumber}</div>
                  <span className="text-xs text-[var(--color-text-soft)]">{order.branch.code}</span>
                </div>
                <div className="text-xs text-[var(--color-text-muted)]">Estado: {mapDispatchStatusToSpanish(order.status)} · Total: C$ {Number(order.grandTotal).toFixed(2)}</div>
                <Button
                  variant="success"
                  size="sm"
                  className="mt-2"
                  onClick={() => markDispatched(order.id)}
                  data-testid={`dispatch-action-${order.id}`}
                  disabled={busyOrderId === order.id || Boolean(busyOrderId)}
                >
                  {busyOrderId === order.id ? "Despachando..." : "Marcar despachado"}
                </Button>
              </li>
            ))}
          </ul>
        </div>

        <div className="rounded-lg border border-[var(--color-border)] p-3">
          <h2 className="mb-2 font-semibold">Despachados recientes</h2>
          <ul className="max-h-[28rem] space-y-2 overflow-y-auto text-sm pr-1" data-testid="dispatch-history-list">
            {history.map((ticket) => (
              <li key={ticket.id} className={`rounded border p-3 ${recentIds.has(ticket.saleOrder.orderNumber) ? "border-[var(--color-success-200)] bg-[var(--color-success-50)]" : ""}`}>
                <div className="font-medium">{ticket.saleOrder.orderNumber}</div>
                <div className="text-xs text-[var(--color-text-muted)]">{ticket.branch.code} · {ticket.dispatchedAt ? new Date(ticket.dispatchedAt).toLocaleString() : "Sin fecha"}</div>
                {ticket.saleOrder.requiresTransport ? (
                  <div className="mt-1 flex items-center gap-2 text-xs text-[var(--color-text-muted)]">
                    <span>Transporte:</span>
                    <Badge variant={mapDispatchStatusVariant(ticket.saleOrder.transportServices?.[0]?.status)}>
                      {mapDispatchStatusToSpanish(ticket.saleOrder.transportServices?.[0]?.status)}
                    </Badge>
                  </div>
                ) : null}
              </li>
            ))}
          </ul>
        </div>
      </div>

      <Card className="space-y-3 p-4" data-testid="dispatch-transport-zone">
        <div className="flex items-center justify-between">
          <h2 className="font-semibold">Órdenes que requieren transporte</h2>
          <span className="text-xs text-[var(--color-text-muted)]">{transportOrders.length} pendientes</span>
        </div>

        {transportOrders.length === 0 ? (
          <p className="text-sm text-[var(--color-text-muted)]">No hay órdenes pendientes con transporte requerido.</p>
        ) : (
          <div className="grid gap-4 lg:grid-cols-[1.1fr_1fr]">
            <ul className="space-y-2 max-h-72 overflow-y-auto pr-1">
              {transportOrders.map((order) => {
                const transport = order.transportServices?.[0];
                const isSelected = selectedTransportOrderId === order.id;

                return (
                  <li key={order.id}>
                    <button
                      type="button"
                      className={`w-full rounded-lg border px-3 py-2 text-left transition-colors ${isSelected ? "border-[var(--color-info-500)] bg-[var(--color-info-50)]" : "border-[var(--color-border)] hover:bg-[var(--color-surface-alt)]"}`}
                      onClick={() => setSelectedTransportOrderId(order.id)}
                    >
                      <div className="flex items-center justify-between">
                        <span className="text-sm font-medium text-[var(--color-text)]">{order.orderNumber}</span>
                        <Badge variant={mapDispatchStatusVariant(transport?.status)} className="text-[0.65rem]">
                          {mapDispatchStatusToSpanish(transport?.status)}
                        </Badge>
                      </div>
                      <p className="text-xs text-[var(--color-text-muted)]">Total orden: C$ {Number(order.grandTotal ?? 0).toFixed(2)}</p>
                    </button>
                  </li>
                );
              })}
            </ul>

            {selectedTransportOrder ? (
              <div className="rounded-lg border border-[var(--color-border)] bg-[var(--color-surface-muted)] p-4 space-y-3">
                <div>
                  <p className="text-sm font-semibold text-[var(--color-text)]">Gestión de transporte · {selectedTransportOrder.orderNumber}</p>
                  <p className="text-xs text-[var(--color-text-muted)]">Completa el registro operativo desde Despacho.</p>
                </div>

                {!selectedTransportOrder.transportServices?.[0] ? (
                  <div className="space-y-2">
                    <Input
                      label="Nombre del cliente"
                      placeholder="Nombre del cliente"
                      value={transportCustomerName}
                      onChange={(event) => setTransportCustomerName(event.target.value)}
                      disabled={transportBusy}
                    />
                    <Input
                      label="Precio del transporte"
                      type="number"
                      min="0"
                      step="0.01"
                      placeholder="Precio del transporte"
                      value={transportPrice}
                      onChange={(event) => setTransportPrice(event.target.value)}
                      disabled={transportBusy}
                    />
                    <Input
                      label="Referencia (opcional)"
                      placeholder="Referencia (opcional)"
                      value={transportReference}
                      onChange={(event) => setTransportReference(event.target.value)}
                      disabled={transportBusy}
                    />
                    <Input
                      label="Hora de pago (opcional)"
                      type="datetime-local"
                      value={transportPaymentTime}
                      onChange={(event) => setTransportPaymentTime(event.target.value)}
                      disabled={transportBusy}
                    />
                    <Input
                      label="Notas (opcional)"
                      placeholder="Notas (opcional)"
                      value={transportNotes}
                      onChange={(event) => setTransportNotes(event.target.value)}
                      disabled={transportBusy}
                    />
                    <Button
                      variant="primary"
                      className="w-full justify-center"
                      onClick={() => registerTransport(selectedTransportOrder)}
                      loading={transportBusy}
                    >
                      {transportBusy ? "Registrando..." : "Registrar transporte"}
                    </Button>
                  </div>
                ) : (
                  <div className="space-y-2">
                    <p className="text-sm text-[var(--color-text)]">Cliente: <strong>{selectedTransportOrder.transportServices[0].customerName}</strong></p>
                    <div className="flex items-center gap-2 text-xs text-[var(--color-text-muted)]">
                      <span>Estado actual:</span>
                      <Badge variant={mapDispatchStatusVariant(selectedTransportOrder.transportServices[0].status)}>
                        {mapDispatchStatusToSpanish(selectedTransportOrder.transportServices[0].status)}
                      </Badge>
                    </div>
                    <div className="flex gap-2">
                      <Button
                        variant="secondary"
                        size="sm"
                        onClick={() => changeTransportStatus(selectedTransportOrder.transportServices![0].id, "IN_TRANSIT")}
                        disabled={transportBusy || selectedTransportOrder.transportServices[0].status === "IN_TRANSIT" || selectedTransportOrder.transportServices[0].status === "DELIVERED"}
                      >
                        Marcar en tránsito
                      </Button>
                      <Button
                        variant="success"
                        size="sm"
                        onClick={() => changeTransportStatus(selectedTransportOrder.transportServices![0].id, "DELIVERED")}
                        disabled={transportBusy || selectedTransportOrder.transportServices[0].status === "DELIVERED"}
                      >
                        Marcar entregado
                      </Button>
                    </div>
                  </div>
                )}
              </div>
            ) : null}
          </div>
        )}
      </Card>

      {message ? <p className="text-sm text-[var(--color-text-secondary)]" data-testid="dispatch-message">{message}</p> : null}
    </section>
  );
}
