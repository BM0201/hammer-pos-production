import { z } from "zod";
import { TransportServiceStatus } from "@prisma/client";

export const createTransportSchema = z.object({
  saleOrderId: z.string().cuid(),
  branchId: z.string().cuid(),
  customerName: z.string().min(1, "customerName no puede estar vacio"),
  reference: z.string().max(200).optional().nullable(),
  price: z.number().positive("price debe ser mayor a 0"),
  scheduledPaymentTime: z.coerce.date().optional().nullable(),
  notes: z.string().max(500).optional().nullable(),
});

export const updateTransportStatusSchema = z.object({
  status: z.nativeEnum(TransportServiceStatus),
});

const VALID_TRANSITIONS: Record<string, TransportServiceStatus[]> = {
  PENDING: [TransportServiceStatus.IN_TRANSIT, TransportServiceStatus.CANCELLED],
  IN_TRANSIT: [TransportServiceStatus.DELIVERED, TransportServiceStatus.CANCELLED],
  DELIVERED: [],
  CANCELLED: [],
};

export function validateTransportTransition(currentStatus: TransportServiceStatus, newStatus: TransportServiceStatus): boolean {
  const allowed = VALID_TRANSITIONS[currentStatus];
  return allowed ? allowed.includes(newStatus) : false;
}
