import { z } from "zod";

export const financeSummarySchema = z.object({
  branchId: z.string().cuid().optional().nullable(),
  year: z.coerce.number().int().min(2000).max(2100).optional(),
  month: z.coerce.number().int().min(1).max(12).optional(),
});

export type FinanceSummaryQuery = z.infer<typeof financeSummarySchema>;

export const financeTrendSchema = z.object({
  branchId: z.string().cuid().optional().nullable(),
  /** Meses hacia atrás incluyendo el actual (1–12; default 6). */
  months: z.coerce.number().int().min(1).max(12).optional(),
});

export type FinanceTrendQuery = z.infer<typeof financeTrendSchema>;
