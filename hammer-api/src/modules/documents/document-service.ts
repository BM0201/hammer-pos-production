/**
 * Servicio de generación de documentos comerciales.
 * FASE 3 — H.A.M.M.E.R. POS/ERP
 *
 * Orquesta la generación de HTML para diferentes tipos de documentos.
 */

import { prisma } from "@/lib/prisma";
import type { DocumentType } from "@prisma/client";
import { generateDeliveryOrderHtml } from "./generators/delivery-order";
import { generateManualInvoiceReceiptHtml } from "./generators/manual-invoice-receipt";
import type { DocumentOrderData, PrintSettingsData, ManualInvoiceData, DocumentGenerationOptions } from "./types";

// ─── Sequence generation for delivery order numbers ──────────────────────────

export async function generateDeliveryOrderNumber(branchCode: string): Promise<string> {
  const prefix = `OE-${branchCode}`;
  const today = new Date();
  const dateStr = `${today.getFullYear()}${String(today.getMonth() + 1).padStart(2, "0")}${String(today.getDate()).padStart(2, "0")}`;

  // Contar órdenes de entrega del día para la sucursal
  const startOfDay = new Date(today.getFullYear(), today.getMonth(), today.getDate());
  const endOfDay = new Date(startOfDay.getTime() + 24 * 60 * 60 * 1000);

  const count = await prisma.saleOrder.count({
    where: {
      deliveryOrderNumber: { startsWith: `${prefix}-${dateStr}` },
      deliveryOrderIssuedAt: { gte: startOfDay, lt: endOfDay },
    },
  });

  const seq = String(count + 1).padStart(4, "0");
  return `${prefix}-${dateStr}-${seq}`;
}

// ─── Build document data from order ─────────────────────────────────────────

export async function buildOrderDocumentData(orderId: string): Promise<DocumentOrderData> {
  const order = await prisma.saleOrder.findUniqueOrThrow({
    where: { id: orderId },
    include: {
      branch: { select: { name: true, code: true } },
      customer: { select: { displayName: true, taxId: true } },
      createdBy: { select: { fullName: true } },
      lines: {
        include: { product: { select: { name: true, sku: true } } },
      },
      payments: {
        where: { status: "POSTED" },
        orderBy: { createdAt: "desc" },
        take: 1,
        select: { method: true, createdAt: true },
      },
    },
  });

  const latestPayment = order.payments[0] ?? null;

  return {
    orderNumber: order.orderNumber,
    deliveryOrderNumber: order.deliveryOrderNumber,
    branchName: order.branch.name,
    branchCode: order.branch.code,
    customerName: order.customer?.displayName ?? null,
    customerRuc: order.customer?.taxId ?? null,
    sellerName: order.createdBy.fullName,
    subtotal: Number(order.subtotal),
    discountTotal: Number(order.discountTotal),
    taxTotal: Number(order.taxTotal),
    grandTotal: Number(order.grandTotal),
    requiresTransport: order.requiresTransport,
    transportAmount: Number(order.transportAmount),
    paymentMethod: latestPayment?.method ?? null,
    lines: order.lines.map((l) => ({
      sku: l.product.sku,
      name: l.product.name,
      quantity: Number(l.quantity),
      unitPrice: Number(l.unitPrice),
      discountAmount: Number(l.discountAmount),
      lineSubtotal: Number(l.lineSubtotal),
    })),
    createdAt: order.createdAt.toISOString(),
    paidAt: latestPayment?.createdAt?.toISOString(),
    notes: order.notes ?? undefined,
  };
}

export async function getPrintSettingsForBranch(branchId: string): Promise<PrintSettingsData> {
  const settings = await prisma.printSettings.findUnique({ where: { branchId } });
  return {
    paperWidth: settings?.paperWidth ?? "W80MM",
    fontSize: settings?.fontSize ?? 12,
    logoUrl: settings?.logoUrl ?? null,
    footerText: settings?.footerText ?? null,
    showQr: settings?.showQr ?? false,
  };
}

// ─── HTML Generation ────────────────────────────────────────────────────────

export function generateDocumentHtml(
  documentType: DocumentType,
  options: DocumentGenerationOptions,
): string {
  switch (documentType) {
    case "DELIVERY_ORDER":
    case "PURCHASE_TICKET":
      return generateDeliveryOrderHtml(options);
    case "PAYMENT_RECEIPT":
      return generateManualInvoiceReceiptHtml(options);
    case "PRODUCTION_ORDER":
      // Placeholder para futuro
      return generateDeliveryOrderHtml(options);
    default:
      return generateDeliveryOrderHtml(options);
  }
}

// ─── Issue delivery order ───────────────────────────────────────────────────

export async function issueDeliveryOrder(orderId: string): Promise<string> {
  const order = await prisma.saleOrder.findUniqueOrThrow({
    where: { id: orderId },
    select: { deliveryOrderNumber: true, branchId: true, branch: { select: { code: true } } },
  });

  // Si ya tiene número, retornarlo
  if (order.deliveryOrderNumber) return order.deliveryOrderNumber;

  const doNumber = await generateDeliveryOrderNumber(order.branch.code);

  await prisma.saleOrder.update({
    where: { id: orderId },
    data: {
      deliveryOrderNumber: doNumber,
      deliveryOrderIssuedAt: new Date(),
    },
  });

  return doNumber;
}

// ─── Register manual invoice ────────────────────────────────────────────────

export type RegisterManualInvoiceInput = {
  orderId: string;
  series: string;
  number: string;
  date: string;
  customerName: string;
  customerRuc: string;
  notes?: string;
  registeredByUserId: string;
};

export async function registerManualInvoice(input: RegisterManualInvoiceInput) {
  return prisma.saleOrder.update({
    where: { id: input.orderId },
    data: {
      documentMode: "MANUAL_INVOICE_REGISTERED",
      requiresManualInvoice: true,
      manualInvoiceSeries: input.series,
      manualInvoiceNumber: input.number,
      manualInvoiceDate: new Date(input.date),
      manualInvoiceCustomerName: input.customerName,
      manualInvoiceCustomerRuc: input.customerRuc,
      manualInvoiceNotes: input.notes,
      manualInvoiceStatus: "REGISTERED",
      manualInvoiceRegisteredById: input.registeredByUserId,
      manualInvoiceRegisteredAt: new Date(),
    },
    select: {
      id: true,
      orderNumber: true,
      manualInvoiceSeries: true,
      manualInvoiceNumber: true,
      manualInvoiceStatus: true,
      manualInvoiceDate: true,
      manualInvoiceCustomerName: true,
      manualInvoiceCustomerRuc: true,
    },
  });
}
