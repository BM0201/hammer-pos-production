import { PaymentMethod } from "@prisma/client";
import { z } from "zod";
import {
  nonNegativeMoneySchema,
  percentageSchema,
  positiveMoneySchema,
  quantitySchema,
} from "@/modules/shared/validators";

export const createSaleOrderSchema = z.object({
  branchId: z.string().cuid(),
  customerId: z.string().cuid().optional().nullable(),
  notes: z.string().max(500).optional().nullable(),
});

export const addSaleOrderLineSchema = z.object({
  productId: z.string().cuid(),
  quantity: quantitySchema,
  unitPrice: positiveMoneySchema.optional(),
  discountAmount: nonNegativeMoneySchema.default(0),
  discountPercent: percentageSchema.optional(),
  overrideReason: z.string().max(500).optional(),
});

export const updateSaleOrderLineSchema = z.object({
  quantity: quantitySchema.optional(),
  unitPrice: positiveMoneySchema.optional(),
  discountAmount: nonNegativeMoneySchema.optional(),
  discountPercent: percentageSchema.optional(),
  overrideReason: z.string().max(500).optional(),
});

export const saleOrderTransportSchema = z.object({
  requiresTransport: z.boolean().optional(),
  transportAmount: nonNegativeMoneySchema.optional(),
});

export const saleOrderDirectSaleSchema = saleOrderTransportSchema.extend({
  cashSessionId: z.string().cuid(),
  method: z.nativeEnum(PaymentMethod).optional(),
  referenceNumber: z.string().max(100).optional().nullable(),
});
