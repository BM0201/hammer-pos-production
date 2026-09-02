import { z } from "zod";

/* ── Policy validators ── */

export const upsertPolicySchema = z.object({
  branchId: z.string().min(1, "Sucursal es requerida"),
  productId: z.string().min(1, "Producto es requerido"),
  reorderPoint: z.number().min(0, "Punto de reorden debe ser ≥ 0"),
  targetQuantity: z.number().positive("Cantidad objetivo debe ser mayor a 0"),
  minQuantity: z.number().min(0).optional().default(0),
  safetyStock: z.number().min(0).optional().default(0),
  preferredSupplier: z.string().nullable().optional(),
  /// Reposición v2: proveedor real (FK) — prioridad sobre preferredSupplier (texto libre legacy)
  preferredSupplierId: z.string().nullable().optional(),
  leadTimeDays: z.number().int().min(0).optional().default(0),
  isActive: z.boolean().optional().default(true),
});

export type UpsertPolicyInput = z.infer<typeof upsertPolicySchema>;

export const bulkPolicySchema = z.object({
  policies: z.array(upsertPolicySchema).min(1, "Debe incluir al menos 1 política").max(500),
});

