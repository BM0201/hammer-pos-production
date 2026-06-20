"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { mapPosErrorToSpanish, type ApiErrorPayload } from "@/lib/pos-ui";
import { apiFetch } from "@/lib/client/api";
import type { ProductRow, TicketLine, TicketOrder } from "../types";

const MAX_REASONABLE_QUANTITY = 9999;

type PosOrderOpts = {
  fetchStockForProduct: (productId: string) => Promise<number>;
  stockByProductId: Record<string, number>;
  onNotice: (msg: string, ms?: number) => void;
  onProductAdded?: () => void;
};

export function usePosOrder(branchId: string, opts: PosOrderOpts) {
  // Mirror opts into a ref so all callbacks stay stable (dep: branchId only)
  // while always reading the latest values of opts fields.
  const optsRef = useRef(opts);
  useEffect(() => { optsRef.current = opts; });

  const [order, setOrder] = useState<TicketOrder | null>(null);
  const [isInitialLoading, setIsInitialLoading] = useState(true);
  const [isMutatingOrder, setIsMutatingOrder] = useState(false);
  const [lineDraftQuantities, setLineDraftQuantities] = useState<Record<string, string>>({});
  const [lineQuantityErrors, setLineQuantityErrors] = useState<Record<string, string>>({});
  const [lineUpdatingId, setLineUpdatingId] = useState<string | null>(null);

  const ticketLines = useMemo(() => order?.lines ?? [], [order?.lines]);

  const orderLineByProductId = useMemo(() => {
    const map = new Map<string, TicketLine>();
    for (const line of ticketLines) map.set(line.productId, line);
    return map;
  }, [ticketLines]);

  const reloadOrder = useCallback(async () => {
    const { onNotice } = optsRef.current;
    try {
      const query = new URLSearchParams({ branchId, activeDraft: "mine" });
      const response = await fetch(`/api/sales/orders?${query.toString()}`);
      const json = (await response.json()) as { data?: TicketOrder; message?: string; reason?: string };

      if (!response.ok) {
        onNotice(mapPosErrorToSpanish({ payload: json, status: response.status, fallback: "No se pudo preparar el ticket de venta." }), 10000);
        return;
      }

      setOrder(json.data ?? null);
    } catch (error) {
      console.error("[POS][reloadOrder]", error);
      onNotice(mapPosErrorToSpanish({ fallback: "No se pudo preparar el ticket de venta.", thrownError: error }), 10000);
    } finally {
      setIsInitialLoading(false);
    }
  }, [branchId]);

  // Ticket loads once per branchId — top-sellers are loaded inside usePosCatalog.
  useEffect(() => {
    void reloadOrder();
  }, [reloadOrder]);

  // Keeps lineDraftQuantities in sync with server-authoritative ticketLines:
  // adds new lines with their server quantity as the default, preserves in-progress
  // edits for lines still present, and discards errors for lines that have been removed.
  useEffect(() => {
    const nextLineIds = new Set(ticketLines.map((line) => line.id));

    setLineDraftQuantities((prev) => {
      const next: Record<string, string> = {};
      for (const line of ticketLines) {
        next[line.id] = prev[line.id] ?? line.quantity;
      }
      return next;
    });

    setLineQuantityErrors((prev) => {
      const next: Record<string, string> = {};
      for (const [lineId, value] of Object.entries(prev)) {
        if (nextLineIds.has(lineId)) next[lineId] = value;
      }
      return next;
    });
  }, [ticketLines]);

  function validateQuantityInput(rawQuantity: string): { value: number | null; error: string | null } {
    const cleaned = rawQuantity.trim();
    if (!cleaned) return { value: null, error: "La cantidad es obligatoria." };

    const parsed = Number(cleaned);
    if (!Number.isFinite(parsed)) return { value: null, error: "La cantidad debe ser numérica." };
    if (parsed <= 0) return { value: null, error: "La cantidad debe ser mayor que 0." };
    if (parsed > MAX_REASONABLE_QUANTITY) {
      return { value: null, error: `La cantidad es demasiado alta (máximo ${MAX_REASONABLE_QUANTITY}).` };
    }

    return { value: parsed, error: null };
  }

  async function updateLineQuantity(lineId: string, quantity: number, silent = false): Promise<boolean> {
    if (!order) return false;
    const { onNotice } = optsRef.current;

    const response = await apiFetch(`/api/sales/orders/${order.id}/lines/${lineId}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ quantity }),
    });
    const json = (await response.json()) as ApiErrorPayload;

    if (!response.ok) {
      onNotice(mapPosErrorToSpanish({ payload: json, status: response.status, fallback: "No se pudo actualizar la cantidad." }), 10000);
      return false;
    }

    await reloadOrder();
    if (!silent) onNotice("Cantidad actualizada.");
    return true;
  }

  async function commitLineQuantity(line: TicketLine, forcedValue?: number, silent = false) {
    const { fetchStockForProduct, onNotice } = optsRef.current;
    if (lineUpdatingId) return;

    const currentDraft = forcedValue !== undefined ? String(forcedValue) : (lineDraftQuantities[line.id] ?? line.quantity);
    const validation = validateQuantityInput(currentDraft);

    if (validation.error || validation.value == null) {
      setLineQuantityErrors((prev) => ({ ...prev, [line.id]: validation.error ?? "Cantidad inválida." }));
      return;
    }

    setLineUpdatingId(line.id);
    try {
      const availableStock = await fetchStockForProduct(line.productId);
      if (validation.value > availableStock) {
        setLineQuantityErrors((prev) => ({
          ...prev,
          [line.id]: `Stock insuficiente. Disponible: ${availableStock.toFixed(2)}.`,
        }));
        return;
      }

      const updated = await updateLineQuantity(line.id, validation.value, silent);
      if (!updated) return;

      setLineQuantityErrors((prev) => {
        const next = { ...prev };
        delete next[line.id];
        return next;
      });
      setLineDraftQuantities((prev) => ({ ...prev, [line.id]: String(validation.value) }));
    } catch (error) {
      console.error("[POS][commitLineQuantity]", error);
      onNotice(mapPosErrorToSpanish({ fallback: "No se pudo cambiar cantidad.", thrownError: error }), 10000);
    } finally {
      setLineUpdatingId(null);
    }
  }

  async function removeLine(lineId: string, silent = false) {
    const { onNotice } = optsRef.current;
    if (!order || lineUpdatingId) return;
    setLineUpdatingId(lineId);

    try {
      const response = await apiFetch(`/api/sales/orders/${order.id}/lines/${lineId}`, { method: "DELETE" });
      const json = (await response.json()) as ApiErrorPayload;

      if (!response.ok) {
        onNotice(mapPosErrorToSpanish({ payload: json, status: response.status, fallback: "No se pudo eliminar la línea." }), 10000);
        return;
      }

      await reloadOrder();
      if (!silent) onNotice("Producto removido del ticket.");
    } catch (error) {
      console.error("[POS][removeLine]", error);
      onNotice(mapPosErrorToSpanish({ fallback: "No se pudo eliminar la línea.", thrownError: error }), 10000);
    } finally {
      setLineUpdatingId(null);
    }
  }

  async function addProduct(product: ProductRow) {
    const { stockByProductId, onNotice, onProductAdded } = optsRef.current;
    if (!order || isMutatingOrder) return;

    const knownAvailableStock = product.availableSaleStock ?? product.sharedStock?.saleQuantity ?? product.availableStock ?? stockByProductId[product.id];
    if (typeof knownAvailableStock === "number" && knownAvailableStock <= 0) {
      onNotice(`Sin stock en esta sucursal: ${product.name}.`, 8000);
      return;
    }

    let success = false;
    setIsMutatingOrder(true);

    try {
      const existing = orderLineByProductId.get(product.id);
      if (existing) {
        await commitLineQuantity(existing, Number(existing.quantity) + 1, true);
      } else {
        const response = await apiFetch(`/api/sales/orders/${order.id}/lines`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ productId: product.id, quantity: 1 }),
        });
        const json = (await response.json()) as ApiErrorPayload;
        if (!response.ok) {
          onNotice(mapPosErrorToSpanish({ payload: json, status: response.status, fallback: "No se pudo agregar el producto." }), 10000);
          return;
        }
      }

      await reloadOrder();
      onNotice(`Producto agregado: ${product.name}.`);
      onProductAdded?.();
      success = true;
    } catch (error) {
      console.error("[POS][addProduct]", error);
      onNotice(mapPosErrorToSpanish({ fallback: "No se pudo agregar el producto.", thrownError: error }), 10000);
    } finally {
      setIsMutatingOrder(false);
    }
  }

  async function updateOrderNotes(notes: string) {
    if (!order) return;
    const { onNotice } = optsRef.current;
    try {
      const response = await apiFetch(`/api/sales/orders/${order.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ notes: notes.trim() || null }),
      });
      if (!response.ok) {
        onNotice("No se pudieron guardar las notas.", 6000);
      }
      // Order notes update is lightweight — no full reloadOrder needed.
      // Reflect locally to avoid a round-trip.
      setOrder((prev) => prev ? { ...prev, notes: notes.trim() || null } : prev);
    } catch {
      onNotice("Error al guardar las notas.", 6000);
    }
  }

  return {
    order,
    isInitialLoading,
    isMutatingOrder,
    reloadOrder,
    addProduct,
    commitLineQuantity,
    removeLine,
    updateOrderNotes,
    ticketLines,
    lineDraftQuantities,
    setLineDraftQuantities,
    lineQuantityErrors,
    setLineQuantityErrors,
    lineUpdatingId,
  };
}
