import { z } from "zod";

export const financeSummarySchema = z.object({
  branchId: z.string().cuid().optional().nullable(),
  year: z.coerce.number().int().min(2000).max(2100).optional(),
  month: z.coerce.number().int().min(1).max(12).optional(),
});

export const financeTrendSchema = z.object({
  branchId: z.string().cuid().optional().nullable(),
  /** Meses hacia atrás incluyendo el actual (1–12; default 6). */
  months: z.coerce.number().int().min(1).max(12).optional(),
});

/**
 * "YYYY-MM-DD" es un día de Managua, no medianoche UTC: z.coerce.date lo
 * volvía 00:00 UTC = 18:00 del día ANTERIOR en Managua, y las flechas ←/→
 * del panel (que mandan la fecha de inicio del período vecino) se quedaban
 * en el mismo período o se saltaban uno. Mediodía UTC cae en ese mismo día
 * en Managua (06:00).
 */
const managuaDay = z.preprocess(
  (v) => (typeof v === "string" && /^\d{4}-\d{2}-\d{2}$/.test(v) ? `${v}T12:00:00Z` : v),
  z.coerce.date(),
);

/** prompt-gastos-semana-quincena.md Fase 2.4 — GET /api/master/finance/expenses/period. */
export const expensePeriodReportSchema = z.object({
  branchId: z.string().cuid().optional().nullable(),
  kind: z.enum(["DAY", "WEEK", "QUINCENA", "MONTH", "CUSTOM"]).default("MONTH"),
  date: managuaDay.optional(),
  from: managuaDay.optional(),
  to: managuaDay.optional(),
  basis: z.enum(["PAID", "ACCRUED"]).default("PAID"),
  limit: z.string().optional(),
  offset: z.coerce.number().int().min(0).optional(),
  category: z.string().optional(),
  source: z.enum(["CAJA", "EFECTIVO_RETENIDO", "BANCO", "COMISION_TARJETA", "PLANILLA", "DEVENGADO"]).optional(),
  conceptId: z.string().cuid().optional(),
  text: z.string().optional(),
}).refine((v) => v.kind !== "CUSTOM" || (v.from && v.to), {
  message: "CUSTOM requiere from/to.",
  path: ["from"],
});
