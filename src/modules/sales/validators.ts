import { z } from "zod";

export const createSaleOrderSchema = z.object({
  branchId: z.string().cuid(),
  customerId: z.string().cuid().optional().nullable(),
  notes: z.string().max(500).optional().nullable(),
});

export const addSaleOrderLineSchema = z.object({
  productId: z.string().cuid(),
  quantity: z.coerce.number().positive(),
  unitPrice: z.coerce.number().nonnegative().optional(),
  discountAmount: z.coerce.number().nonnegative().default(0),
});

export const updateSaleOrderLineSchema = z.object({
  quantity: z.coerce.number().positive().optional(),
  unitPrice: z.coerce.number().nonnegative().optional(),
  discountAmount: z.coerce.number().nonnegative().optional(),
});
