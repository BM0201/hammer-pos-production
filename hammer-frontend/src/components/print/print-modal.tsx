"use client";

/**
 * PrintModal — Modal post-pago para impresión de documentos.
 * FASE 3 — H.A.M.M.E.R. POS/ERP
 *
 * Se muestra después de un pago exitoso. Opciones:
 * 1. Imprimir Orden de Entrega
 * 2. Registrar Factura Manual + Imprimir comprobante
 * 3. Omitir impresión
 *
 * La falla de impresión NO revierte el pago.
 */

import { useState, useCallback, useRef } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { showToast } from "@/components/ui/toast";
import { apiFetch } from "@/lib/client/api";

export type PrintModalProps = {
  orderId: string;
  orderNumber: string;
  onClose: () => void;
};

type ModalStep = "options" | "manual-invoice" | "printing";

export function PrintModal({ orderId, orderNumber, onClose }: PrintModalProps) {
  const [step, setStep] = useState<ModalStep>("options");
  const [isLoading, setIsLoading] = useState(false);
  const printFrameRef = useRef<HTMLIFrameElement>(null);

  // Manual invoice form state
  const [miSeries, setMiSeries] = useState("");
  const [miNumber, setMiNumber] = useState("");
  const [miDate, setMiDate] = useState(new Date().toISOString().split("T")[0]);
  const [miCustomerName, setMiCustomerName] = useState("");
  const [miCustomerRuc, setMiCustomerRuc] = useState("");
  const [miNotes, setMiNotes] = useState("");

  // ─── Imprimir Orden de Entrega ───────────────────────────────────

  const handlePrintDeliveryOrder = useCallback(async () => {
    setIsLoading(true);
    try {
      // 1) Emitir la OE (asigna número si no tiene)
      const emitRes = await apiFetch(`/api/sales/orders/${orderId}/document`, {
        method: "POST",
        body: JSON.stringify({}),
      });

      if (!emitRes.ok) {
        showToast("error", "No se pudo generar la orden de entrega.");
        return;
      }

      const emitJson = (await emitRes.json()) as { ok: boolean; data: { html: string; deliveryOrderNumber: string } };

      // 2) Registrar log de impresión
      await apiFetch(`/api/sales/orders/${orderId}/print`, {
        method: "POST",
        body: JSON.stringify({ documentType: "DELIVERY_ORDER", isReprint: false }),
      });

      // 3) Imprimir via window.print (browser print)
      printHtml(emitJson.data.html);

      showToast("success", `Orden de Entrega ${emitJson.data.deliveryOrderNumber} impresa.`);
    } catch {
      showToast("error", "Error al imprimir. El pago ya fue registrado correctamente.");
    } finally {
      setIsLoading(false);
      onClose();
    }
  }, [orderId, onClose]);

  // ─── Registrar Factura Manual ─────────────────────────────────────

  const handleRegisterManualInvoice = useCallback(async () => {
    if (!miSeries.trim() || !miNumber.trim() || !miCustomerName.trim() || !miCustomerRuc.trim()) {
      showToast("warning", "Complete todos los campos obligatorios de la factura manual.");
      return;
    }

    setIsLoading(true);
    try {
      // 1) Registrar factura manual
      const registerRes = await apiFetch(`/api/sales/orders/${orderId}/register-manual-invoice`, {
        method: "POST",
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
        setIsLoading(false);
        return;
      }

      // 2) Emitir OE también
      await apiFetch(`/api/sales/orders/${orderId}/document`, {
        method: "POST",
        body: JSON.stringify({}),
      });

      // 3) Obtener HTML del comprobante de factura manual
      const docRes = await apiFetch(`/api/sales/orders/${orderId}/document?type=PAYMENT_RECEIPT`);
      if (docRes.ok) {
        const docJson = (await docRes.json()) as { ok: boolean; data: { html: string } };
        printHtml(docJson.data.html);
      }

      // 4) Registrar log de impresión
      await apiFetch(`/api/sales/orders/${orderId}/print`, {
        method: "POST",
        body: JSON.stringify({ documentType: "PAYMENT_RECEIPT", isReprint: false }),
      });

      showToast("success", `Factura manual ${miSeries}-${miNumber} registrada e impresa.`);
    } catch {
      showToast("error", "Error al registrar factura manual. El pago ya fue registrado correctamente.");
    } finally {
      setIsLoading(false);
      onClose();
    }
  }, [orderId, onClose, miSeries, miNumber, miDate, miCustomerName, miCustomerRuc, miNotes]);

  // ─── Omitir impresión ─────────────────────────────────────────────

  const handleSkip = useCallback(() => {
    showToast("info", "Impresión omitida. El pago fue registrado correctamente.");
    onClose();
  }, [onClose]);

  // ─── Utilidad de impresión ────────────────────────────────────────

  function printHtml(html: string) {
    const iframe = printFrameRef.current;
    if (!iframe) {
      // Fallback: abrir en nueva ventana
      const win = window.open("", "_blank", "width=400,height=600");
      if (win) {
        win.document.write(html);
        win.document.close();
        win.focus();
        win.print();
      }
      return;
    }
    const doc = iframe.contentDocument;
    if (doc) {
      doc.open();
      doc.write(html);
      doc.close();
      iframe.contentWindow?.focus();
      iframe.contentWindow?.print();
    }
  }

  // ─── Render ───────────────────────────────────────────────────────

  return (
    <div className="fixed inset-0 z-[9990] flex items-center justify-center bg-black/50 backdrop-blur-sm">
      <div className="bg-[var(--color-surface)] rounded-xl shadow-2xl w-full max-w-md mx-4 overflow-hidden">
        {/* Header */}
        <div className="bg-[var(--color-success-500)] text-white px-6 py-4">
          <p className="text-lg font-bold">✓ Pago Registrado</p>
          <p className="text-sm opacity-90">Orden: {orderNumber}</p>
        </div>

        <div className="p-6">
          {step === "options" && (
            <div className="space-y-3">
              <p className="text-sm text-[var(--color-text-muted)] mb-4">
                Seleccione una opción para el documento de esta venta:
              </p>

              <Button
                onClick={handlePrintDeliveryOrder}
                disabled={isLoading}
                className="w-full justify-start gap-3 py-3 bg-[var(--color-branch-600)] text-white hover:bg-[var(--color-branch-700)]"
              >
                🖨️ Imprimir Orden de Entrega
              </Button>

              <Button
                onClick={() => setStep("manual-invoice")}
                disabled={isLoading}
                className="w-full justify-start gap-3 py-3 bg-[var(--color-warning-500)] text-white hover:bg-[var(--color-warning-600)]"
              >
                📋 Registrar Factura Manual
              </Button>

              <Button
                onClick={handleSkip}
                disabled={isLoading}
                className="w-full justify-start gap-3 py-3 bg-[var(--color-surface-alt)] text-[var(--color-text-muted)] hover:bg-[var(--color-border)]"
              >
                ⏭️ Omitir Impresión
              </Button>
            </div>
          )}

          {step === "manual-invoice" && (
            <div className="space-y-3">
              <p className="text-sm font-semibold mb-2">Datos de Factura Manual</p>
              <p className="text-xs text-[var(--color-text-muted)] mb-3">
                Ingrese los datos de la factura manual emitida al cliente.
              </p>

              <div className="grid grid-cols-2 gap-2">
                <div>
                  <label className="text-xs text-[var(--color-text-muted)]">Serie *</label>
                  <Input
                    value={miSeries}
                    onChange={(e) => setMiSeries(e.target.value)}
                    placeholder="A001"
                    className="mt-1"
                  />
                </div>
                <div>
                  <label className="text-xs text-[var(--color-text-muted)]">Número *</label>
                  <Input
                    value={miNumber}
                    onChange={(e) => setMiNumber(e.target.value)}
                    placeholder="000123"
                    className="mt-1"
                  />
                </div>
              </div>

              <div>
                <label className="text-xs text-[var(--color-text-muted)]">Fecha Factura *</label>
                <Input
                  type="date"
                  value={miDate}
                  onChange={(e) => setMiDate(e.target.value)}
                  className="mt-1"
                />
              </div>

              <div>
                <label className="text-xs text-[var(--color-text-muted)]">Nombre del Cliente *</label>
                <Input
                  value={miCustomerName}
                  onChange={(e) => setMiCustomerName(e.target.value)}
                  placeholder="Nombre completo"
                  className="mt-1"
                />
              </div>

              <div>
                <label className="text-xs text-[var(--color-text-muted)]">RUC / Cédula *</label>
                <Input
                  value={miCustomerRuc}
                  onChange={(e) => setMiCustomerRuc(e.target.value)}
                  placeholder="001-010190-0001A"
                  className="mt-1"
                />
              </div>

              <div>
                <label className="text-xs text-[var(--color-text-muted)]">Notas (opcional)</label>
                <Input
                  value={miNotes}
                  onChange={(e) => setMiNotes(e.target.value)}
                  placeholder="Observaciones..."
                  className="mt-1"
                />
              </div>

              <div className="flex gap-2 pt-2">
                <Button
                  onClick={() => setStep("options")}
                  disabled={isLoading}
                  className="flex-1 bg-[var(--color-surface-alt)] text-[var(--color-text)] hover:bg-[var(--color-border)]"
                >
                  ← Volver
                </Button>
                <Button
                  onClick={handleRegisterManualInvoice}
                  disabled={isLoading}
                  className="flex-1 bg-[var(--color-warning-500)] text-white hover:bg-[var(--color-warning-600)]"
                >
                  {isLoading ? "Procesando..." : "Registrar e Imprimir"}
                </Button>
              </div>
            </div>
          )}
        </div>
      </div>

      {/* Iframe oculto para impresión */}
      <iframe
        ref={printFrameRef}
        style={{ position: "absolute", width: 0, height: 0, border: "none", visibility: "hidden" }}
        title="print-frame"
      />
    </div>
  );
}
