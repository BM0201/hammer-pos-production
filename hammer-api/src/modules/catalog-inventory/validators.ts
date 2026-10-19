import { z } from "zod";

export const catalogInventoryQuerySchema = z.object({
  q: z.string().trim().optional(),
  branchId: z.string().cuid().optional(),
  categoryId: z.string().cuid().optional(),
  filter: z.enum(["LOW_STOCK", "ZERO_STOCK", "NEGATIVE_STOCK", "NO_COST", "NO_PRICE", "NO_BRANCH_PRICE", "NO_CODE"]).optional(),
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(200).default(50),
});

export const updateBranchProductSettingSchema = z.object({
  branchId: z.string().cuid(),
  productId: z.string().cuid(),
  isAvailable: z.boolean().optional(),
  minStock: z.coerce.number().nonnegative().optional().nullable(),
  maxStock: z.coerce.number().nonnegative().optional().nullable(),
  reorderPoint: z.coerce.number().nonnegative().optional().nullable(),
  branchPrice: z.coerce.number().nonnegative().optional().nullable(),
  minPrice: z.coerce.number().nonnegative().optional().nullable(),
  wholesalePrice: z.coerce.number().nonnegative().optional().nullable(),
  marginPercent: z.coerce.number().optional().nullable(),
  /** prompt-costos-precios-fusion.md §2.2: confirma un override de precio en
   * un miembro derivado que se desvía del precio implícito de fusión más
   * allá del umbral (FUSION_PRICE_OVERRIDE_THRESHOLD). */
  overridePriceConfirmed: z.boolean().optional(),
  /** Fase 3 (prompt-motor-precios-lote-herencia-gobierno.md) — motivo de la excepción, opcional acá (la pantalla de la ficha del producto lo exige obligatorio con su propia validación). */
  priceExceptionReason: z.string().max(500).optional().nullable(),
}).refine((data) => Object.keys(data).some((key) => !["branchId", "productId"].includes(key)), {
  message: "Debes enviar al menos un campo configurable.",
});

export const massDeleteProductsSchema = z.object({
  confirmation: z.string(),
  expectedCount: z.coerce.number().int().min(1),
});

export type CatalogInventoryQuery = z.infer<typeof catalogInventoryQuerySchema>;
export type UpdateBranchProductSettingInput = z.infer<typeof updateBranchProductSettingSchema>;
export type MassDeleteProductsInput = z.infer<typeof massDeleteProductsSchema>;

/** prompt-inventario-v3.md Fase 1.2 — endpoints nuevos por sección, leyendo de ProductBranchState/ProductCatalogState. */
export const inventoryProductsQuerySchema = z.object({
  branchId: z.string().cuid(),
  categoryId: z.string().cuid().optional(),
  q: z.string().trim().optional(),
  view: z.enum(["ALL", "NEGATIVE", "LOW", "ZERO", "NO_COST", "NO_PRICE", "NO_CODE", "NO_MOVEMENT_90D", "COST_EQ_PRICE", "INACTIVE"]).optional(),
  sort: z.enum(["name", "stock", "margin", "value", "sales90d", "lastMovement"]).optional(),
  cursor: z.string().optional(),
  limit: z.coerce.number().int().min(1).max(100).optional(),
});
export type InventoryProductsQuery = z.infer<typeof inventoryProductsQuerySchema>;

export const inventoryOverviewQuerySchema = z.object({
  branchId: z.string().cuid(),
});

export const inventoryStockQuerySchema = z.object({
  branchIds: z.string().min(1).transform((v) => v.split(",").filter(Boolean)),
  categoryId: z.string().cuid().optional(),
  q: z.string().trim().optional(),
});

export const inventoryMovementsQuerySchema = z.object({
  branchId: z.string().cuid().optional(),
  productId: z.string().cuid().optional(),
  cursor: z.string().optional(),
  limit: z.coerce.number().int().min(1).max(100).optional(),
});

export const inventoryCategoriesQuerySchema = z.object({
  branchId: z.string().cuid(),
});
