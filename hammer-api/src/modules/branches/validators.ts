import { z } from "zod";

const branchRoleSchema = z.enum(["BRANCH_ADMIN", "SALES", "CASHIER", "WAREHOUSE"]);

export const createBranchSchema = z.object({
  code: z.string().min(2).max(24),
  name: z.string().min(2).max(120),
  isActive: z.boolean().optional(),
  createDefaultCashBox: z.boolean().optional(),
  enableCashier: z.boolean().optional(),
  enableDispatch: z.boolean().optional(),
  memberships: z.array(z.object({
    userId: z.string().min(1),
    roleCode: branchRoleSchema,
  })).optional(),
});

export const updateBranchSchema = z.object({
  name: z.string().min(2).max(120).optional(),
  isActive: z.boolean().optional(),
  enableCashier: z.boolean().optional(),
  enableDispatch: z.boolean().optional(),
}).refine((value) => Object.keys(value).length > 0, {
  message: "Debe enviar al menos un campo para actualizar.",
});

export type CreateBranchInput = z.infer<typeof createBranchSchema>;
export type UpdateBranchInput = z.infer<typeof updateBranchSchema>;
