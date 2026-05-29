import { PaymentMethod } from "@prisma/client";
import { z } from "zod";
import { positiveMoneySchema } from "@/modules/shared/validators";

export const postPaymentSchema = z.object({
  saleOrderId: z.string().cuid(),
  cashSessionId: z.string().cuid(),
  method: z.nativeEnum(PaymentMethod),
  amount: positiveMoneySchema,
  referenceNumber: z.string().max(100).optional().nullable(),
});
