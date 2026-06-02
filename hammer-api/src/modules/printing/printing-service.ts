import { prisma } from "@/lib/prisma";
import { logAuditEvent } from "@/modules/audit/service";
import { createPrintLog } from "@/modules/print/service";
import type { DocumentType, PaymentMethod, PrintSettings, Prisma } from "@prisma/client";

type RenderFormat = "HTML" | "TEXT" | "JSON";

type PrintSettingsView = {
  id: string | null;
  branchId: string;
  cashRegisterId: string | null;
  name: string;
  printerType: "BROWSER" | "THERMAL_BROWSER" | "ESC_POS_FUTURE";
  paperSize: "THERMAL_58MM" | "THERMAL_80MM" | "A4";
  copiesTicket: number;
  copiesDeliveryOrder: number;
  autoPrintTicket: boolean;
  autoPrintDelivery: boolean;
  businessName: string | null;
  businessLegalName: string | null;
  taxId: string | null;
  address: string | null;
  phone: string | null;
  footerMessage: string | null;
  logoUrl: string | null;
  showPricesOnDeliveryOrder: boolean;
  showCostData: boolean;
  showCashierName: boolean;
  showCustomerData: boolean;
  ticketTemplate: string | null;
  deliveryTemplate: string | null;
  receiptTemplate: string | null;
  isDefault: boolean;
  isActive: boolean;
  isVirtualDefault: boolean;
  legacy: {
    printerName: string | null;
    printerMode: string;
    paperWidth: string;
    fontSize: number;
    copies: number;
    autoPrint: boolean;
    cutPaper: boolean;
    openDrawer: boolean;
    showQr: boolean;
  };
};

type RecordPrintAuditInput = {
  actorUserId?: string;
  branchId?: string;
  documentType: string;
  entityType: string;
  entityId: string;
  saleOrderId?: string;
  isReprint?: boolean;
  reason?: string;
  metadataJson?: Record<string, unknown>;
};

function n(value: unknown, fallback = 0) {
  const parsed = Number(value ?? fallback);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function money(value: unknown) {
  return `C$ ${n(value).toFixed(2)}`;
}

function escapeHtml(value: unknown) {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function formatDate(value: Date | string | null | undefined) {
  if (!value) return "";
  return new Date(value).toLocaleString("es-NI", { dateStyle: "short", timeStyle: "short" });
}

function mapPrinterType(settings?: PrintSettings | null): PrintSettingsView["printerType"] {
  if (settings?.printerMode === "NETWORK_ESCPOS") return "ESC_POS_FUTURE";
  if (settings?.printerMode === "QZ_TRAY") return "THERMAL_BROWSER";
  return "BROWSER";
}

function mapPaperSize(settings?: PrintSettings | null): PrintSettingsView["paperSize"] {
  if (settings?.paperWidth === "W58MM") return "THERMAL_58MM";
  if (settings?.paperWidth === "A4") return "A4";
  return "THERMAL_80MM";
}

function printableWidth(settings: PrintSettingsView) {
  if (settings.paperSize === "THERMAL_58MM") return "58mm";
  if (settings.paperSize === "A4") return "210mm";
  return "80mm";
}

function buildSettingsView(branch: { id: string; code?: string; name: string }, settings?: PrintSettings | null): PrintSettingsView {
  return {
    id: settings?.id ?? null,
    branchId: branch.id,
    cashRegisterId: settings?.cashRegisterId ?? null,
    name: settings?.name ?? "Configuracion principal",
    printerType: mapPrinterType(settings),
    paperSize: mapPaperSize(settings),
    copiesTicket: settings?.copies ?? 1,
    copiesDeliveryOrder: settings?.copiesDeliveryOrder ?? 1,
    autoPrintTicket: settings?.autoPrint ?? false,
    autoPrintDelivery: settings?.autoPrintDelivery ?? false,
    businessName: settings?.businessName ?? branch.name ?? "HAMMER POS",
    businessLegalName: settings?.businessLegalName ?? null,
    taxId: settings?.taxId ?? null,
    address: settings?.address ?? null,
    phone: settings?.phone ?? null,
    footerMessage: settings?.footerText ?? null,
    logoUrl: settings?.logoUrl ?? null,
    showPricesOnDeliveryOrder: settings?.showPricesOnDeliveryOrder ?? false,
    showCostData: settings?.showCostData ?? false,
    showCashierName: settings?.showCashierName ?? true,
    showCustomerData: settings?.showCustomerData ?? true,
    ticketTemplate: settings?.ticketTemplate ?? null,
    deliveryTemplate: settings?.deliveryTemplate ?? null,
    receiptTemplate: settings?.receiptTemplate ?? null,
    isDefault: settings?.isDefault ?? true,
    isActive: settings?.isActive ?? true,
    isVirtualDefault: !settings,
    legacy: {
      printerName: settings?.printerName ?? null,
      printerMode: settings?.printerMode ?? "BROWSER_PRINT",
      paperWidth: settings?.paperWidth ?? "W80MM",
      fontSize: settings?.fontSize ?? 12,
      copies: settings?.copies ?? 1,
      autoPrint: settings?.autoPrint ?? false,
      cutPaper: settings?.cutPaper ?? true,
      openDrawer: settings?.openDrawer ?? false,
      showQr: settings?.showQr ?? false,
    },
  };
}

export async function getPrintSettings(input: { branchId: string; cashRegisterId?: string | null }) {
  const branch = await prisma.branch.findUniqueOrThrow({ where: { id: input.branchId }, select: { id: true, code: true, name: true } });
  const settings = await prisma.printSettings.findUnique({ where: { branchId: input.branchId } });
  return buildSettingsView(branch, settings);
}

function documentShell(input: { title: string; settings: PrintSettingsView; body: string; plainText?: string }) {
  const width = printableWidth(input.settings);
  return `<!doctype html>
<html lang="es">
<head>
<meta charset="utf-8" />
<title>${escapeHtml(input.title)}</title>
<style>
@page { size: ${width} auto; margin: 4mm; }
@media print { .no-print { display: none !important; } body { margin: 0; } }
* { box-sizing: border-box; }
body { margin: 0; background: #fff; color: #111; font-family: Arial, sans-serif; font-size: ${input.settings.legacy.fontSize}px; }
.doc { width: ${width}; max-width: 100%; padding: 4mm; margin: 0 auto; }
.thermal { font-family: "Courier New", monospace; }
.center { text-align: center; }
.right { text-align: right; }
.muted { color: #555; font-size: 0.88em; }
.separator { border-top: 1px dashed #222; margin: 8px 0; }
table { width: 100%; border-collapse: collapse; }
th, td { padding: 3px 0; vertical-align: top; }
th { border-bottom: 1px solid #222; text-align: left; }
.signatures { display: grid; grid-template-columns: 1fr 1fr; gap: 18px; margin-top: 28px; }
.signature { border-top: 1px solid #111; padding-top: 5px; text-align: center; font-size: 0.9em; }
button { margin: 10px auto; display: block; padding: 8px 12px; }
</style>
</head>
<body>
<button class="no-print" onclick="window.print()">Imprimir</button>
<main class="doc thermal">
${input.body}
</main>
</body>
</html>`;
}

function header(settings: PrintSettingsView, subtitle: string, branchName?: string) {
  return `<div class="center">
${settings.logoUrl ? `<img src="${escapeHtml(settings.logoUrl)}" alt="Logo" style="max-height:54px;max-width:70%;margin-bottom:4px" />` : ""}
<strong>${escapeHtml(settings.businessName ?? branchName ?? "HAMMER POS")}</strong>
${settings.businessLegalName ? `<div class="muted">${escapeHtml(settings.businessLegalName)}</div>` : ""}
${settings.taxId ? `<div class="muted">RUC/ID: ${escapeHtml(settings.taxId)}</div>` : ""}
${settings.address ? `<div class="muted">${escapeHtml(settings.address)}</div>` : ""}
${settings.phone ? `<div class="muted">Tel: ${escapeHtml(settings.phone)}</div>` : ""}
<div class="separator"></div>
<strong>${escapeHtml(subtitle)}</strong>
</div>`;
}

function footer(settings: PrintSettingsView, legend: string) {
  return `<div class="separator"></div>
<p class="center muted">${escapeHtml(settings.footerMessage ?? "Gracias por su preferencia.")}</p>
<p class="center muted">${escapeHtml(legend)}</p>`;
}

function saleRows(order: NonNullable<Awaited<ReturnType<typeof fetchSaleOrder>>>, showPrices: boolean) {
  return order.lines.map((line) => `<tr>
<td>${escapeHtml(line.product.name)}<br/><span class="muted">${escapeHtml(line.product.sku)} · ${escapeHtml(line.product.unit)}</span></td>
<td class="right">${n(line.quantity)}</td>
${showPrices ? `<td class="right">${money(line.unitPrice)}</td><td class="right">${money(line.discountAmount)}</td><td class="right">${money(line.lineSubtotal)}</td>` : ""}
</tr>`).join("");
}

async function fetchSaleOrder(saleOrderId: string) {
  return prisma.saleOrder.findUniqueOrThrow({
    where: { id: saleOrderId },
    include: {
      branch: { select: { id: true, code: true, name: true } },
      customer: { select: { displayName: true, legalName: true, taxId: true, phone: true, address: true } },
      createdBy: { select: { fullName: true, username: true } },
      lines: { include: { product: { select: { sku: true, name: true, unit: true } } }, orderBy: { createdAt: "asc" } },
      payments: {
        where: { status: "POSTED" },
        include: { receivedBy: { select: { fullName: true, username: true } } },
        orderBy: { paidAt: "desc" },
      },
      dispatchTickets: { orderBy: { createdAt: "desc" }, take: 1 },
      transportServices: { orderBy: { createdAt: "desc" }, take: 1 },
    },
  });
}

function saleTicketHtml(order: Awaited<ReturnType<typeof fetchSaleOrder>>, settings: PrintSettingsView, title = "TICKET POS") {
  const payment = order.payments[0] ?? null;
  const cashier = payment?.receivedBy?.fullName || payment?.receivedBy?.username || order.createdBy.fullName || order.createdBy.username;
  const body = `${header(settings, title, order.branch.name)}
<div class="separator"></div>
<p>Orden: <strong>${escapeHtml(order.orderNumber)}</strong></p>
<p>Fecha: ${formatDate(order.createdAt)}</p>
<p>Sucursal: ${escapeHtml(order.branch.code)} - ${escapeHtml(order.branch.name)}</p>
${settings.showCashierName ? `<p>Cajero: ${escapeHtml(cashier)}</p>` : ""}
${settings.showCustomerData && order.customer ? `<p>Cliente: ${escapeHtml(order.customer.displayName)}${order.customer.taxId ? ` · ${escapeHtml(order.customer.taxId)}` : ""}</p>` : ""}
<div class="separator"></div>
<table>
<thead><tr><th>Producto</th><th class="right">Cant</th><th class="right">P.Unit</th><th class="right">Desc</th><th class="right">Total</th></tr></thead>
<tbody>${saleRows(order, true)}</tbody>
</table>
<div class="separator"></div>
<table>
<tr><td>Subtotal</td><td class="right">${money(order.subtotal)}</td></tr>
<tr><td>Descuento</td><td class="right">${money(order.discountTotal)}</td></tr>
${n(order.transportAmount) > 0 ? `<tr><td>Transporte</td><td class="right">${money(order.transportAmount)}</td></tr>` : ""}
<tr><td>Impuestos</td><td class="right">${money(order.taxTotal)}</td></tr>
<tr><td><strong>Total</strong></td><td class="right"><strong>${money(order.grandTotal)}</strong></td></tr>
</table>
${payment ? `<p>Pago: ${escapeHtml(payment.method)} · ${money(payment.amount)}</p>` : ""}
${order.notes ? `<p>Notas: ${escapeHtml(order.notes)}</p>` : ""}
${footer(settings, "Documento operativo / comprobante interno. No sustituye factura fiscal.")}`;
  return documentShell({ title: `${title} ${order.orderNumber}`, settings, body });
}

function deliveryOrderHtml(order: Awaited<ReturnType<typeof fetchSaleOrder>>, settings: PrintSettingsView) {
  const showPrices = settings.showPricesOnDeliveryOrder;
  const transport = order.transportServices[0] ?? null;
  const body = `${header(settings, "ORDEN DE ENTREGA", order.branch.name)}
<div class="separator"></div>
<p>Orden: <strong>${escapeHtml(order.deliveryOrderNumber ?? order.orderNumber)}</strong></p>
<p>Venta: ${escapeHtml(order.orderNumber)}</p>
<p>Fecha: ${formatDate(order.createdAt)}</p>
<p>Sucursal: ${escapeHtml(order.branch.name)}</p>
${settings.showCustomerData && order.customer ? `<p>Cliente: ${escapeHtml(order.customer.displayName)}</p><p>Telefono: ${escapeHtml(order.customer.phone ?? "")}</p><p>Direccion: ${escapeHtml(order.customer.address ?? "")}</p>` : ""}
<p>Pago: ${escapeHtml(order.status)}</p>
<p>Despacho: ${escapeHtml(order.dispatchTickets[0]?.status ?? "PENDIENTE")}</p>
<div class="separator"></div>
<table>
<thead><tr><th>Producto</th><th class="right">Cant</th>${showPrices ? `<th class="right">P.Unit</th><th class="right">Desc</th><th class="right">Total</th>` : ""}</tr></thead>
<tbody>${saleRows(order, showPrices)}</tbody>
</table>
<div class="separator"></div>
<p>Transporte: ${order.requiresTransport ? "Si" : "No"}${transport ? ` · Estado: ${escapeHtml(transport.status)}` : ""}${showPrices && n(order.transportAmount) > 0 ? ` · ${money(order.transportAmount)}` : ""}</p>
<p>Observaciones:</p><br/>
<div class="signatures"><div class="signature">Firma entrega</div><div class="signature">Firma bodega/despacho</div></div>
${footer(settings, "Orden de entrega / no sustituye factura fiscal.")}`;
  return documentShell({ title: `Orden de entrega ${order.orderNumber}`, settings, body });
}

function paymentReceiptHtml(order: Awaited<ReturnType<typeof fetchSaleOrder>>, settings: PrintSettingsView, paymentId?: string | null) {
  const payment = paymentId ? order.payments.find((p) => p.id === paymentId) : order.payments[0];
  const body = `${header(settings, "RECIBO DE PAGO", order.branch.name)}
<div class="separator"></div>
<p>Orden: <strong>${escapeHtml(order.orderNumber)}</strong></p>
<p>Fecha: ${formatDate(payment?.paidAt ?? new Date())}</p>
${settings.showCustomerData && order.customer ? `<p>Cliente: ${escapeHtml(order.customer.displayName)}</p>` : ""}
<p>Metodo: ${escapeHtml(payment?.method ?? "N/D")}</p>
<p>Monto pagado: <strong>${money(payment?.amount ?? order.grandTotal)}</strong></p>
${settings.showCashierName ? `<p>Cajero: ${escapeHtml(payment?.receivedBy?.fullName ?? payment?.receivedBy?.username ?? "")}</p>` : ""}
${footer(settings, "Comprobante interno de pago. No sustituye factura fiscal.")}`;
  return documentShell({ title: `Recibo ${order.orderNumber}`, settings, body });
}

async function fetchTransfer(transferId: string) {
  return prisma.transfer.findUniqueOrThrow({
    where: { id: transferId },
    include: {
      fromBranch: { select: { id: true, code: true, name: true } },
      toBranch: { select: { id: true, code: true, name: true } },
      requestedBy: { select: { fullName: true, username: true } },
      approvedBy: { select: { fullName: true, username: true } },
      lines: { include: { product: { select: { sku: true, name: true, unit: true } } } },
    },
  });
}

function transferHtml(transfer: Awaited<ReturnType<typeof fetchTransfer>>, settings: PrintSettingsView) {
  const rows = transfer.lines.map((line) => `<tr><td>${escapeHtml(line.product.sku)}</td><td>${escapeHtml(line.product.name)}</td><td class="right">${n(line.quantityRequested)}</td><td>${escapeHtml(line.product.unit)}</td></tr>`).join("");
  const body = `${header(settings, "COMPROBANTE DE TRASLADO", transfer.toBranch.name)}
<div class="separator"></div>
<p>Traslado: <strong>${escapeHtml(transfer.transferNumber)}</strong></p>
<p>Estado: ${escapeHtml(transfer.status)}</p>
<p>Fecha: ${formatDate(transfer.createdAt)}</p>
<p>Origen: ${escapeHtml(transfer.fromBranch.code)} - ${escapeHtml(transfer.fromBranch.name)}</p>
<p>Destino: ${escapeHtml(transfer.toBranch.code)} - ${escapeHtml(transfer.toBranch.name)}</p>
<p>Usuario: ${escapeHtml(transfer.requestedBy.fullName ?? transfer.requestedBy.username)}</p>
<div class="separator"></div>
<table><thead><tr><th>SKU</th><th>Producto</th><th class="right">Cant</th><th>Unidad</th></tr></thead><tbody>${rows}</tbody></table>
<div class="signatures"><div class="signature">Entrega origen</div><div class="signature">Recibe destino</div></div>
<div class="signatures"><div class="signature">Transportista</div><div class="signature">Observaciones</div></div>
${footer(settings, "Documento operativo interno de traslado.")}`;
  return documentShell({ title: `Traslado ${transfer.transferNumber}`, settings, body });
}

async function fetchPurchaseOrder(purchaseOrderId: string) {
  return prisma.purchaseOrder.findUniqueOrThrow({
    where: { id: purchaseOrderId },
    include: {
      branch: { select: { id: true, code: true, name: true } },
      createdBy: { select: { fullName: true, username: true } },
      lines: { include: { product: { select: { sku: true, name: true, unit: true } } } },
    },
  });
}

function purchaseReceiptHtml(order: Awaited<ReturnType<typeof fetchPurchaseOrder>>, settings: PrintSettingsView) {
  const rows = order.lines.map((line) => `<tr>
<td>${escapeHtml(line.product.sku)}</td><td>${escapeHtml(line.product.name)}</td><td class="right">${n(line.quantity)}</td>
${settings.showCostData ? `<td class="right">${money(line.finalUnitCost)}</td>` : ""}
</tr>`).join("");
  const body = `${header(settings, "COMPROBANTE DE RECEPCION DE COMPRA", order.branch.name)}
<div class="separator"></div>
<p>Orden: <strong>${escapeHtml(order.orderNumber)}</strong></p>
<p>Proveedor: ${escapeHtml(order.supplier ?? "N/D")}</p>
<p>Sucursal: ${escapeHtml(order.branch.name)}</p>
<p>Fecha: ${formatDate(order.updatedAt)}</p>
<div class="separator"></div>
<table><thead><tr><th>SKU</th><th>Producto</th><th class="right">Cant</th>${settings.showCostData ? `<th class="right">Costo</th>` : ""}</tr></thead><tbody>${rows}</tbody></table>
<div class="signature">Firma de recepcion</div>
${footer(settings, "Documento operativo interno de recepcion de compra.")}`;
  return documentShell({ title: `Recepcion ${order.orderNumber}`, settings, body });
}

function toText(html: string) {
  return html
    .replace(/<style[\s\S]*?<\/style>/gi, "")
    .replace(/<script[\s\S]*?<\/script>/gi, "")
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<\/(p|tr|div|h1|h2|table)>/gi, "\n")
    .replace(/<[^>]+>/g, "")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

function formatResult(format: RenderFormat, html: string, extra: Record<string, unknown>) {
  if (format === "TEXT") return { ...extra, text: toText(html) };
  if (format === "JSON") return { ...extra };
  return { ...extra, html };
}

function parseFormat(format?: string | null): RenderFormat {
  if (format === "TEXT" || format === "JSON") return format;
  return "HTML";
}

export async function renderSaleTicket(input: { saleOrderId: string; branchId?: string; format?: string | null }) {
  const order = await fetchSaleOrder(input.saleOrderId);
  const settings = await getPrintSettings({ branchId: input.branchId ?? order.branchId });
  const html = saleTicketHtml(order, settings);
  return formatResult(parseFormat(input.format), html, { documentType: "SALE_TICKET", orderNumber: order.orderNumber, settings });
}

export async function renderDeliveryOrder(input: { saleOrderId: string; branchId?: string; format?: string | null }) {
  const order = await fetchSaleOrder(input.saleOrderId);
  const settings = await getPrintSettings({ branchId: input.branchId ?? order.branchId });
  const html = deliveryOrderHtml(order, settings);
  return formatResult(parseFormat(input.format), html, { documentType: "DELIVERY_ORDER", orderNumber: order.orderNumber, deliveryOrderNumber: order.deliveryOrderNumber, settings });
}

export async function renderPaymentReceipt(input: { saleOrderId: string; paymentId?: string | null; branchId?: string; format?: string | null }) {
  const order = await fetchSaleOrder(input.saleOrderId);
  const settings = await getPrintSettings({ branchId: input.branchId ?? order.branchId });
  const html = paymentReceiptHtml(order, settings, input.paymentId);
  return formatResult(parseFormat(input.format), html, { documentType: "PAYMENT_RECEIPT", orderNumber: order.orderNumber, settings });
}

export async function renderTransferDocument(input: { transferId: string; branchId?: string; format?: string | null }) {
  const transfer = await fetchTransfer(input.transferId);
  const settings = await getPrintSettings({ branchId: input.branchId ?? transfer.toBranchId });
  const html = transferHtml(transfer, settings);
  return formatResult(parseFormat(input.format), html, { documentType: "TRANSFER_DOCUMENT", transferNumber: transfer.transferNumber, settings });
}

export async function renderPurchaseReceiptDocument(input: { purchaseOrderId: string; branchId?: string; format?: string | null }) {
  const order = await fetchPurchaseOrder(input.purchaseOrderId);
  const settings = await getPrintSettings({ branchId: input.branchId ?? order.branchId });
  const html = purchaseReceiptHtml(order, settings);
  return formatResult(parseFormat(input.format), html, { documentType: "PURCHASE_RECEIPT", orderNumber: order.orderNumber, settings });
}

export async function recordPrintAudit(input: RecordPrintAuditInput) {
  if (input.saleOrderId && ["DELIVERY_ORDER", "PURCHASE_TICKET", "PAYMENT_RECEIPT", "PRODUCTION_ORDER"].includes(input.documentType)) {
    await createPrintLog({
      saleOrderId: input.saleOrderId,
      documentType: input.documentType as DocumentType,
      printedById: input.actorUserId ?? "",
      isReprint: input.isReprint,
      reprintReason: input.reason,
    }).catch(() => undefined);
  }

  await logAuditEvent({
    actorUserId: input.actorUserId,
    branchId: input.branchId,
    module: "printing",
    action: input.isReprint ? "DOCUMENT_REPRINTED" : "DOCUMENT_PRINTED",
    entityType: input.entityType,
    entityId: input.entityId,
    metadataJson: {
      documentType: input.documentType,
      saleOrderId: input.saleOrderId,
      isReprint: input.isReprint ?? false,
      reason: input.reason,
      ...(input.metadataJson ?? {}),
    },
  });
}
