import { z } from "zod";

/**
 * Timber Module Validators (Timber Improvements)
 *
 * BUG FIX: Added max value constraints to prevent unreasonable inputs.
 * BUG FIX: Added min pieces = 1 for trip lines (0 pieces is meaningless).
 * BUG FIX: Added max cost validation.
 */

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

// Madera v2 Fase 1.1 — gastos del viaje (aditivo, todos opcionales, default 0).
export const timberTripExpensesSchema = z.object({
  freightAmount: z.number().nonnegative("El flete debe ser ≥ 0").max(10000000).optional(),
  fuelAmount: z.number().nonnegative("El combustible debe ser ≥ 0").max(10000000).optional(),
  perDiemAmount: z.number().nonnegative("Los viáticos deben ser ≥ 0").max(10000000).optional(),
  permitsAmount: z.number().nonnegative("Los permisos deben ser ≥ 0").max(10000000).optional(),
  otherExpensesAmount: z.number().nonnegative("Otros gastos deben ser ≥ 0").max(10000000).optional(),
});

export const timberPricePolicySchema = z.enum(["RECALC_FROM_PRICE_PER_INCH", "COST_ONLY", "TARGET_MARGIN"]);

export const createTimberTripSchema = z.object({
  destinationBranchId: z.string().min(1, "Sucursal destino es requerida"),
  woodTripTotalCost: z.number().nonnegative("Costo total del viaje debe ser ≥ 0").max(100000000).default(0),
  // PER_FOOT mode — when provided (> 0), the cost per board foot is used directly and the
  // trip total is derived (woodTripTotalCost = costPerFoot × total de pies). Overrides woodTripTotalCost.
  costPerFoot: z.number().positive("Precio por pie debe ser mayor a 0").max(100000).optional(),
  supplierName: z.string().max(200).optional(),
  origin: z.string().max(200).optional(),
  notes: z.string().max(2000).optional(),
  // Optional pricing overrides
  pricePerInchTabla: z.number().nonnegative().optional(),
  pricePerInchTablilla: z.number().nonnegative().optional(),
  pricePerInchCuadro: z.number().nonnegative().optional(),
  // Madera v2
  expenses: timberTripExpensesSchema.optional(),
  invoicedFeet: z.number().positive("Los pies de factura deben ser mayor a 0").max(10000000).optional(),
  pricePolicy: timberPricePolicySchema.optional(),
  lines: z.array(timberTripLineSchema).min(1, "Debe tener al menos una línea"),
});

export const updateTimberTripSchema = z.object({
  woodTripTotalCost: z.number().nonnegative().max(100000000).optional(),
  // PER_FOOT mode (see createTimberTripSchema)
  costPerFoot: z.number().positive("Precio por pie debe ser mayor a 0").max(100000).optional(),
  supplierName: z.string().max(200).optional().nullable(),
  origin: z.string().max(200).optional().nullable(),
  notes: z.string().max(2000).optional().nullable(),
  pricePerInchTabla: z.number().nonnegative().optional(),
  pricePerInchTablilla: z.number().nonnegative().optional(),
  pricePerInchCuadro: z.number().nonnegative().optional(),
  // Madera v2
  expenses: timberTripExpensesSchema.optional(),
  invoicedFeet: z.number().positive("Los pies de factura deben ser mayor a 0").max(10000000).optional().nullable(),
  pricePolicy: timberPricePolicySchema.optional(),
  // prompt-timber-borrador-bugs.md, BUG 2 — SIN el .min(1) que sigue
  // teniendo createTimberTripSchema (arriba). El autoguardado de un
  // DRAFT (timber-workspace.tsx save()) SIEMPRE manda `lines`, incluso
  // vacío, mientras el usuario edita (quitó todas las líneas antes de
  // volver a agregar, por ejemplo) — eso es un estado real e intermedio
  // válido, no un error de payload. La exigencia de "al menos 1 línea"
  // para poder AVANZAR ya existe donde corresponde: confirmTimberTrip
  // (TRIP_HAS_NO_LINES), al momento de confirmar de verdad.
  lines: z.array(timberTripLineSchema).optional(),
});

// Madera v2 Fase 4 — configuración como datos: tabla de cubicación, reglas de ancho,
// margen objetivo/redondeo, tolerancia de conciliación y flags de alerta.
export const cubicationRowSchema = z.object({
  lengthFeet: z.number().positive().max(100),
  varas: z.number().positive().max(50),
  forceCuadro: z.boolean(),
});

export const updateTimberPricingConfigSchema = z.object({
  costPerFoot: z.number().positive("Costo por pie debe ser mayor a 0").max(10000),
  pricePerInchTabla: z.number().nonnegative("Precio tabla debe ser ≥ 0").max(10000),
  pricePerInchTablilla: z.number().nonnegative("Precio tablilla debe ser ≥ 0").max(10000),
  pricePerInchCuadro: z.number().nonnegative("Precio cuadro debe ser ≥ 0").max(10000),
  cubicationTable: z.array(cubicationRowSchema).min(1).optional(),
  tablaWidths: z.array(z.number().positive().max(48)).min(1).optional(),
  tablillaWidths: z.array(z.number().positive().max(48)).min(1).optional(),
  targetMarginPercent: z.number().min(0, "El margen objetivo debe ser ≥ 0").max(0.99, "El margen objetivo debe ser < 100%").optional(),
  targetMarginRoundingMultiple: z.number().positive("El múltiplo de redondeo debe ser mayor a 0").max(10000).optional(),
  reconciliationTolerancePercent: z.number().min(0, "La tolerancia debe ser ≥ 0").max(1, "La tolerancia debe ser ≤ 100%").optional(),
  warnBelowTargetMargin: z.boolean().optional(),
  blockNegativeMargin: z.boolean().optional(),
});

export type CreateTimberProductInput = z.infer<typeof createTimberProductSchema>;
export type UpdateTimberProductInput = z.infer<typeof updateTimberProductSchema>;
export type CreateTimberTripInput = z.infer<typeof createTimberTripSchema>;
export type UpdateTimberTripInput = z.infer<typeof updateTimberTripSchema>;
export type UpdateTimberPricingConfigInput = z.infer<typeof updateTimberPricingConfigSchema>;
