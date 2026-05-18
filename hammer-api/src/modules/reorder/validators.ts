import { z } from "zod";

/* ── Reorder Alert enums (match Prisma) ── */

export const REORDER_ALERT_TYPES = ["PURCHASE", "TRANSFER", "BOTH"] as const;
export const REORDER_ALERT_STATUSES = [
  "OPEN",
  "DISMISSED",
  "CONVERTED_TO_PURCHASE_ORDER",
  "CONVERTED_TO_TRANSFER",
] as const;

export const ALERT_TYPE_LABELS: Record<string, string> = {
  PURCHASE: "Compra externa",
  TRANSFER: "Transferencia interna",
  BOTH: "Compra + Transferencia",
};

export const ALERT_STATUS_LABELS: Record<string, string> = {
  OPEN: "Abierta",
  DISMISSED: "Descartada",
  CONVERTED_TO_PURCHASE_ORDER: "Convertida a PO",
  CONVERTED_TO_TRANSFER: "Convertida a Transfer",
};

/* ── Policy validators ── */

export const upsertPolicySchema = z.object({
  branchId: z.string().min(1, "Sucursal es requerida"),
  productId: z.string().min(1, "Producto es requerido"),
  reorderPoint: z.number().min(0, "Punto de reorden debe ser ≥ 0"),
  targetQuantity: z.number().positive("Cantidad objetivo debe ser mayor a 0"),
  minQuantity: z.number().min(0).optional().default(0),
  safetyStock: z.number().min(0).optional().default(0),
  preferredSupplier: z.string().nullable().optional(),
  leadTimeDays: z.number().int().min(0).optional().default(0),
  isActive: z.boolean().optional().default(true),
});

export type UpsertPolicyInput = z.infer<typeof upsertPolicySchema>;

export const bulkPolicySchema = z.object({
  policies: z.array(upsertPolicySchema).min(1, "Debe incluir al menos 1 política").max(500),
});

/* ── Evaluate params ── */

export const evaluateParamsSchema = z.object({
  branchId: z.string().min(1).optional(),
});

/* ── Alert filter params ── */

export const alertFilterSchema = z.object({
  branchId: z.string().optional(),
  status: z.enum(REORDER_ALERT_STATUSES).optional(),
  alertType: z.enum(REORDER_ALERT_TYPES).optional(),
  productId: z.string().optional(),
  limit: z.coerce.number().int().min(1).max(500).optional().default(100),
  offset: z.coerce.number().int().min(0).optional().default(0),
});
