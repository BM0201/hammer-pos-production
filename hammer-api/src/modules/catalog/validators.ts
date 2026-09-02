import { z } from "zod";

export const createCategorySchema = z.object({
  code: z.string().min(2).max(32),
  name: z.string().min(2).max(120),
  parentId: z.string().cuid().optional().nullable(),
});

export const updateCategorySchema = z.object({
  code: z.string().min(2).max(32).optional(),
  name: z.string().min(2).max(120).optional(),
  parentId: z.string().cuid().optional().nullable(),
  isActive: z.boolean().optional(),
});

export const createProductSchema = z.object({
  sku: z.string().max(64).optional().nullable(),
  barcode: z.string().max(64).optional().nullable(),
  name: z.string().min(2).max(160),
  description: z.string().max(500).optional().nullable(),
  categoryId: z.string().cuid(),
  unit: z.string().min(1).max(32),
  allowsFraction: z.boolean().default(false),
  standardSalePrice: z.coerce.number().positive(),
  isTimber: z.boolean().default(false),
});

export const updateProductSchema = z.object({
  sku: z.string().max(64).optional(),
  skuUpdateMode: z.enum(["KEEP_CURRENT", "USE_SUGGESTED"]).optional(),
  suggestedSku: z.string().max(64).optional(),
  barcode: z.string().max(64).optional().nullable(),
  name: z.string().min(2).max(160).optional(),
  description: z.string().max(500).optional().nullable(),
  categoryId: z.string().cuid().optional(),
  unit: z.string().min(1).max(32).optional(),
  allowsFraction: z.boolean().optional(),
  standardSalePrice: z.coerce.number().positive().optional(),
  isActive: z.boolean().optional(),
  globalCost: z.coerce.number().nonnegative().optional().nullable(),
  // "asegura el motor de mejor manera" — igual que en movimientos de
  // inventario (createInventoryMovementSchema), el override explícito para
  // cuando SUSPECTED_PACKAGE_COST_AS_UNIT_COST dispara pero el costo alto
  // es correcto de verdad.
  allowHighUnitCost: z.boolean().optional(),
  // "el precio de venta no se mueva solo" — confirma explícitamente un
  // standardSalePrice que se desvía >15% del precio implícito de fusión
  // (PRICE_DEVIATES_FROM_FUSION), mismo patrón que allowHighUnitCost.
  overridePriceConfirmed: z.boolean().optional(),
});
