import { z } from "zod";

export const catalogInventoryQuerySchema = z.object({
  q: z.string().trim().optional(),
  branchId: z.string().cuid().optional(),
  categoryId: z.string().cuid().optional(),
  filter: z.enum(["LOW_STOCK", "ZERO_STOCK", "NEGATIVE_STOCK", "NO_COST", "NO_PRICE"]).optional(),
  productsCursor: z.string().cuid().optional(),
  balancesCursor: z.string().cuid().optional(),
  movementsCursor: z.string().cuid().optional(),
  limit: z.coerce.number().int().min(1).max(500).default(100),
});

export const updateBranchProductSettingSchema = z.object({
  branchId: z.string().cuid(),
  productId: z.string().cuid(),
  isAvailable: z.boolean().optional(),
  minStock: z.coerce.number().nonnegative().optional().nullable(),
  maxStock: z.coerce.number().nonnegative().optional().nullable(),
  reorderPoint: z.coerce.number().nonnegative().optional().nullable(),
  branchCost: z.coerce.number().nonnegative().optional().nullable(),
  branchPrice: z.coerce.number().nonnegative().optional().nullable(),
}).refine((data) => Object.keys(data).some((key) => !["branchId", "productId"].includes(key)), {
  message: "Debes enviar al menos un campo configurable.",
});

export type CatalogInventoryQuery = z.infer<typeof catalogInventoryQuerySchema>;
export type UpdateBranchProductSettingInput = z.infer<typeof updateBranchProductSettingSchema>;
