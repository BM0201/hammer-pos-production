"use client";

import { useCallback, useEffect, useState } from "react";
import { apiFetch } from "@/lib/client/api";
import { openPrintableDocument, recordPrintAudit } from "@/lib/printing";

type PrintSettings = { autoPrintTicket?: boolean; autoPrintDelivery?: boolean };
// Only the fields autoPrintCompletedOrder actually reads — compatible with TicketOrder.
type PrintableOrder = { id: string; orderNumber: string };

export function usePosPrint(branchId: string, onPrintError: (msg: string) => void) {
  const [printSettings, setPrintSettings] = useState<PrintSettings | null>(null);
  const [printModalOrderId, setPrintModalOrderId] = useState<string | null>(null);
  const [printModalOrderNumber, setPrintModalOrderNumber] = useState<string>("");

  useEffect(() => {
    let cancelled = false;
    apiFetch(`/api/printing/settings?branchId=${branchId}`)
      .then(async (response) => {
        if (!response.ok) return;
        const payload = await response.json();
        if (!cancelled) setPrintSettings(payload.data ?? null);
      })
      .catch(() => undefined);
    return () => { cancelled = true; };
  }, [branchId]);

  const autoPrintCompletedOrder = useCallback(async (completedOrder: PrintableOrder) => {
    if (!printSettings?.autoPrintTicket && !printSettings?.autoPrintDelivery) return;
    try {
      if (printSettings.autoPrintTicket) {
        await openPrintableDocument(`/api/printing/sales/${completedOrder.id}/ticket?format=HTML`);
        await recordPrintAudit({ branchId, saleOrderId: completedOrder.id, entityType: "SaleOrder", entityId: completedOrder.id, documentType: "PURCHASE_TICKET" });
      }
      if (printSettings.autoPrintDelivery) {
        await openPrintableDocument(`/api/printing/sales/${completedOrder.id}/delivery-order?format=HTML`);
        await recordPrintAudit({ branchId, saleOrderId: completedOrder.id, entityType: "SaleOrder", entityId: completedOrder.id, documentType: "DELIVERY_ORDER" });
      }
    } catch {
      onPrintError("La venta fue completada, pero no se pudo abrir la impresion automatica.");
    }
  }, [branchId, printSettings, onPrintError]);

  return {
    printSettings,
    printModalOrderId,
    setPrintModalOrderId,
    printModalOrderNumber,
    setPrintModalOrderNumber,
    autoPrintCompletedOrder,
  };
}
