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
  // Nace como otra presentación de un producto existente (ej. QUINTAL de una VARILLA).
  presentationOf: z.object({
    baseProductId: z.string().cuid(),
    saleUnit: z.string().min(1).max(32),
    factor: z.coerce.number().positive(),
  }).optional(),
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

// prompt-codigos-y-duplicados.md Fase 1 — varios códigos por producto.
export const addProductBarcodeSchema = z.object({
  code: z.string().min(1).max(64),
  kind: z.enum(["FACTORY", "INTERNAL", "SUPPLIER"]),
  // Fase 2.4 (prompt-codigos-editar-eliminar.md) — "aprender de lo elegido": presente solo cuando el código se vinculó desde una tarjeta de sugerencia.
  suggestion: z.object({
    rank: z.number().int().positive(),
    reasons: z.array(z.object({ code: z.string(), text: z.string() })),
  }).optional(),
});

export const moveProductBarcodeSchema = z.object({
  toProductId: z.string().cuid(),
});

// prompt-codigos-editar-eliminar.md Fase 1.1 — editar código y/o tipo (al menos uno de los dos).
export const updateProductBarcodeSchema = z.object({
  code: z.string().min(1).max(64).optional(),
  kind: z.enum(["FACTORY", "INTERNAL", "SUPPLIER"]).optional(),
}).refine((data) => data.code !== undefined || data.kind !== undefined, { message: "Nada que actualizar." });

// Fase 1.2 — "Deshacer" tras quitar un código.
export const restoreProductBarcodeSchema = z.object({
  code: z.string().min(1).max(64),
  kind: z.enum(["FACTORY", "INTERNAL", "SUPPLIER"]),
  makePrimary: z.boolean(),
});

// Fase 1.2 — quitar en lote, máximo 200 por llamada.
export const bulkRemoveBarcodesSchema = z.object({
  ids: z.array(z.string().cuid()).min(1).max(200),
  reason: z.string().trim().min(1).max(300),
});

// prompt-codigos-y-duplicados.md Fase 3 — unificar productos duplicados.
export const previewMergeSchema = z.object({
  survivingProductId: z.string().cuid(),
  mergedProductId: z.string().cuid(),
  confirmUnitMismatch: z.boolean().optional(),
});

export const executeMergeSchema = z.object({
  survivingProductId: z.string().cuid(),
  mergedProductId: z.string().cuid(),
  confirmedMergedSku: z.string().min(1),
  confirmUnitMismatch: z.boolean().optional(),
  reason: z.string().max(500).optional(),
});

// prompt-codigos-y-duplicados.md Fase 4 — pantalla de posibles duplicados.
export const dismissDuplicatePairSchema = z.object({
  productAId: z.string().cuid(),
  productBId: z.string().cuid(),
  reason: z.string().max(500).optional(),
});
