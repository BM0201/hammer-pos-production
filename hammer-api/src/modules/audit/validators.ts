import { z } from "zod";

export const auditQuerySchema = z.object({
  dateFrom: z.coerce.date().optional(),
  dateTo: z.coerce.date().optional(),
  branchId: z.string().cuid().optional(),
  module: z.string().min(1).max(64).optional(),
  action: z.string().min(1).max(128).optional(),
  actorUsername: z.string().min(1).max(64).optional(),
  result: z.string().min(1).max(128).optional(),
  limit: z.coerce.number().int().min(1).max(200).optional(),
});
