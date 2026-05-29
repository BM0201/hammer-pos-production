import { z } from "zod";

export const upsertPrintSettingsSchema = z.object({
  branchId: z.string().min(1),
  printerName: z.string().nullable().optional(),
  printerMode: z.enum(["BROWSER_PRINT", "QZ_TRAY", "NETWORK_ESCPOS", "PDF_ONLY"]).optional(),
  paperWidth: z.enum(["W58MM", "W80MM", "A4"]).optional(),
  fontSize: z.number().int().min(8).max(24).optional(),
  logoUrl: z.string().nullable().optional(),
  footerText: z.string().nullable().optional(),
  autoPrint: z.boolean().optional(),
  copies: z.number().int().min(1).max(5).optional(),
  cutPaper: z.boolean().optional(),
  openDrawer: z.boolean().optional(),
  showQr: z.boolean().optional(),
});

export const createDocumentTemplateSchema = z.object({
  name: z.string().min(1).max(100),
  documentType: z.enum(["DELIVERY_ORDER", "PURCHASE_TICKET", "PAYMENT_RECEIPT", "PRODUCTION_ORDER"]),
  description: z.string().optional(),
  templateContent: z.record(z.unknown()),
  isDefault: z.boolean().optional(),
});

export const createPrintLogSchema = z.object({
  documentType: z.enum(["DELIVERY_ORDER", "PURCHASE_TICKET", "PAYMENT_RECEIPT", "PRODUCTION_ORDER"]),
  isReprint: z.boolean().optional(),
  reprintReason: z.string().optional(),
});
