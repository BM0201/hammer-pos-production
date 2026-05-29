import { z } from "zod";

export const membershipSchema = z.object({
  branchId: z.string().min(1),
  roleCode: z.enum(["BRANCH_ADMIN", "SALES", "CASHIER", "WAREHOUSE"]),
});

export const createUserSchema = z.object({
  username: z.string().trim().toLowerCase().min(3).regex(/^[a-z0-9._-]+$/, "Usuario invalido. Use letras, numeros, punto, guion o guion bajo."),
  email: z.string().trim().toLowerCase().email().optional(),
  fullName: z.string().trim().min(2),
  password: z.string().optional(), // Se ignora — la contraseña siempre es ElChele1234!
  isActive: z.boolean().optional(),
  globalRole: z.enum(["MASTER", "OWNER", "SYSTEM_ADMIN"]).optional(),
  memberships: z.array(membershipSchema).default([]),
});

export const updateUserSchema = z.object({
  username: z.string().trim().toLowerCase().min(3).regex(/^[a-z0-9._-]+$/, "Usuario invalido. Use letras, numeros, punto, guion o guion bajo.").optional(),
  email: z.string().trim().toLowerCase().email().optional(),
  fullName: z.string().trim().min(2).optional(),
  password: z.string().min(1).optional(),
  isActive: z.boolean().optional(),
  globalRole: z.enum(["MASTER", "OWNER", "SYSTEM_ADMIN"]).nullable().optional(),
});

export const upsertMembershipSchema = membershipSchema.extend({
  isActive: z.boolean().optional(),
});

export const updateMembershipSchema = z.object({
  roleCode: z.enum(["BRANCH_ADMIN", "SALES", "CASHIER", "WAREHOUSE"]).optional(),
  isActive: z.boolean().optional(),
});
