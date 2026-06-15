import {
  RefundMethod,
  ReturnedItemCondition,
  ReturnInventoryDestination,
  SaleReturnType,
} from "@prisma/client";
import { z } from "zod";

const idSchema = z.string().min(1);
const positiveNumberSchema = z.coerce.number().positive();

export const saleReturnItemInputSchema = z.object({
  saleOrderLineId: idSchema,
  quantity: positiveNumberSchema,
  condition: z.nativeEnum(ReturnedItemCondition),
  inventoryDestination: z.nativeEnum(ReturnInventoryDestination),
});

export const requestSaleReturnSchema = z.object({
  saleOrderId: idSchema,
  reason: z.string().trim().min(3),
  returnType: z.nativeEnum(SaleReturnType),
  items: z.array(saleReturnItemInputSchema).min(1),
});

export const executeSaleReturnSchema = z.object({
  refundMethod: z.nativeEnum(RefundMethod),
  cashSessionId: z.string().min(1).optional().nullable(),
});

export const rejectSaleReturnSchema = z.object({
  reason: z.string().trim().min(3),
});

export const requestSaleCancellationSchema = z.object({
  saleOrderId: idSchema,
  reason: z.string().trim().min(3),
});

export const rejectSaleCancellationSchema = z.object({
  reason: z.string().trim().min(3),
});
