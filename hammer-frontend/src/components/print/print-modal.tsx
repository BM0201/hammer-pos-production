"use client";

import { useCallback, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { showToast } from "@/components/ui/toast";
import { apiFetch } from "@/lib/client/api";
import { openPrintableDocument, printHtml, recordPrintAudit } from "@/lib/printing";

export type PrintModalProps = {
  orderId: string;
  orderNumber: string;
  onClose: () => void;
};

type ModalStep = "options" | "manual-invoice";

export function PrintModal({ orderId, orderNumber, onClose }: PrintModalProps) {
  const [step, setStep] = useState<ModalStep>("options");
  const [isLoading, setIsLoading] = useState(false);
  const [miSeries, setMiSeries] = useState("");
  const [miNumber, setMiNumber] = useState("");
  const [miDate, setMiDate] = useState(new Date().toISOString().split("T")[0]);
  const [miCustomerName, setMiCustomerName] = useState("");
  const [miCustomerRuc, setMiCustomerRuc] = useState("");
  const [miNotes, setMiNotes] = useState("");

  const printDocument = useCallback(async (path: string, documentType: string, success: string) => {
    setIsLoading(true);
    try {
      await openPrintableDocument(path);
      await recordPrintAudit({ saleOrderId: orderId, entityType: "SaleOrder", entityId: orderId, documentType });
      showToast("success", success);
    } catch (error) {
      showToast("error", error instanceof Error ? error.message : "No se pudo imprimir el documento.");
    } finally {
      setIsLoading(false);
    }
  }, [orderId]);

  const handlePrintTicket = useCallback(() => {
    void printDocument(`/api/printing/sales/${orderId}/ticket?format=HTML`, "PURCHASE_TICKET", "Ticket POS impreso.");
  }, [orderId, printDocument]);

  const handlePrintDeliveryOrder = useCallback(() => {
    void printDocument(`/api/printing/sales/${orderId}/delivery-order?format=HTML`, "DELIVERY_ORDER", "Orden de entrega impresa.");
  }, [orderId, printDocument]);

  const handlePrintReceipt = useCallback(() => {
    void printDocument(`/api/printing/sales/${orderId}/receipt?format=HTML`, "PAYMENT_RECEIPT", "Recibo de pago impreso.");
  }, [orderId, printDocument]);

  const handleRegisterManualInvoice = useCallback(async () => {
    if (!miSeries.trim() || !miNumber.trim() || !miCustomerName.trim() || !miCustomerRuc.trim()) {
      showToast("warning", "Complete todos los campos obligatorios de la factura manual.");
      return;
    }

    setIsLoading(true);
    try {
      const registerRes = await apiFetch(`/api/sales/orders/${orderId}/register-manual-invoice`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          series: miSeries.trim(),
          number: miNumber.trim(),
          date: miDate,
          customerName: miCustomerName.trim(),
          customerRuc: miCustomerRuc.trim(),
          notes: miNotes.trim() || undefined,
        }),
      });

      if (!registerRes.ok) {
        showToast("error", "No se pudo registrar la factura manual.");
        return;
      }

      const docRes = await apiFetch(`/api/sales/orders/${orderId}/document?type=PAYMENT_RECEIPT`);
      if (docRes.ok) {
        const docJson = (await docRes.json()) as { data?: { html?: string } };
        if (docJson.data?.html) printHtml(docJson.data.html);
      }

      await recordPrintAudit({ saleOrderId: orderId, entityType: "SaleOrder", entityId: orderId, documentType: "PAYMENT_RECEIPT" });
      showToast("success", `Factura manual ${miSeries}-${miNumber} registrada e impresa.`);
      onClose();
    } catch {
      showToast("error", "Error al registrar factura manual. El pago ya fue registrado correctamente.");
    } finally {
      setIsLoading(false);
    }
  }, [orderId, onClose, miSeries, miNumber, miDate, miCustomerName, miCustomerRuc, miNotes]);

  return (
    <div className="fixed inset-0 z-[9990] flex items-center justify-center bg-black/50 backdrop-blur-sm">
      <div className="mx-4 w-full max-w-md overflow-hidden rounded-xl bg-[var(--color-surface)] shadow-2xl">
        <div className="bg-[var(--color-success-500)] px-6 py-4 text-white">
          <p className="text-lg font-bold">Pago registrado</p>
          <p className="text-sm opacity-90">Orden: {orderNumber}</p>
        </div>

        <div className="p-6">
          {step === "options" && (
            <div className="space-y-3">
              <p className="mb-4 text-sm text-[var(--color-text-muted)]">
                Seleccione el documento operativo que desea imprimir.
              </p>

              <Button onClick={handlePrintTicket} disabled={isLoading} className="w-full justify-start gap-3 bg-[var(--color-master-600)] py-3 text-white hover:bg-[var(--color-master-700)]">
                Imprimir ticket POS
              </Button>
              <Button onClick={handlePrintDeliveryOrder} disabled={isLoading} className="w-full justify-start gap-3 bg-[var(--color-branch-600)] py-3 text-white hover:bg-[var(--color-branch-700)]">
                Imprimir orden de entrega
              </Button>
              <Button onClick={handlePrintReceipt} disabled={isLoading} className="w-full justify-start gap-3 bg-[var(--color-info-600)] py-3 text-white hover:bg-[var(--color-info-700)]">
                Imprimir recibo de pago
              </Button>
              <Button onClick={() => setStep("manual-invoice")} disabled={isLoading} className="w-full justify-start gap-3 bg-[var(--color-warning-500)] py-3 text-white hover:bg-[var(--color-warning-600)]">
                Registrar factura manual
              </Button>
              <Button onClick={onClose} disabled={isLoading} className="w-full justify-start gap-3 bg-[var(--color-surface-alt)] py-3 text-[var(--color-text-muted)] hover:bg-[var(--color-border)]">
                Cerrar
              </Button>
            </div>
          )}

          {step === "manual-invoice" && (
            <div className="space-y-3">
              <p className="text-sm font-semibold">Datos de factura manual</p>
              <p className="text-xs text-[var(--color-text-muted)]">Solo registra los datos de una factura manual ya emitida.</p>

              <div className="grid grid-cols-2 gap-2">
                <label className="text-xs text-[var(--color-text-muted)]">
                  Serie *
                  <Input value={miSeries} onChange={(e) => setMiSeries(e.target.value)} placeholder="A001" className="mt-1" />
                </label>
                <label className="text-xs text-[var(--color-text-muted)]">
                  Numero *
                  <Input value={miNumber} onChange={(e) => setMiNumber(e.target.value)} placeholder="000123" className="mt-1" />
                </label>
              </div>
              <label className="text-xs text-[var(--color-text-muted)]">
                Fecha *
                <Input type="date" value={miDate} onChange={(e) => setMiDate(e.target.value)} className="mt-1" />
              </label>
              <label className="text-xs text-[var(--color-text-muted)]">
                Cliente *
                <Input value={miCustomerName} onChange={(e) => setMiCustomerName(e.target.value)} placeholder="Nombre completo" className="mt-1" />
              </label>
              <label className="text-xs text-[var(--color-text-muted)]">
                RUC / Cedula *
                <Input value={miCustomerRuc} onChange={(e) => setMiCustomerRuc(e.target.value)} placeholder="001-010190-0001A" className="mt-1" />
              </label>
              <label className="text-xs text-[var(--color-text-muted)]">
                Notas
                <Input value={miNotes} onChange={(e) => setMiNotes(e.target.value)} placeholder="Observaciones" className="mt-1" />
              </label>

              <div className="flex gap-2 pt-2">
                <Button onClick={() => setStep("options")} disabled={isLoading} className="flex-1 bg-[var(--color-surface-alt)] text-[var(--color-text)] hover:bg-[var(--color-border)]">
                  Volver
                </Button>
                <Button onClick={handleRegisterManualInvoice} disabled={isLoading} className="flex-1 bg-[var(--color-warning-500)] text-white hover:bg-[var(--color-warning-600)]">
                  {isLoading ? "Procesando..." : "Registrar e imprimir"}
                </Button>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
