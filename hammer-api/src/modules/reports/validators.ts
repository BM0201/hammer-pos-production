import { z } from "zod";

export const reportQuerySchema = z.object({
  dateFrom: z.coerce.date().optional(),
  dateTo: z.coerce.date().optional(),
  branchId: z.string().cuid().optional(),
  status: z.string().min(1).max(64).optional(),
  actorUsername: z.string().min(1).max(64).optional(),
});
