import { PaymentMethod } from "@prisma/client";
import { z } from "zod";
import { positiveMoneySchema } from "@/modules/shared/validators";

export const paymentTenderSchema = z
  .object({
    method: z.nativeEnum(PaymentMethod),
    amount: positiveMoneySchema,
    receivedAmount: positiveMoneySchema.optional().nullable(),
    changeAmount: z.coerce.number().min(0).optional().nullable(),
    referenceNumber: z.string().max(100).optional().nullable(),
    bankAccountId: z.string().cuid().optional().nullable(),
  })
  // TRANSFER sin cuenta destino es plata que el libro mayor no puede
  // ubicar en ningún banco — mismo criterio que el control en el servicio
  // (payments/service.ts, sales/service.ts): esto es comodidad para el
  // usuario, el servicio es el control real (el payload se puede editar).
  .superRefine((tender, ctx) => {
    if (tender.method === PaymentMethod.TRANSFER && !tender.bankAccountId) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["bankAccountId"],
        message: "Elegí a qué cuenta entró la transferencia.",
      });
    }
  });

export const postPaymentSchema = z.object({
  saleOrderId: z.string().cuid(),
  cashSessionId: z.string().cuid(),
  method: z.nativeEnum(PaymentMethod),
  amount: positiveMoneySchema,
  referenceNumber: z.string().max(100).optional().nullable(),
  tenders: z.array(paymentTenderSchema).min(1).max(4).optional(),
});
