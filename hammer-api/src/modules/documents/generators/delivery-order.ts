/**
 * Generador HTML de Orden de Entrega / Ticket de Compra para impresión térmica.
 * FASE 3 — H.A.M.M.E.R. POS/ERP
 *
 * Genera HTML optimizado para impresoras térmicas de 80mm o 58mm.
 * NUNCA dice "factura fiscal" — usa "Orden de Entrega" / "Ticket de Compra".
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

function formatDate(dateStr: string): string {
  const d = new Date(dateStr);
  return d.toLocaleDateString("es-NI", {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function escapeHtml(str: string): string {
  return str
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

export function generateDeliveryOrderHtml(options: DocumentGenerationOptions): string {
  const { order, settings } = options;
  const width = PAPER_WIDTHS[settings.paperWidth] ?? "72mm";
  const fs = settings.fontSize;

  const linesHtml = order.lines
    .map(
      (line) => `
    <tr>
      <td style="text-align:left;font-size:${fs - 1}px;padding:1px 0;">
        ${escapeHtml(line.name)}<br/>
        <span style="color:#666;font-size:${fs - 2}px;">${escapeHtml(line.sku)}</span>
      </td>
      <td style="text-align:center;font-size:${fs - 1}px;padding:1px 0;">${line.quantity}</td>
      <td style="text-align:right;font-size:${fs - 1}px;padding:1px 0;">${formatCurrency(line.unitPrice)}</td>
      <td style="text-align:right;font-size:${fs - 1}px;padding:1px 0;">${formatCurrency(line.lineSubtotal)}</td>
    </tr>`
    )
    .join("");

  const transportRow = order.requiresTransport
    ? `<tr><td colspan="3" style="text-align:right;font-size:${fs}px;">Transporte:</td><td style="text-align:right;font-size:${fs}px;">${formatCurrency(order.transportAmount)}</td></tr>`
    : "";

  const discountRow =
    order.discountTotal > 0
      ? `<tr><td colspan="3" style="text-align:right;font-size:${fs}px;">Descuento:</td><td style="text-align:right;font-size:${fs}px;">-${formatCurrency(order.discountTotal)}</td></tr>`
      : "";

  const logoHtml = settings.logoUrl
    ? `<img src="${escapeHtml(settings.logoUrl)}" style="max-width:60%;max-height:50px;margin-bottom:4px;" alt="Logo" />`
    : "";

  const footerHtml = settings.footerText
    ? `<p style="font-size:${fs - 2}px;text-align:center;margin-top:6px;color:#666;">${escapeHtml(settings.footerText)}</p>`
    : "";

  const paymentLine = order.paymentMethod
    ? `<p style="font-size:${fs - 1}px;margin:2px 0;">Forma de pago: <strong>${escapeHtml(order.paymentMethod)}</strong></p>`
    : "";

  return `<!DOCTYPE html>
<html lang="es">
<head>
<meta charset="UTF-8"/>
<title>Orden de Entrega - ${escapeHtml(order.deliveryOrderNumber ?? order.orderNumber)}</title>
<style>
  @page { size: ${width} auto; margin: 2mm; }
  @media print { body { margin: 0; } }
  * { margin: 0; padding: 0; box-sizing: border-box; }
  body { font-family: 'Courier New', monospace; font-size: ${fs}px; width: ${width}; }
  .receipt { width: 100%; padding: 2mm; }
  .separator { border-top: 1px dashed #000; margin: 4px 0; }
  table { width: 100%; border-collapse: collapse; }
  th { text-align: left; font-size: ${fs - 1}px; border-bottom: 1px solid #000; padding: 2px 0; }
</style>
</head>
<body>
<div class="receipt">
  <!-- Encabezado -->
  <div style="text-align:center;">
    ${logoHtml}
    <p style="font-size:${fs + 2}px;font-weight:bold;">${escapeHtml(order.branchName)}</p>
    ${order.branchAddress ? `<p style="font-size:${fs - 2}px;">${escapeHtml(order.branchAddress)}</p>` : ""}
    ${order.branchPhone ? `<p style="font-size:${fs - 2}px;">Tel: ${escapeHtml(order.branchPhone)}</p>` : ""}
  </div>

  <div class="separator"></div>

  <!-- Título del documento -->
  <div style="text-align:center;margin:4px 0;">
    <p style="font-size:${fs + 1}px;font-weight:bold;">ORDEN DE ENTREGA / TICKET DE COMPRA</p>
    <p style="font-size:${fs - 2}px;color:#666;">Documento interno de soporte comercial.</p>
    <p style="font-size:${fs - 2}px;color:#666;">No constituye factura fiscal.</p>
  </div>

  <div class="separator"></div>

  <!-- Datos del documento -->
  <div style="margin:4px 0;">
    ${order.deliveryOrderNumber ? `<p style="font-size:${fs - 1}px;">No. OE: <strong>${escapeHtml(order.deliveryOrderNumber)}</strong></p>` : ""}
    <p style="font-size:${fs - 1}px;">Orden: <strong>${escapeHtml(order.orderNumber)}</strong></p>
    <p style="font-size:${fs - 1}px;">Fecha: ${formatDate(order.createdAt)}</p>
    ${order.customerName ? `<p style="font-size:${fs - 1}px;">Cliente: ${escapeHtml(order.customerName)}</p>` : ""}
    ${order.customerRuc ? `<p style="font-size:${fs - 1}px;">RUC: ${escapeHtml(order.customerRuc)}</p>` : ""}
    <p style="font-size:${fs - 1}px;">Vendedor: ${escapeHtml(order.sellerName)}</p>
    ${order.cashierName ? `<p style="font-size:${fs - 1}px;">Cajero: ${escapeHtml(order.cashierName)}</p>` : ""}
  </div>

  <div class="separator"></div>

  <!-- Detalle de productos -->
  <table>
    <thead>
      <tr>
        <th>Producto</th>
        <th style="text-align:center;">Cant</th>
        <th style="text-align:right;">P.Unit</th>
        <th style="text-align:right;">Total</th>
      </tr>
    </thead>
    <tbody>
      ${linesHtml}
    </tbody>
  </table>

  <div class="separator"></div>

  <!-- Totales -->
  <table>
    <tbody>
      <tr>
        <td colspan="3" style="text-align:right;font-size:${fs}px;">Subtotal:</td>
        <td style="text-align:right;font-size:${fs}px;">${formatCurrency(order.subtotal)}</td>
      </tr>
      ${discountRow}
      ${transportRow}
      <tr>
        <td colspan="3" style="text-align:right;font-size:${fs + 1}px;font-weight:bold;padding-top:4px;">TOTAL:</td>
        <td style="text-align:right;font-size:${fs + 1}px;font-weight:bold;padding-top:4px;">${formatCurrency(order.grandTotal)}</td>
      </tr>
    </tbody>
  </table>

  <div class="separator"></div>

  ${paymentLine}
  ${order.notes ? `<p style="font-size:${fs - 2}px;margin:2px 0;color:#666;">Notas: ${escapeHtml(order.notes)}</p>` : ""}

  ${footerHtml}

  <div style="text-align:center;margin-top:8px;">
    <p style="font-size:${fs - 2}px;color:#999;">¡Gracias por su compra!</p>
  </div>
</div>
</body>
</html>`;
}
