import { z } from "zod";

export const currentOperationalDaySchema = z.object({
  branchId: z.string().cuid(),
});

export const openOperationalDaySchema = z.object({
  branchId: z.string().cuid(),
  businessDate: z.string().date().optional(),
  notes: z.string().trim().max(1000).optional().nullable(),
});

export const endShiftOperationalDaySchema = z.object({
  note: z.string().trim().max(1500).optional().nullable(),
});

export const confirmOperationalDaySchema = z.object({
  note: z.string().trim().max(1500).optional().nullable(),
});

export const revertConfirmationOperationalDaySchema = z.object({
  note: z.string().trim().min(5).max(1500),
});

export const reopenOperationalDaySchema = z.object({
  note: z.string().trim().min(5).max(1500),
});

export const cancelOperationalDaySchema = z.object({
  note: z.string().trim().min(5).max(1500),
  override: z.boolean().optional().default(false),
});

export const masterOperationalDaysSchema = z.object({
  date: z.string().date().optional(),
  dateFrom: z.string().date().optional(),
  dateTo: z.string().date().optional(),
  branchId: z.string().cuid().optional(),
  lifecycle: z.enum(["ACTIVE", "AWAITING_REVIEW", "CANCELLED"]).optional(),
  reviewStatus: z.enum(["PENDING", "CONFIRMED"]).optional(),
  hasIssues: z.coerce.boolean().optional(),
});
