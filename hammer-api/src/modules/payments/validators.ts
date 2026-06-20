import { PaymentMethod } from "@prisma/client";
import { z } from "zod";
import { positiveMoneySchema } from "@/modules/shared/validators";

export const paymentTenderSchema = z.object({
  method: z.nativeEnum(PaymentMethod),
  amount: positiveMoneySchema,
  receivedAmount: positiveMoneySchema.optional().nullable(),
  changeAmount: z.coerce.number().min(0).optional().nullable(),
  referenceNumber: z.string().max(100).optional().nullable(),
});

export const postPaymentSchema = z.object({
  saleOrderId: z.string().cuid(),
  cashSessionId: z.string().cuid(),
  method: z.nativeEnum(PaymentMethod),
  amount: positiveMoneySchema,
  referenceNumber: z.string().max(100).optional().nullable(),
  tenders: z.array(paymentTenderSchema).min(1).max(4).optional(),
});
