import { z } from "zod";

/**
 * Timber Module Validators (Timber Improvements)
 *
 * BUG FIX: Added max value constraints to prevent unreasonable inputs.
 * BUG FIX: Added min pieces = 1 for trip lines (0 pieces is meaningless).
 * BUG FIX: Added max cost validation.
 */

export const timberDimensionsSchema = z.object({
  thickness: z.number().int().positive("El grosor debe ser mayor a 0").max(24, "Grosor máximo: 24 pulgadas"),
  width: z.number().int().positive("El ancho debe ser mayor a 0").max(48, "Ancho máximo: 48 pulgadas"),
  length: z.number().int().positive("El largo debe ser mayor a 0").max(40, "Largo máximo: 40 pies"),
});

export const timberPricingSchema = z.object({
  costPerFoot: z.number().positive("Costo por pie debe ser mayor a 0").max(10000).optional(),
  pricePerInchTabla: z.number().nonnegative("Precio tabla debe ser ≥ 0").max(10000).optional(),
  pricePerInchTablilla: z.number().nonnegative("Precio tablilla debe ser ≥ 0").max(10000).optional(),
  pricePerInchCuadro: z.number().nonnegative("Precio cuadro debe ser ≥ 0").max(10000).optional(),
});

export const createTimberProductSchema = z.object({
  name: z.string().min(1, "Nombre es requerido").max(200),
  sku: z.string().min(1).max(50).optional(),
  thickness: z.number().int().positive("Grosor debe ser mayor a 0"),
  width: z.number().int().positive("Ancho debe ser mayor a 0"),
  length: z.number().int().positive("Largo debe ser mayor a 0"),
  categoryId: z.string().min(1, "Categoría es requerida"),
  branchId: z.string().optional(),
  initialQuantity: z.number().int().nonnegative().optional().default(0),
});

export const updateTimberProductSchema = z.object({
  name: z.string().min(1).max(200).optional(),
  thickness: z.number().int().positive().optional(),
  width: z.number().int().positive().optional(),
  length: z.number().int().positive().optional(),
});

export const calculateTimberSchema = z.object({
  thickness: z.number().int().positive(),
  width: z.number().int().positive(),
  length: z.number().int().positive(),
  quantity: z.number().int().positive("Cantidad debe ser mayor a 0").optional().default(1),
  // Optional custom pricing
  costPerFoot: z.number().positive().optional(),
  pricePerInchTabla: z.number().nonnegative().optional(),
  pricePerInchTablilla: z.number().nonnegative().optional(),
  pricePerInchCuadro: z.number().nonnegative().optional(),
});

/* ── Timber Trip (Viaje de Madera) ── */

export const timberTripLineSchema = z.object({
  thickness: z.number().int().positive("Grosor debe ser mayor a 0"),
  width: z.number().int().positive("Ancho debe ser mayor a 0"),
  length: z.number().int().positive("Largo debe ser mayor a 0"),
  // BUG FIX: Changed from nonnegative to positive — 0 pieces is meaningless in a trip line
  pieces: z.number().int().positive("Piezas debe ser mayor a 0").max(100000, "Máximo 100,000 piezas por línea"),
  priceGroup: z.enum(["TABLA", "TABLILLA", "CUADRO"]).optional(),
});

export const createTimberTripSchema = z.object({
  destinationBranchId: z.string().min(1, "Sucursal destino es requerida"),
  woodTripTotalCost: z.number().nonnegative("Costo total del viaje debe ser ≥ 0").max(100000000).default(0),
  supplierName: z.string().max(200).optional(),
  origin: z.string().max(200).optional(),
  notes: z.string().max(2000).optional(),
  // Optional pricing overrides
  pricePerInchTabla: z.number().nonnegative().optional(),
  pricePerInchTablilla: z.number().nonnegative().optional(),
  pricePerInchCuadro: z.number().nonnegative().optional(),
  lines: z.array(timberTripLineSchema).min(1, "Debe tener al menos una línea"),
});

export const updateTimberTripSchema = z.object({
  woodTripTotalCost: z.number().nonnegative().max(100000000).optional(),
  supplierName: z.string().max(200).optional().nullable(),
  origin: z.string().max(200).optional().nullable(),
  notes: z.string().max(2000).optional().nullable(),
  pricePerInchTabla: z.number().nonnegative().optional(),
  pricePerInchTablilla: z.number().nonnegative().optional(),
  pricePerInchCuadro: z.number().nonnegative().optional(),
  lines: z.array(timberTripLineSchema).min(1).optional(),
});

export const updateTimberPricingConfigSchema = z.object({
  costPerFoot: z.number().positive("Costo por pie debe ser mayor a 0").max(10000),
  pricePerInchTabla: z.number().nonnegative("Precio tabla debe ser ≥ 0").max(10000),
  pricePerInchTablilla: z.number().nonnegative("Precio tablilla debe ser ≥ 0").max(10000),
  pricePerInchCuadro: z.number().nonnegative("Precio cuadro debe ser ≥ 0").max(10000),
});

export type CreateTimberProductInput = z.infer<typeof createTimberProductSchema>;
export type UpdateTimberProductInput = z.infer<typeof updateTimberProductSchema>;
export type CalculateTimberInput = z.infer<typeof calculateTimberSchema>;
export type CreateTimberTripInput = z.infer<typeof createTimberTripSchema>;
export type UpdateTimberTripInput = z.infer<typeof updateTimberTripSchema>;
export type UpdateTimberPricingConfigInput = z.infer<typeof updateTimberPricingConfigSchema>;
