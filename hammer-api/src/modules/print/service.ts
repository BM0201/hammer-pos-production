/**
 * Módulo de servicio para configuración de impresión, plantillas y logs.
 */
import { prisma } from "@/lib/prisma";
import type { PrinterMode, PaperWidth, DocumentType, Prisma } from "@prisma/client";
import { logAuditEvent } from "@/modules/audit/service";

// ─── PrintSettings ──────────────────────────────────────────────────────────

export async function getPrintSettingsByBranch(branchId: string) {
  return prisma.printSettings.findUnique({ where: { branchId } });
}

export async function getAllPrintSettings() {
  return prisma.printSettings.findMany({
    include: { branch: { select: { id: true, code: true, name: true } } },
    orderBy: { createdAt: "asc" },
  });
}

export type UpsertPrintSettingsInput = {
  branchId: string;
  cashRegisterId?: string | null;
  name?: string;
  printerName?: string | null;
  printerMode?: PrinterMode;
  paperWidth?: PaperWidth;
  fontSize?: number;
  logoUrl?: string | null;
  footerText?: string | null;
  autoPrint?: boolean;
  autoPrintDelivery?: boolean;
  copies?: number;
  copiesDeliveryOrder?: number;
  cutPaper?: boolean;
  openDrawer?: boolean;
  showQr?: boolean;
  businessName?: string | null;
  businessLegalName?: string | null;
  taxId?: string | null;
  address?: string | null;
  phone?: string | null;
  showPricesOnDeliveryOrder?: boolean;
  showCostData?: boolean;
  showCashierName?: boolean;
  showCustomerData?: boolean;
  ticketTemplate?: string | null;
  deliveryTemplate?: string | null;
  receiptTemplate?: string | null;
  isDefault?: boolean;
  isActive?: boolean;
  actorUserId?: string;
};

export async function upsertPrintSettings(input: UpsertPrintSettingsInput) {
  const { branchId, actorUserId, ...data } = input;
  const previous = await prisma.printSettings.findUnique({ where: { branchId } });
  const result = await prisma.printSettings.upsert({
    where: { branchId },
    create: { branchId, ...data },
    update: data,
  });

  await logAuditEvent({
    actorUserId,
    branchId,
    module: "printing",
    action: previous ? "PRINT_SETTINGS_UPDATED" : "PRINT_SETTINGS_CREATED",
    entityType: "PrintSettings",
    entityId: result.id,
    metadataJson: { previous, next: result },
  });

  return result;
}

// ─── DocumentTemplate ───────────────────────────────────────────────────────

export async function listDocumentTemplates(filters?: { documentType?: DocumentType; isActive?: boolean }) {
  const where: Prisma.DocumentTemplateWhereInput = {};
  if (filters?.documentType) where.documentType = filters.documentType;
  if (filters?.isActive !== undefined) where.isActive = filters.isActive;

  return prisma.documentTemplate.findMany({
    where,
    include: { createdBy: { select: { id: true, fullName: true, username: true } } },
    orderBy: { createdAt: "desc" },
  });
}

export type CreateDocumentTemplateInput = {
  name: string;
  documentType: DocumentType;
  description?: string;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  templateContent: any;
  isDefault?: boolean;
  createdByUserId: string;
};

export async function createDocumentTemplate(input: CreateDocumentTemplateInput) {
  // Si es default, quitar default de otras del mismo tipo
  if (input.isDefault) {
    await prisma.documentTemplate.updateMany({
      where: { documentType: input.documentType, isDefault: true },
      data: { isDefault: false },
    });
  }
  return prisma.documentTemplate.create({
    data: input,
    include: { createdBy: { select: { id: true, fullName: true, username: true } } },
  });
}

// ─── DocumentPrintLog ───────────────────────────────────────────────────────

export type CreatePrintLogInput = {
  saleOrderId: string;
  documentType: DocumentType;
  printedById: string;
  isReprint?: boolean;
  reprintReason?: string;
};

export async function createPrintLog(input: CreatePrintLogInput) {
  return prisma.documentPrintLog.create({
    data: input,
  });
}

export async function getPrintLogsForOrder(saleOrderId: string) {
  return prisma.documentPrintLog.findMany({
    where: { saleOrderId },
    include: { printedBy: { select: { id: true, fullName: true, username: true } } },
    orderBy: { printedAt: "desc" },
  });
}
