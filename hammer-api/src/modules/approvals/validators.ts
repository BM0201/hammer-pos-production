import { z } from "zod";

export const approvalListQuerySchema = z.object({
  branchId: z.string().cuid().optional(),
  includeResolved: z
    .union([z.literal("true"), z.literal("false")])
    .optional()
    .transform((value) => value === "true"),
});

export const resolveApprovalSchema = z.object({
  decision: z.enum(["APPROVE", "REJECT"]),
  resolutionNotes: z.string().max(500).optional().nullable(),
});
