import { PaymentMethod } from "@prisma/client";
import { z } from "zod";

export const postPaymentSchema = z.object({
  saleOrderId: z.string().cuid(),
  method: z.nativeEnum(PaymentMethod),
  amount: z.coerce.number().positive(),
  referenceNumber: z.string().max(100).optional().nullable(),
});
