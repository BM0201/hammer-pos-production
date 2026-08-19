"use client";

import { useCallback, useEffect, useState } from "react";
import { CheckCircle2, X, Receipt, Truck, FileText, Coins, ChevronRight } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { showToast } from "@/components/ui/toast";
import { apiFetch } from "@/lib/client/api";
import { openPrintableDocument, printHtml, recordPrintAudit } from "@/lib/printing";
import type { ComposedTender } from "@/components/payments/payment-composer";

/**
 * Pantalla 2 · Post-cobro (prompt-pantallas-recorrido-dinero.md). No marca
 * nada del dinero — solo informa. El vuelto es lo único que el cajero
 * necesita en este instante (tiene plata en la mano y gente esperando), así
 * que va grande y no desaparece al confirmar.
 */
export type PrintModalProps = {
  orderId: string;
  orderNumber: string;
  /** Los tenders del cobro recién hecho — para el vuelto y el desglose por medio. Sin esto (p.ej. factura registrada por otro camino), la pantalla simplemente no muestra esa sección. */
  tenders?: ComposedTender[] | null;
  onClose: () => void;
};

type ModalStep = "options" | "manual-invoice";
type DocKey = "ticket" | "entrega" | "recibo";

const METHOD_LABEL: Record<string, string> = { CASH: "Efectivo", CARD: "Tarjeta", TRANSFER: "Transferencia" };

function fmt(value: number) {
  return `C$${value.toLocaleString("es-NI", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

export function PrintModal({ orderId, orderNumber, tenders, onClose }: PrintModalProps) {
  const [step, setStep] = useState<ModalStep>("options");
  const [isLoading, setIsLoading] = useState(false);
  const [printed, setPrinted] = useState<Partial<Record<DocKey, boolean>>>({});
  const [miSeries, setMiSeries] = useState("");
  const [miNumber, setMiNumber] = useState("");
  const [miDate, setMiDate] = useState(new Date().toISOString().split("T")[0]);
  const [miCustomerName, setMiCustomerName] = useState("");
  const [miCustomerRuc, setMiCustomerRuc] = useState("");
  const [miNotes, setMiNotes] = useState("");

  const printDocument = useCallback(async (path: string, documentType: string, key: DocKey) => {
    setIsLoading(true);
    try {
      await openPrintableDocument(path);
      await recordPrintAudit({ saleOrderId: orderId, entityType: "SaleOrder", entityId: orderId, documentType });
      // Una sola confirmación: el check permanente en el botón, no ADEMÁS un
      // toast diciendo lo mismo (§Pantalla 2, "hoy el toast y la banda verde
      // dicen lo mismo al mismo tiempo").
      setPrinted((prev) => ({ ...prev, [key]: true }));
    } catch (error) {
      showToast("error", error instanceof Error ? error.message : "No se pudo imprimir el documento.");
    } finally {
      setIsLoading(false);
    }
  }, [orderId]);

  const handlePrintTicket = useCallback(() => {
    void printDocument(`/api/printing/sales/${orderId}/ticket?format=HTML`, "PURCHASE_TICKET", "ticket");
  }, [orderId, printDocument]);

  const handlePrintDeliveryOrder = useCallback(() => {
    void printDocument(`/api/printing/sales/${orderId}/delivery-order?format=HTML`, "DELIVERY_ORDER", "entrega");
  }, [orderId, printDocument]);

  const handlePrintReceipt = useCallback(() => {
    void printDocument(`/api/printing/sales/${orderId}/receipt?format=HTML`, "PAYMENT_RECEIPT", "recibo");
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

  // Enter imprime el ticket, Esc cierra — solo en el paso principal (§Pantalla 2).
  useEffect(() => {
    if (step !== "options") return;
    function onKeydown(event: KeyboardEvent) {
      if (event.key === "Enter") {
        event.preventDefault();
        handlePrintTicket();
      } else if (event.key === "Escape") {
        event.preventDefault();
        onClose();
      }
    }
    window.addEventListener("keydown", onKeydown);
    return () => window.removeEventListener("keydown", onKeydown);
  }, [step, handlePrintTicket, onClose]);

  const total = tenders && tenders.length > 0 ? tenders.reduce((sum, t) => sum + t.amount, 0) : null;
  const change = tenders?.find((t) => t.method === "CASH")?.changeAmount ?? 0;
  const breakdown = tenders && tenders.length > 0
    ? tenders.map((t) => `${METHOD_LABEL[t.method] ?? t.method} ${fmt(t.amount)}`).join(" · ")
    : null;

  return (
    <div className="fixed inset-0 z-[9990] flex items-center justify-center bg-black/50 backdrop-blur-sm">
      <div className="mx-4 w-full max-w-md overflow-hidden rounded-xl bg-[var(--color-surface)] shadow-2xl">
        <div className="flex items-center justify-between gap-3 px-5 py-4">
          <div className="flex items-center gap-2.5">
            <CheckCircle2 className="h-5 w-5 shrink-0 text-[var(--color-success-600)]" />
            <div>
              <p className="text-[0.9375rem] font-semibold text-[var(--color-text)]">Pago registrado</p>
              <p className="font-mono text-xs text-[var(--color-text-soft)]">{orderNumber}</p>
            </div>
          </div>
          <button onClick={onClose} className="rounded-lg p-1.5 text-[var(--color-text-soft)] hover:bg-[var(--color-surface-alt)] hover:text-[var(--color-text)]" aria-label="Cerrar">
            <X className="h-4 w-4" />
          </button>
        </div>

        {step === "options" && (
          <div className="px-5 pb-5">
            {total !== null && (
              <div className="mb-4 rounded-xl border border-[var(--color-border)] bg-[var(--color-surface-muted)] p-4">
                <div className="flex items-baseline justify-between">
                  <span className="text-sm text-[var(--color-text-muted)]">Cobrado</span>
                  <span className="text-xl font-bold tabular-nums text-[var(--color-text)]">{fmt(total)}</span>
                </div>
                {breakdown ? <p className="mt-1 text-xs text-[var(--color-text-soft)]">{breakdown}</p> : null}
                {change > 0 && (
                  <div className="mt-3 flex items-center justify-between border-t border-[var(--color-border)] pt-3">
                    <span className="flex items-center gap-1.5 text-sm font-semibold text-[var(--color-warning-600)]">
                      <Coins className="h-4 w-4" /> Vuelto a entregar
                    </span>
                    <span className="text-2xl font-bold tabular-nums text-[var(--color-warning-600)]">{fmt(change)}</span>
                  </div>
                )}
              </div>
            )}

            <div className="space-y-2">
              <Button
                onClick={handlePrintTicket}
                disabled={isLoading}
                variant="success"
                className="w-full py-3"
                icon={<Receipt className="h-4 w-4" />}
                data-testid="print-modal-ticket"
              >
                <span className="flex flex-1 items-center">
                  Imprimir ticket
                  {printed.ticket && <CheckCircle2 className="ml-1.5 h-3.5 w-3.5" />}
                  <span className="ml-auto pl-2 text-xs font-normal opacity-70">Enter</span>
                </span>
              </Button>
              <div className="grid grid-cols-2 gap-2">
                <Button
                  onClick={handlePrintDeliveryOrder}
                  disabled={isLoading}
                  variant={printed.entrega ? "success" : "secondary"}
                  size="sm"
                  icon={<Truck className="h-3.5 w-3.5" />}
                  data-testid="print-modal-delivery"
                >
                  Orden de entrega
                </Button>
                <Button
                  onClick={handlePrintReceipt}
                  disabled={isLoading}
                  variant={printed.recibo ? "success" : "secondary"}
                  size="sm"
                  icon={<FileText className="h-3.5 w-3.5" />}
                  data-testid="print-modal-receipt"
                >
                  Recibo de pago
                </Button>
              </div>
            </div>

            <button
              onClick={() => setStep("manual-invoice")}
              disabled={isLoading}
              className="mt-4 flex w-full items-center justify-between border-t border-[var(--color-border)] pt-3 text-left hover:opacity-80"
            >
              <span>
                <span className="block text-sm font-medium text-[var(--color-text-secondary)]">Factura manual</span>
                <span className="block text-xs text-[var(--color-text-soft)]">Registrar una ya emitida a mano</span>
              </span>
              <ChevronRight className="h-4 w-4 shrink-0 text-[var(--color-text-soft)]" />
            </button>

            <div className="mt-3 flex justify-end">
              <button onClick={onClose} disabled={isLoading} className="flex items-center gap-1.5 text-xs text-[var(--color-text-muted)] hover:text-[var(--color-text)]">
                Cerrar <span className="opacity-60">Esc</span>
              </button>
            </div>
          </div>
        )}

        {step === "manual-invoice" && (
          <div className="space-y-3 px-5 pb-5">
            <p className="text-sm font-semibold text-[var(--color-text)]">Datos de factura manual</p>
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
              <Button onClick={() => setStep("options")} disabled={isLoading} variant="secondary" className="flex-1">
                Volver
              </Button>
              <Button onClick={() => void handleRegisterManualInvoice()} disabled={isLoading} loading={isLoading} variant="success" className="flex-1">
                Registrar e imprimir
              </Button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
