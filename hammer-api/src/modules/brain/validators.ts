import { BrainDecisionCategory, BrainDecisionSeverity } from "@prisma/client";
import { z } from "zod";

export const scanBrainSchema = z.object({
  mode: z.enum(["SCHEDULED_SCAN", "QUICK_SCAN", "OPERATIONAL_DAY_SCAN", "ENTITY_SCAN", "DEEP_SCAN", "REPAIR_SCAN"]).optional(),
  trigger: z.enum(["SCHEDULED", "MANUAL", "PRICING_REFRESH"]).optional(),
  branchId: z.string().min(1).optional(),
  businessDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  operationalDayId: z.string().min(1).optional(),
  cashSessionId: z.string().min(1).optional(),
  saleOrderId: z.string().min(1).optional(),
  productId: z.string().min(1).optional(),
  category: z.nativeEnum(BrainDecisionCategory).optional(),
  severity: z.nativeEnum(BrainDecisionSeverity).optional(),
  detector: z.string().max(80).optional(),
  dateFrom: z.string().datetime().optional(),
  dateTo: z.string().datetime().optional(),
  maxIssues: z.number().int().min(1).max(500).optional(),
  maxEntities: z.number().int().min(1).max(5000).optional(),
  timeoutMs: z.number().int().min(500).max(30000).optional(),
  dryRun: z.boolean().optional(),
  force: z.boolean().optional(),
  days: z.number().int().min(1).max(365).optional(),
  now: z.string().datetime().optional(),
});

export const decisionNoteSchema = z.object({
  note: z.string().max(1000).optional(),
});

// Fase 1.6 — "No aplica" pide motivo obligatorio: sin esto, en seis meses
// nadie sabe por qué se descartó (mismo criterio que setBranchPriceTx para
// una excepción de precio).
export const dismissDecisionSchema = z.object({
  note: z.string().trim().min(3, "El motivo es obligatorio para descartar (mínimo 3 caracteres).").max(1000),
});

export const snoozeDecisionSchema = decisionNoteSchema.extend({
  until: z.string().datetime().optional(),
  days: z.number().int().min(1).max(90).optional(),
});

export const bulkDecisionSchema = z.object({
  ids: z.array(z.string().min(1)).min(1).max(200),
  action: z.enum(["resolve", "dismiss", "snooze"]),
  note: z.string().max(1000).optional(),
  days: z.number().int().min(1).max(90).optional(),
});

export type ScanBrainInput = z.infer<typeof scanBrainSchema>;

const DECISION_AREAS = ["PRICING", "CASH", "SALES", "INVENTORY", "REORDER", "PURCHASING", "DISPATCH", "PRODUCTION", "SECURITY", "SYSTEM"] as const;

export const inboxFiltersSchema = z.object({
  branchId: z.string().min(1).optional(),
  area: z.enum(DECISION_AREAS).optional(),
  status: z.enum(["PENDING", "SNOOZED", "RESOLVED", "DISMISSED"]).optional(),
  q: z.string().max(120).optional(),
  minSeverity: z.nativeEnum(BrainDecisionSeverity).optional(),
});

export const inboxItemsQuerySchema = inboxFiltersSchema.extend({
  cursor: z.string().optional(),
  limit: z.preprocess((value) => (value === undefined ? undefined : Number(value)), z.number().int().min(1).max(100).optional()),
});
