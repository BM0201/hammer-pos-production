/** Cuenta con el proveedor de un viaje: adelantos, abonos, otros abonos y restas. Solo se anota en el viaje, no mueve Tesorería. */
import { prisma } from "@/lib/prisma";
import { Decimal } from "@prisma/client/runtime/library";
import type { CreateTimberTripPaymentInput } from "./validators";

export const TIMBER_PAYMENT_KINDS = ["ADELANTO", "ABONO", "OTRO_ABONO", "RESTA"] as const;
export type TimberPaymentKind = (typeof TIMBER_PAYMENT_KINDS)[number];

export type TimberTripAccount = {
  /** Lo que se le compra al proveedor: el total de la madera (los gastos del viaje van aparte). */
  woodTotal: number;
  /** Adelantos + abonos + otros abonos. */
  paid: number;
  /** Madera mala o faltante que se le descuenta. */
  deductions: number;
  /** Lo que falta pagar; negativo = se le pagó de más (saldo a favor). */
  balance: number;
};

const round2 = (value: number) => Math.round(value * 100) / 100;

export function timberTripAccount(woodTotal: number, payments: Array<{ kind: string; amount: number }>): TimberTripAccount {
  const sum = (match: (kind: string) => boolean) => round2(payments.filter((p) => match(p.kind)).reduce((total, p) => total + p.amount, 0));
  const paid = sum((kind) => kind !== "RESTA");
  const deductions = sum((kind) => kind === "RESTA");
  return { woodTotal: round2(woodTotal), paid, deductions, balance: round2(woodTotal - paid - deductions) };
}

/** Los movimientos y el saldo del viaje, para la sección "Cuenta con el proveedor". */
export async function getTimberTripPayments(tripId: string) {
  const trip = await prisma.timberTrip.findUnique({
    where: { id: tripId },
    select: { woodTripTotalCost: true, payments: { orderBy: [{ occurredAt: "asc" }, { createdAt: "asc" }] } },
  });
  if (!trip) throw new Error("TIMBER_TRIP_NOT_FOUND");
  const account = timberTripAccount(trip.woodTripTotalCost.toNumber(), trip.payments.map((p) => ({ kind: p.kind, amount: p.amount.toNumber() })));
  return { payments: trip.payments, account };
}

export async function addTimberTripPayment(tripId: string, userId: string, input: CreateTimberTripPaymentInput) {
  const trip = await prisma.timberTrip.findUnique({ where: { id: tripId }, select: { status: true, tripCode: true, destinationBranchId: true } });
  if (!trip) throw new Error("TIMBER_TRIP_NOT_FOUND");
  if (trip.status === "CANCELLED") throw new Error("TRIP_CANCELLED_NO_PAYMENTS");

  await prisma.$transaction(async (tx) => {
    const payment = await tx.timberTripPayment.create({
      data: {
        tripId,
        kind: input.kind,
        amount: new Decimal(input.amount),
        method: input.kind === "RESTA" ? null : input.method ?? null,
        occurredAt: input.occurredAt ?? new Date(),
        notes: input.notes?.trim() || null,
        createdById: userId,
      },
    });
    await tx.auditLog.create({
      data: {
        actorUserId: userId,
        branchId: trip.destinationBranchId,
        module: "timber",
        action: "TIMBER_TRIP_PAYMENT_ADDED",
        entityType: "TimberTrip",
        entityId: tripId,
        metadataJson: { tripCode: trip.tripCode, paymentId: payment.id, kind: payment.kind, amount: input.amount, method: payment.method, notes: payment.notes },
      },
    });
  });
  return getTimberTripPayments(tripId);
}

/** Quitar un movimiento anotado por error. Lo borrado queda en la bitácora con su monto. */
export async function deleteTimberTripPayment(tripId: string, paymentId: string, userId: string) {
  const payment = await prisma.timberTripPayment.findFirst({ where: { id: paymentId, tripId }, include: { trip: { select: { tripCode: true, destinationBranchId: true } } } });
  if (!payment) throw new Error("TIMBER_PAYMENT_NOT_FOUND");
  await prisma.$transaction([
    prisma.timberTripPayment.delete({ where: { id: paymentId } }),
    prisma.auditLog.create({
      data: {
        actorUserId: userId,
        branchId: payment.trip.destinationBranchId,
        module: "timber",
        action: "TIMBER_TRIP_PAYMENT_DELETED",
        entityType: "TimberTrip",
        entityId: tripId,
        metadataJson: {
          tripCode: payment.trip.tripCode,
          paymentId,
          kind: payment.kind,
          amount: payment.amount.toString(),
          method: payment.method,
          occurredAt: payment.occurredAt.toISOString(),
          notes: payment.notes,
        },
      },
    }),
  ]);
  return getTimberTripPayments(tripId);
}
