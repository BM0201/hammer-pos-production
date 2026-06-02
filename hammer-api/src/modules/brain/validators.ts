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
  onlyActionable: z.preprocess((value) => value === "1" || value === "true", z.boolean().optional()),
  onlyWithImpact: z.preprocess((value) => value === "1" || value === "true", z.boolean().optional()),
  onlyPendingApproval: z.preprocess((value) => value === "1" || value === "true", z.boolean().optional()),
  onlyPricing: z.preprocess((value) => value === "1" || value === "true", z.boolean().optional()),
  onlyInventory: z.preprocess((value) => value === "1" || value === "true", z.boolean().optional()),
  onlyCash: z.preprocess((value) => value === "1" || value === "true", z.boolean().optional()),
  onlyPurchasing: z.preprocess((value) => value === "1" || value === "true", z.boolean().optional()),
  onlyTransfers: z.preprocess((value) => value === "1" || value === "true", z.boolean().optional()),
  onlyConfiguration: z.preprocess((value) => value === "1" || value === "true", z.boolean().optional()),
  onlyPricingMisconfiguration: z.preprocess((value) => value === "1" || value === "true", z.boolean().optional()),
  actionType: z.string().max(120).optional(),
  cursor: z.string().optional(),
  limit: z.preprocess((value) => value === undefined ? undefined : Number(value), z.number().int().min(1).max(100).optional()),
  sort: z.enum(["priority", "severity", "impact", "newest", "oldest", "branch", "category", "date"]).optional(),
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
