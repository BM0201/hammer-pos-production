/**
 * Generador HTML de Comprobante de Factura Manual para impresión térmica.
 * FASE 3 — H.A.M.M.E.R. POS/ERP
 *
 * Se imprime como constancia de que se registró una factura manual externa.
 * No es factura fiscal.
 */

import type { DocumentGenerationOptions } from "../types";

const PAPER_WIDTHS: Record<string, string> = {
  W58MM: "48mm",
  W80MM: "72mm",
  A4: "210mm",
};

function formatCurrency(amount: number): string {
  return `C$ ${amount.toFixed(2)}`;
}

function escapeHtml(str: string): string {
  return str
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

export function generateManualInvoiceReceiptHtml(options: DocumentGenerationOptions): string {
  const { order, settings, manualInvoice } = options;
  const width = PAPER_WIDTHS[settings.paperWidth] ?? "72mm";
  const fs = settings.fontSize;

  if (!manualInvoice) {
    return `<html><body><p>Error: Datos de factura manual no proporcionados.</p></body></html>`;
  }

  const logoHtml = settings.logoUrl
    ? `<img src="${escapeHtml(settings.logoUrl)}" style="max-width:60%;max-height:50px;margin-bottom:4px;" alt="Logo" />`
    : "";

  const footerHtml = settings.footerText
    ? `<p style="font-size:${fs - 2}px;text-align:center;margin-top:6px;color:#666;">${escapeHtml(settings.footerText)}</p>`
    : "";

  return `<!DOCTYPE html>
<html lang="es">
<head>
<meta charset="UTF-8"/>
<title>Comprobante Factura Manual - ${escapeHtml(manualInvoice.series)}-${escapeHtml(manualInvoice.number)}</title>
<style>
  @page { size: ${width} auto; margin: 2mm; }
  @media print { body { margin: 0; } }
  * { margin: 0; padding: 0; box-sizing: border-box; }
  body { font-family: 'Courier New', monospace; font-size: ${fs}px; width: ${width}; }
  .receipt { width: 100%; padding: 2mm; }
  .separator { border-top: 1px dashed #000; margin: 4px 0; }
</style>
</head>
<body>
<div class="receipt">
  <!-- Encabezado -->
  <div style="text-align:center;">
    ${logoHtml}
    <p style="font-size:${fs + 2}px;font-weight:bold;">${escapeHtml(order.branchName)}</p>
  </div>

  <div class="separator"></div>

  <!-- Título -->
  <div style="text-align:center;margin:4px 0;">
    <p style="font-size:${fs + 1}px;font-weight:bold;">COMPROBANTE DE FACTURA MANUAL</p>
    <p style="font-size:${fs - 2}px;color:#666;">Registro interno de factura manual emitida.</p>
    <p style="font-size:${fs - 2}px;color:#666;">No constituye factura fiscal adicional.</p>
  </div>

  <div class="separator"></div>

  <!-- Datos de la factura manual -->
  <div style="margin:4px 0;">
    <p style="font-size:${fs}px;font-weight:bold;">Serie: ${escapeHtml(manualInvoice.series)} - No. ${escapeHtml(manualInvoice.number)}</p>
    <p style="font-size:${fs - 1}px;">Fecha factura: ${escapeHtml(manualInvoice.date)}</p>
    <p style="font-size:${fs - 1}px;">Cliente: ${escapeHtml(manualInvoice.customerName)}</p>
    <p style="font-size:${fs - 1}px;">RUC/Cédula: ${escapeHtml(manualInvoice.customerRuc)}</p>
    ${manualInvoice.notes ? `<p style="font-size:${fs - 2}px;color:#666;">Notas: ${escapeHtml(manualInvoice.notes)}</p>` : ""}
  </div>

  <div class="separator"></div>

  <!-- Referencia de orden -->
  <div style="margin:4px 0;">
    <p style="font-size:${fs - 1}px;">Orden asociada: <strong>${escapeHtml(order.orderNumber)}</strong></p>
    ${order.deliveryOrderNumber ? `<p style="font-size:${fs - 1}px;">OE: ${escapeHtml(order.deliveryOrderNumber)}</p>` : ""}
    <p style="font-size:${fs}px;font-weight:bold;">Total: ${formatCurrency(order.grandTotal)}</p>
  </div>

  <div class="separator"></div>

  ${footerHtml}

  <div style="text-align:center;margin-top:8px;">
    <p style="font-size:${fs - 2}px;color:#999;">Documento de control interno</p>
  </div>
</div>
</body>
</html>`;
}
