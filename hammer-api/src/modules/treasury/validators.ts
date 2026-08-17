import { z } from "zod";

export const createBankAccountSchema = z.object({
  bankName: z.string().min(1).max(100),
  accountAlias: z.string().min(1).max(100),
  accountNumber: z.string().min(1).max(50),
  currency: z.string().min(1).max(10).optional(),
  branchId: z.string().cuid().optional().nullable(),
  owner: z.string().max(150).optional().nullable(),
  acceptsCustomerPayments: z.boolean().optional(),
});

export const updateBankAccountSchema = z.object({
  bankName: z.string().min(1).max(100).optional(),
  accountAlias: z.string().min(1).max(100).optional(),
  accountNumber: z.string().min(1).max(50).optional(),
  currency: z.string().min(1).max(10).optional(),
  branchId: z.string().cuid().optional().nullable(),
  isActive: z.boolean().optional(),
  owner: z.string().max(150).optional().nullable(),
  acceptsCustomerPayments: z.boolean().optional(),
});

export const confirmBankDepositSchema = z.object({
  bankAccountId: z.string().cuid(),
  branchId: z.string().cuid(),
  amount: z.coerce.number().positive(),
  referenceNumber: z.string().max(100).optional().nullable(),
  notes: z.string().max(500).optional().nullable(),
});

export const declareCashDestinationSchema = z.object({
  cashSessionId: z.string().cuid(),
  branchId: z.string().cuid(),
  handOverAmount: z.coerce.number().min(0),
  handOverUserId: z.string().cuid().optional().nullable(),
  depositAmount: z.coerce.number().min(0),
  depositCarrierUserId: z.string().cuid().optional().nullable(),
  depositBankAccountId: z.string().cuid().optional().nullable(),
  retainAmount: z.coerce.number().min(0),
  awaitingDepositLocation: z.enum(["DRAWER", "SAFE"]).default("DRAWER"),
  notes: z.string().max(500).optional().nullable(),
});
