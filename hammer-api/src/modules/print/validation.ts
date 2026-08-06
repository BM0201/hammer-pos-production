import { z } from "zod";

const printerModeSchema = z.enum(["BROWSER_PRINT", "QZ_TRAY", "NETWORK_ESCPOS", "PDF_ONLY", "BROWSER", "THERMAL_BROWSER", "ESC_POS_FUTURE"]);
const paperWidthSchema = z.enum(["W58MM", "W80MM", "A4", "THERMAL_58MM", "THERMAL_80MM"]);

export function normalizePrinterMode(value?: z.infer<typeof printerModeSchema>) {
  if (value === "BROWSER" || value === "THERMAL_BROWSER") return "BROWSER_PRINT" as const;
  if (value === "ESC_POS_FUTURE") return "NETWORK_ESCPOS" as const;
  return value ?? "BROWSER_PRINT";
}

export function normalizePaperWidth(value?: z.infer<typeof paperWidthSchema>) {
  if (value === "THERMAL_58MM") return "W58MM" as const;
  if (value === "THERMAL_80MM") return "W80MM" as const;
  return value ?? "W80MM";
}

export const upsertPrintSettingsSchema = z.object({
  branchId: z.string().min(1),
  cashRegisterId: z.string().nullable().optional(),
  name: z.string().min(1).max(100).optional(),
  printerName: z.string().nullable().optional(),
  printerMode: printerModeSchema.optional().transform(normalizePrinterMode),
  paperWidth: paperWidthSchema.optional().transform(normalizePaperWidth),
  fontSize: z.number().int().min(8).max(24).optional(),
  logoUrl: z.string().nullable().optional(),
  footerText: z.string().nullable().optional(),
  autoPrint: z.boolean().optional(),
  autoPrintDelivery: z.boolean().optional(),
  copies: z.number().int().min(1).max(5).optional(),
  copiesDeliveryOrder: z.number().int().min(1).max(5).optional(),
  cutPaper: z.boolean().optional(),
  openDrawer: z.boolean().optional(),
  showQr: z.boolean().optional(),
  businessName: z.string().max(120).nullable().optional(),
  businessLegalName: z.string().max(160).nullable().optional(),
  taxId: z.string().max(60).nullable().optional(),
  address: z.string().max(240).nullable().optional(),
  phone: z.string().max(80).nullable().optional(),
  showPricesOnDeliveryOrder: z.boolean().optional(),
  showCostData: z.boolean().optional(),
  showCashierName: z.boolean().optional(),
  showCustomerData: z.boolean().optional(),
  ticketTemplate: z.string().nullable().optional(),
  deliveryTemplate: z.string().nullable().optional(),
  receiptTemplate: z.string().nullable().optional(),
  isDefault: z.boolean().optional(),
  isActive: z.boolean().optional(),
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
