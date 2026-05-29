import { z } from "zod";

// ── Recipe Validators ──

const recipeInputSchema = z.object({
  inputProductId: z.string().cuid(),
  quantity: z.number().positive("La cantidad debe ser mayor a 0"),
  unit: z.string().min(1).max(32),
  notes: z.string().max(500).optional().nullable(),
});

export const createRecipeSchema = z.object({
  name: z.string().min(2, "Nombre muy corto").max(200),
  code: z.string().min(2).max(64).transform((v) => v.trim().toUpperCase()),
  description: z.string().max(500).optional().nullable(),
  finishedProductId: z.string().cuid(),
  expectedQuantity: z.number().positive("Cantidad esperada debe ser mayor a 0"),
  expectedUnit: z.string().min(1).max(32),
  targetMarginPct: z.number().min(0).max(1).optional().nullable(),
  notes: z.string().max(1000).optional().nullable(),
  inputs: z.array(recipeInputSchema).min(1, "Se requiere al menos un insumo"),
});

export const updateRecipeSchema = z.object({
  name: z.string().min(2).max(200).optional(),
  description: z.string().max(500).optional().nullable(),
  expectedQuantity: z.number().positive().optional(),
  expectedUnit: z.string().min(1).max(32).optional(),
  targetMarginPct: z.number().min(0).max(1).optional().nullable(),
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
  status: z.enum(["PLANNED", "IN_PROGRESS", "CANCELLED"]).optional(),
  laborCost: z.number().min(0).optional().nullable(),
  overheadCost: z.number().min(0).optional().nullable(),
});

const batchInputActualSchema = z.object({
  inputProductId: z.string().cuid(),
  actualQuantity: z.number().positive("Cantidad real debe ser mayor a 0"),
  unitCost: z.number().min(0, "Costo unitario no puede ser negativo"),
});

export const completeBatchSchema = z.object({
  producedGoodQuantity: z.number().positive("Unidades buenas debe ser mayor a 0"),
  producedBadQuantity: z.number().min(0).default(0),
  laborCost: z.number().min(0).default(0),
  overheadCost: z.number().min(0).default(0),
  inputs: z.array(batchInputActualSchema).min(1, "Se requiere al menos un insumo consumido"),
});

export const calculateCostSchema = z.object({
  recipeId: z.string().cuid(),
  plannedQuantity: z.number().positive(),
  branchId: z.string().cuid(),
});

export type CreateRecipeInput = z.infer<typeof createRecipeSchema>;
export type UpdateRecipeInput = z.infer<typeof updateRecipeSchema>;
export type CreateBatchInput = z.infer<typeof createBatchSchema>;
export type UpdateBatchInput = z.infer<typeof updateBatchSchema>;
export type CompleteBatchInput = z.infer<typeof completeBatchSchema>;
export type CalculateCostInput = z.infer<typeof calculateCostSchema>;
