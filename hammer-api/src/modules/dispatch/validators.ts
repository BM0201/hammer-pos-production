import { z } from "zod";

export const dispatchListSchema = z.object({
  branchId: z.string().cuid().optional(),
});

export const dispatchOrderSchema = z.object({
  orderId: z.string().cuid(),
  notes: z.string().max(500).optional().nullable(),
});
