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

export type CreateExpenseInput = z.infer<typeof createExpenseSchema>;
export type UpdateExpenseInput = z.infer<typeof updateExpenseSchema>;
export type UpsertPricingConfigInput = z.infer<typeof upsertPricingConfigSchema>;
export type SuggestedPriceQuery = z.infer<typeof suggestedPriceQuerySchema>;
