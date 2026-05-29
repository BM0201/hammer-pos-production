import { OperationalDayStatus } from "@prisma/client";
import { z } from "zod";

export const currentOperationalDaySchema = z.object({
  branchId: z.string().cuid(),
});

export const openOperationalDaySchema = z.object({
  branchId: z.string().cuid(),
  businessDate: z.string().date().optional(),
  notes: z.string().trim().max(1000).optional().nullable(),
});

export const closeOperationalDaySchema = z.object({
  note: z.string().trim().max(1500).optional().nullable(),
  forceClose: z.boolean().optional().default(false),
  acknowledgedWarnings: z.array(z.string()).optional().default([]),
});

export const cancelOperationalDaySchema = z.object({
  note: z.string().trim().min(5).max(1500),
  override: z.boolean().optional().default(false),
});

export const masterOperationalDaysSchema = z.object({
  date: z.string().date().optional(),
  branchId: z.string().cuid().optional(),
  status: z.nativeEnum(OperationalDayStatus).optional(),
  hasIssues: z.coerce.boolean().optional(),
});
