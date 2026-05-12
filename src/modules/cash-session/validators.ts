import { z } from "zod";
import { nonNegativeMoneySchema } from "@/modules/shared/validators";

export const openCashSessionSchema = z.object({
  branchId: z.string().cuid(),
  physicalCashBoxId: z.string().cuid(),
  openingAmount: nonNegativeMoneySchema,
  notes: z.string().max(500).optional().nullable(),
});

export const getActiveCashSessionSchema = z.object({
  branchId: z.string().cuid(),
  physicalCashBoxId: z.string().cuid(),
});

export const requestCloseCashSessionSchema = z.object({
  cashSessionId: z.string().cuid(),
  notes: z.string().max(500).optional().nullable(),
});

export const closeCashSessionSchema = z.object({
  cashSessionId: z.string().cuid(),
  closingAmount: nonNegativeMoneySchema,
  notes: z.string().max(500).optional().nullable(),
});
