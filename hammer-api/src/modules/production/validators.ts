import { z } from "zod";

// ── Recipe Validators ──

const recipeInputSchema = z.object({
  inputProductId: z.string().cuid(),
  quantity: z.number().positive("La cantidad debe ser mayor a 0"),
  unit: z.string().min(1).max(32),
  notes: z.string().max(500).optional().nullable(),
});

export const recipeTypeSchema = z.enum([
  "MANUFACTURING",
  "CONVERSION",
  "CUTTING",
  "MIXING",
  "PACKAGING",
  "REPACKAGING",
]);

export const recipeFamilySchema = z.enum([
  "WOOD",
  "CEMENT",
  "STONE",
  "METAL",
  "BLOCKS",
  "PAINT",
  "GENERAL",
]);

// Producción v2 Fase 1: overheadMode decide cómo se calcula el overhead a
// partir de processingCostPerBatch — NONE (default, C$0), FIXED (el valor tal
// cual), PCT_MAT (% de los materiales estándar del lote).
export const overheadModeSchema = z.enum(["NONE", "FIXED", "PCT_MAT"]);

// Producción v2 Fase 3: política de precio al cerrar un lote.
export const pricePolicySchema = z.enum(["RECALC_TARGET_MARGIN", "KEEP_CURRENT", "APPROVAL_IF_DELTA"]);

export const createRecipeSchema = z.object({
  name: z.string().min(2, "Nombre muy corto").max(200),
  code: z.string().min(2).max(64).transform((v) => v.trim().toUpperCase()),
  description: z.string().max(500).optional().nullable(),
  finishedProductId: z.string().cuid(),
  expectedQuantity: z.number().positive("Cantidad esperada debe ser mayor a 0"),
  expectedUnit: z.string().min(1).max(32),
  recipeType: recipeTypeSchema.default("MANUFACTURING"),
  recipeFamily: recipeFamilySchema.default("GENERAL"),
  targetMarginPct: z.number().min(0).max(1).optional().nullable(),
  yieldPercent: z.number().min(0).max(1).optional().nullable(),
  wastePercent: z.number().min(0).max(1).optional().nullable(),
  // Mano de obra: C$0 por defecto (el trabajador ya está en planilla). Si
  // laborEnabled=true, el costo del lote es laborCostPerBatch tal cual (un
  // monto fijo de receta) — nunca un valor enviado por el cliente al cerrar.
  laborEnabled: z.boolean().default(false),
  laborCostPerBatch: z.number().min(0).optional().nullable(),
  // Overhead: C$0 por defecto (producción manual, sin mezcladora).
  overheadMode: overheadModeSchema.default("NONE"),
  processingCostPerBatch: z.number().min(0).optional().nullable(),
  notes: z.string().max(1000).optional().nullable(),
  inputs: z.array(recipeInputSchema).min(1, "Se requiere al menos un insumo"),
});

export const updateRecipeSchema = z.object({
  name: z.string().min(2).max(200).optional(),
  description: z.string().max(500).optional().nullable(),
  expectedQuantity: z.number().positive().optional(),
  expectedUnit: z.string().min(1).max(32).optional(),
  recipeType: recipeTypeSchema.optional(),
  recipeFamily: recipeFamilySchema.optional(),
  targetMarginPct: z.number().min(0).max(1).optional().nullable(),
  yieldPercent: z.number().min(0).max(1).optional().nullable(),
  wastePercent: z.number().min(0).max(1).optional().nullable(),
  laborEnabled: z.boolean().optional(),
  laborCostPerBatch: z.number().min(0).optional().nullable(),
  overheadMode: overheadModeSchema.optional(),
  processingCostPerBatch: z.number().min(0).optional().nullable(),
  isActive: z.boolean().optional(),
  notes: z.string().max(1000).optional().nullable(),
  inputs: z.array(recipeInputSchema).min(1).optional(),
});

// ── Batch Validators ──

export const createBatchSchema = z.object({
  recipeId: z.string().cuid(),
  branchId: z.string().cuid(),
  plannedQuantity: z.number().positive("Cantidad planeada debe ser mayor a 0"),
  notes: z.string().max(1000).optional().nullable(),
});

export const updateBatchSchema = z.object({
  plannedQuantity: z.number().positive().optional(),
  notes: z.string().max(1000).optional().nullable(),
  // Producción v2 Fase 2: transicionar a PLANNED reserva insumos disponibles
  // (releaseBatchInputsTx los libera al pasar a CANCELLED).
  status: z.enum(["PLANNED", "IN_PROGRESS", "CANCELLED"]).optional(),
  // Producción v2 Fase 3: política de precio a aplicar al cerrar — se fija
  // mientras el lote sigue abierto, nunca en el formulario de cierre.
  pricePolicy: pricePolicySchema.optional(),
});

// Producción v2 Fase 1 — costo del navegador eliminado: ya NO se acepta
// costo unitario ni cantidad de insumo por insumo desde el cliente. El
// servidor recalcula el consumo estándar de la receta (cantidad ×
// multiplicador) y lo valora al WAC del sistema; nunca a un costo enviado.
// laborEntries es informativo (productividad) — NO contribuye al costo
// salvo que la receta tenga laborEnabled=true, y en ese caso el costo es el
// laborCostPerBatch fijo de la receta, no una suma de horas × tarifa libre.
const laborEntrySchema = z.object({
  workerId: z.string().cuid().optional().nullable(),
  workerName: z.string().min(1).max(200),
  hours: z.number().min(0),
});

export const completeBatchSchema = z.object({
  // Auditoría 2026-07-22 (ALTO Producción): .positive() rechazaba una pérdida
  // total (todo el insumo consumido, cero unidades buenas producidas) — el
  // lote nunca podía "completarse" y los insumos consumidos físicamente
  // nunca se deducían del inventario del sistema. 0 es un resultado real y
  // válido (mal batch, receta fallida, etc.), solo negativo no tiene sentido.
  producedGoodQuantity: z.number().min(0, "Unidades buenas no puede ser negativo"),
  producedBadQuantity: z.number().min(0).default(0),
  laborEntries: z.array(laborEntrySchema).optional().default([]),
  notes: z.string().max(1000).optional().nullable(),
  // Producción v2 Fase 3 — "nadie inyecta sin ver": exige el hash del
  // preview de inyección más reciente; si el inventario cambió entre medias
  // (otra venta consumió el insumo, otro lote actualizó el WAC), el hash no
  // coincide y el cierre se rechaza en vez de inyectar un costo obsoleto.
  expectedHash: z.string().min(1, "Se requiere el preview de inyección vigente"),
  priceOverrideReason: z.string().max(500).optional().nullable(),
});

export const calculateCostSchema = z.object({
  recipeId: z.string().cuid(),
  plannedQuantity: z.number().positive(),
  branchId: z.string().cuid(),
});

export const reverseBatchSchema = z.object({
  reason: z.string().min(3, "El motivo de reversión es obligatorio").max(500),
});

export const injectionPreviewSchema = z.object({
  producedGoodQuantity: z.number().min(0),
  producedBadQuantity: z.number().min(0).default(0),
});

export type CreateRecipeInput = z.infer<typeof createRecipeSchema>;
export type UpdateRecipeInput = z.infer<typeof updateRecipeSchema>;
export type CreateBatchInput = z.infer<typeof createBatchSchema>;
export type UpdateBatchInput = z.infer<typeof updateBatchSchema>;
export type CompleteBatchInput = z.infer<typeof completeBatchSchema>;
export type CalculateCostInput = z.infer<typeof calculateCostSchema>;
export type ReverseBatchInput = z.infer<typeof reverseBatchSchema>;
export type InjectionPreviewInput = z.infer<typeof injectionPreviewSchema>;
