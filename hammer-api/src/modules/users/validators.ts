import { z } from "zod";

export const membershipSchema = z.object({
  branchId: z.string().min(1),
  roleCode: z.enum(["BRANCH_ADMIN", "SALES", "CASHIER", "WAREHOUSE"]),
});

export const createUserSchema = z.object({
  username: z.string().min(3),
  email: z.string().email(),
  fullName: z.string().min(2),
  password: z.string().min(8),
  isActive: z.boolean().optional(),
  globalRole: z.enum(["MASTER"]).optional(),
  memberships: z.array(membershipSchema).default([]),
});

export const updateUserSchema = z.object({
  email: z.string().email().optional(),
  fullName: z.string().min(2).optional(),
  password: z.string().min(8).optional(),
  isActive: z.boolean().optional(),
  globalRole: z.enum(["MASTER"]).nullable().optional(),
});

export const upsertMembershipSchema = membershipSchema.extend({
  isActive: z.boolean().optional(),
});

export const updateMembershipSchema = z.object({
  roleCode: z.enum(["BRANCH_ADMIN", "SALES", "CASHIER", "WAREHOUSE"]).optional(),
  isActive: z.boolean().optional(),
});
