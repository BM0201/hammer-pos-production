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
});

export const updateSaleOrderLineSchema = z.object({
  quantity: quantitySchema.optional(),
  unitPrice: positiveMoneySchema.optional(),
  discountAmount: nonNegativeMoneySchema.optional(),
  discountPercent: percentageSchema.optional(),
});

/**
 * Transport validation with cross-field rules:
 * - requiresTransport=true → transportAmount must be > 0
 * - requiresTransport=false → transportAmount must be 0 or absent
 */
export const saleOrderTransportSchema = z.object({
  requiresTransport: z.boolean().optional(),
  transportAmount: nonNegativeMoneySchema.optional(),
}).superRefine((data, ctx) => {
  if (data.requiresTransport === true) {
    if (typeof data.transportAmount !== "number" || data.transportAmount <= 0) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "El monto de transporte debe ser mayor que 0 cuando se requiere transporte",
        path: ["transportAmount"],
      });
    }
  }
  if (data.requiresTransport === false && typeof data.transportAmount === "number" && data.transportAmount > 0) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      message: "No se puede especificar monto de transporte cuando no se requiere transporte",
      path: ["transportAmount"],
    });
  }
});

export const saleOrderDirectSaleSchema = z.object({
  cashSessionId: z.string().cuid(),
  method: z.nativeEnum(PaymentMethod).optional(),
  referenceNumber: z.string().max(100).optional().nullable(),
  requiresTransport: z.boolean().optional(),
  transportAmount: nonNegativeMoneySchema.optional(),
}).superRefine((data, ctx) => {
  if (data.requiresTransport === true) {
    if (typeof data.transportAmount !== "number" || data.transportAmount <= 0) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "El monto de transporte debe ser mayor que 0 cuando se requiere transporte",
        path: ["transportAmount"],
      });
    }
  }
  if (data.requiresTransport === false && typeof data.transportAmount === "number" && data.transportAmount > 0) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      message: "No se puede especificar monto de transporte cuando no se requiere transporte",
      path: ["transportAmount"],
    });
  }
});
