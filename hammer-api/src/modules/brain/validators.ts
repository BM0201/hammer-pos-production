import { BrainDecisionCategory, BrainDecisionSeverity, BrainDecisionStatus } from "@prisma/client";
import { z } from "zod";

const numberFromQuery = z.preprocess((value) => {
  if (value === undefined || value === null || value === "") return undefined;
  return Number(value);
}, z.number().int().min(1).max(365).optional());

export const decisionFiltersSchema = z.object({
  branchId: z.string().min(1).optional(),
  productId: z.string().min(1).optional(),
  targetUserId: z.string().min(1).optional(),
  category: z.nativeEnum(BrainDecisionCategory).optional(),
  severity: z.nativeEnum(BrainDecisionSeverity).optional(),
  status: z.nativeEnum(BrainDecisionStatus).optional(),
  days: numberFromQuery,
  dateFrom: z.string().datetime().optional().transform((value) => value ? new Date(value) : undefined),
  dateTo: z.string().datetime().optional().transform((value) => value ? new Date(value) : undefined),
  search: z.string().max(120).optional(),
  onlyCritical: z.preprocess((value) => value === "1" || value === "true", z.boolean().optional()),
  cursor: z.string().optional(),
  limit: z.preprocess((value) => value === undefined ? undefined : Number(value), z.number().int().min(1).max(100).optional()),
  sort: z.enum(["priority", "date", "impact"]).optional(),
});

export const scanBrainSchema = z.object({
  branchId: z.string().min(1).optional(),
  category: z.nativeEnum(BrainDecisionCategory).optional(),
  dryRun: z.boolean().optional(),
  force: z.boolean().optional(),
  days: z.number().int().min(1).max(365).optional(),
  now: z.string().datetime().optional(),
});

export const decisionNoteSchema = z.object({
  note: z.string().max(1000).optional(),
});

export const snoozeDecisionSchema = decisionNoteSchema.extend({
  until: z.string().datetime().optional(),
  days: z.number().int().min(1).max(90).optional(),
});

export type ScanBrainInput = z.infer<typeof scanBrainSchema>;
