import { z } from "zod";

/** Valid expense categories matching Prisma enum */
export const EXPENSE_CATEGORIES = [
  "PAYROLL",
  "UTILITIES",
  "RENT",
  "FOOD",
  "MAINTENANCE",
  "TRANSPORT",
  "MARKETING",
  "OTHER",
] as const;

export const EXPENSE_CATEGORY_LABELS: Record<string, string> = {
  PAYROLL: "Personal / Nómina",
  UTILITIES: "Servicios (Agua, Luz, Internet)",
  RENT: "Renta / Alquiler",
  FOOD: "Alimentación",
  MAINTENANCE: "Mantenimiento",
  TRANSPORT: "Transporte",
  MARKETING: "Publicidad / Marketing",
  OTHER: "Otros",
};

export const PRORATION_METHODS = ["BY_QUANTITY", "BY_VALUE"] as const;

export const PRORATION_METHOD_LABELS: Record<string, string> = {
  BY_QUANTITY: "Por Cantidad (unidades)",
  BY_VALUE: "Por Valor (C$)",
};

export const PRICING_MODES = ["SIMPLE", "ADVANCED"] as const;
export const ROUNDING_RULES = ["NONE", "NEAREST_1", "NEAREST_5", "NEAREST_10", "NEAREST_50", "NEAREST_100", "ENDING_9", "ENDING_90", "ENDING_99"] as const;
export const STOCK_POLICIES = ["HIGH_STOCK", "NORMAL", "LOW_STOCK", "ON_DEMAND"] as const;
export const PRICE_MODES = ["CATEGORY", "MANUAL", "ABC_XYZ_READY"] as const;

const numericInput = z.union([z.number(), z.string()])
  .transform((value) => (typeof value === "string" && value.trim() === "" ? 0 : Number(value)))
  .refine((value) => Number.isFinite(value), "Debe ser un numero valido");

const nonNegativeNumericInput = numericInput.refine((value) => value >= 0, "Debe ser mayor o igual a 0");

/* ── Expense Validators ─────────────────────────── */

export const createExpenseSchema = z.object({
  branchId: z.string().min(1, "Sucursal es requerida"),
  category: z.enum(EXPENSE_CATEGORIES, { message: "Categoría inválida" }),
  description: z.string().min(1, "Descripción es requerida").max(200),
  amount: z.number().positive("El monto debe ser mayor a 0"),
  effectiveFrom: z.string().optional(),
  effectiveTo: z.string().optional(),
});

export const updateExpenseSchema = z.object({
  category: z.enum(EXPENSE_CATEGORIES).optional(),
  description: z.string().min(1).max(200).optional(),
  amount: z.number().positive().optional(),
  isActive: z.boolean().optional(),
  effectiveFrom: z.string().optional(),
  effectiveTo: z.string().nullable().optional(),
});

/* ── Pricing Config Validators ───────────────────── */

export const upsertPricingConfigSchema = z.object({
  branchId: z.string().min(1, "Sucursal es requerida"),
  desiredMarginPercent: z.number().min(0.1).max(99.9, "El margen debe ser entre 0.1% y 99.9%"),
  prorationMethod: z.enum(PRORATION_METHODS).optional(),
  estimatedMonthlyUnits: z.number().positive("Las unidades estimadas deben ser > 0"),
});

/* ── Suggested Price Validators ──────────────────── */

export const suggestedPriceQuerySchema = z.object({
  branchId: z.string().min(1),
  purchaseCostPerUnit: z.number().min(0),
  productId: z.string().optional(),
});

export const pricingSuggestionPayloadSchema = z.object({
  branchId: z.string().min(1).optional(),
  productId: z.string().optional(),
  mode: z.enum(PRICING_MODES).optional(),
  baseCost: nonNegativeNumericInput.optional(),
  purchaseCostPerUnit: nonNegativeNumericInput.optional(),
  taxPercent: nonNegativeNumericInput.refine((value) => value <= 100, "El IVA debe estar entre 0 y 100").optional(),
  includeTaxInCost: z.boolean().optional(),
  purchaseFreightPerUnit: nonNegativeNumericInput.optional(),
  otherCostPerUnit: nonNegativeNumericInput.optional(),
  shrinkagePercent: nonNegativeNumericInput.refine((value) => value <= 100, "La merma debe estar entre 0 y 100").optional(),
  monthlyOperatingExpenses: nonNegativeNumericInput.optional(),
  totalMonthlyExpenses: nonNegativeNumericInput.optional(),
  estimatedMonthlyUnits: nonNegativeNumericInput.optional(),
  prorateMethod: z.enum(PRORATION_METHODS).optional(),
  prorationMethod: z.enum(PRORATION_METHODS).optional(),
  estimatedMonthlySalesValue: nonNegativeNumericInput.optional(),
  productMonthlySalesValue: nonNegativeNumericInput.optional(),
  estimatedMonthlyUnitsForThisProduct: nonNegativeNumericInput.optional(),
  marginPercent: numericInput.refine((value) => value > 0 && value < 95, "El margen debe ser mayor que 0 y menor que 95").optional(),
  desiredMarginPercent: numericInput.refine((value) => value > 0 && value < 95, "El margen debe ser mayor que 0 y menor que 95").optional(),
  minProfitAmount: nonNegativeNumericInput.optional(),
  marketMinPrice: nonNegativeNumericInput.optional(),
  marketMaxPrice: nonNegativeNumericInput.optional(),
  roundingRule: z.enum(ROUNDING_RULES).optional(),
  useCategoryPolicy: z.boolean().optional(),
  forcePolicyValues: z.boolean().optional(),
  useCommercialIntelligence: z.boolean().optional(),
  forceCommercialValues: z.boolean().optional(),
}).superRefine((value, ctx) => {
  if (value.baseCost === undefined && value.purchaseCostPerUnit === undefined) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["baseCost"], message: "baseCost es requerido" });
  }
  if (value.marginPercent === undefined && value.desiredMarginPercent === undefined && !value.useCategoryPolicy && !value.useCommercialIntelligence) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["marginPercent"], message: "marginPercent es requerido" });
  }
});

export const upsertCategoryPricingPolicySchema = z.object({
  branchId: z.string().cuid(),
  categoryId: z.string().cuid(),
  minMarginPercent: nonNegativeNumericInput.refine((value) => value <= 95, "El margen minimo debe estar entre 0 y 95"),
  targetMarginPercent: nonNegativeNumericInput.refine((value) => value <= 95, "El margen recomendado debe estar entre 0 y 95"),
  minProfitAmount: nonNegativeNumericInput,
  maxDiscountPercent: nonNegativeNumericInput.refine((value) => value <= 100, "El descuento maximo debe estar entre 0 y 100"),
  estimatedMonthlyUnits: nonNegativeNumericInput.transform((value) => Math.max(value, 1)),
  estimatedMonthlySalesValue: nonNegativeNumericInput.nullable().optional(),
  monthlyExpenseAllocation: nonNegativeNumericInput,
  stockPolicy: z.enum(STOCK_POLICIES),
  priceMode: z.enum(PRICE_MODES),
  roundingRule: z.enum(ROUNDING_RULES),
  notes: z.string().max(500).optional().nullable(),
  isActive: z.boolean().optional(),
}).superRefine((value, ctx) => {
  if (value.targetMarginPercent < value.minMarginPercent) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["targetMarginPercent"], message: "El margen recomendado debe ser mayor o igual al minimo" });
  }
});

export const bootstrapCategoryPoliciesSchema = z.object({
  branchId: z.string().cuid(),
});

export const applyPricingSchema = z.object({
  productId: z.string().cuid(),
  branchId: z.string().cuid().optional(),
  applyScope: z.enum(["BRANCH", "GLOBAL"]),
  suggestedPrice: nonNegativeNumericInput.refine((value) => value > 0, "El precio sugerido debe ser mayor que 0"),
  minPrice: nonNegativeNumericInput.optional(),
  maxPrice: nonNegativeNumericInput.nullable().optional(),
  totalInternalCost: nonNegativeNumericInput.optional(),
  effectiveCost: nonNegativeNumericInput.nullable().optional(),
  marginPercent: nonNegativeNumericInput.optional(),
  grossMarginPercent: nonNegativeNumericInput.optional(),
  markupPercent: nonNegativeNumericInput.optional(),
  roundingRule: z.string().max(50).optional(),
  reason: z.string().max(500).optional(),
  calculationSnapshot: z.unknown().optional(),
}).superRefine((value, ctx) => {
  if (value.applyScope === "BRANCH" && !value.branchId) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["branchId"], message: "branchId es obligatorio para aplicar precio por sucursal" });
  }
  if (value.minPrice !== undefined && value.suggestedPrice < value.minPrice) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["suggestedPrice"], message: "El precio sugerido no puede ser menor que el precio minimo" });
  }
  if (value.effectiveCost !== undefined && value.effectiveCost !== null && value.suggestedPrice < value.effectiveCost) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["suggestedPrice"], message: "El precio sugerido no puede ser menor que el costo efectivo" });
  }
});

export type CreateExpenseInput = z.infer<typeof createExpenseSchema>;
export type UpdateExpenseInput = z.infer<typeof updateExpenseSchema>;
export type UpsertPricingConfigInput = z.infer<typeof upsertPricingConfigSchema>;
export type SuggestedPriceQuery = z.infer<typeof suggestedPriceQuerySchema>;
export type PricingSuggestionPayload = z.infer<typeof pricingSuggestionPayloadSchema>;
export type ApplyPricingInput = z.infer<typeof applyPricingSchema>;
export type UpsertCategoryPricingPolicyInput = z.infer<typeof upsertCategoryPricingPolicySchema>;
