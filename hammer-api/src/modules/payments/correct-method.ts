import { PaymentMethod, PaymentStatus, Prisma, SaleOrderStatus } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { syncCashSessionSnapshotTx } from "@/modules/cash-session/service";
import { recordSaleTenderEntriesTx } from "@/modules/treasury/service";

export const PAYMENT_METHOD_CORRECTED = "PAYMENT_METHOD_CORRECTED";

export type CorrectMethodInput = {
  paymentTenderId: string;
  method: "CARD" | "TRANSFER";
  referenceNumber: string;
  bankAccountId?: string | null;
  reason: string;
  actorUserId: string;
};

/**
 * Qué se puede corregir (pura, con prueba): solo un cobro en EFECTIVO
 * córdobas ya posteado, de una venta no anulada, que en realidad entró por
 * tarjeta o transferencia. Es el error que deja la caja corta por el monto
 * entero (Rivas 2026-11-20). Cualquier otro cambio es una devolución/anulación.
 */
export function assertTenderCorrectable(
  tender: { method: string; receivedUsdAmount?: unknown },
  payment: { status: string },
  orderStatus: string | null,
  input: Pick<CorrectMethodInput, "method" | "referenceNumber" | "bankAccountId" | "reason">,
) {
  if (payment.status !== PaymentStatus.POSTED) throw new Error("PAYMENT_NOT_POSTED");
  if (orderStatus === SaleOrderStatus.CANCELLED) throw new Error("SALE_ORDER_CANCELLED");
  if (tender.method !== PaymentMethod.CASH) throw new Error("TENDER_NOT_CASH");
  if (tender.receivedUsdAmount != null) throw new Error("TENDER_IS_USD");
  if (!input.referenceNumber.trim()) throw new Error("PAYMENT_REFERENCE_REQUIRED");
  if (input.method === "TRANSFER" && !input.bankAccountId) throw new Error("PAYMENT_BANK_ACCOUNT_REQUIRED");
  if (!input.reason.trim()) throw new Error("CORRECTION_REASON_REQUIRED");
}

/**
 * Master corrige un cobro anotado como efectivo que entró por tarjeta o
 * transferencia: cambia el tender, lo registra en el libro de tesorería como
 * la venta original (misma fecha) y recalcula el esperado de la caja — si ya
 * estaba cerrada, la diferencia contra lo contado se recalcula sola. Lo
 * contado y el destino declarado no cambian (es plata física, no se tocó).
 */
export async function correctTenderMethod(input: CorrectMethodInput) {
  return prisma.$transaction(async (tx) => {
    const tender = await tx.paymentTender.findUniqueOrThrow({
      where: { id: input.paymentTenderId },
      select: {
        id: true, method: true, amount: true, receivedAmount: true, changeAmount: true, referenceNumber: true, receivedUsdAmount: true,
        payment: {
          select: {
            id: true, status: true, paidAt: true, cashSessionId: true,
            tenders: { select: { id: true } },
            saleOrder: { select: { id: true, orderNumber: true, status: true, branchId: true } },
          },
        },
      },
    });
    const { payment } = tender;
    await tx.$queryRaw`SELECT id FROM "Payment" WHERE id = ${payment.id} FOR UPDATE`;
    assertTenderCorrectable(tender, payment, payment.saleOrder?.status ?? null, input);

    const method = input.method === "CARD" ? PaymentMethod.CARD : PaymentMethod.TRANSFER;
    const updated = await tx.paymentTender.update({
      where: { id: tender.id },
      data: {
        method,
        referenceNumber: input.referenceNumber.trim(),
        bankAccountId: method === PaymentMethod.TRANSFER ? input.bankAccountId! : null,
        receivedAmount: null,
        changeAmount: null,
      },
      select: { id: true, method: true, amount: true, bankAccountId: true },
    });
    if (payment.tenders.length === 1) {
      await tx.payment.update({ where: { id: payment.id }, data: { method, referenceNumber: input.referenceNumber.trim() } });
    }
    await recordSaleTenderEntriesTx(tx, { tenders: [updated], occurredAt: payment.paidAt ?? new Date(), createdByUserId: input.actorUserId });
    if (payment.cashSessionId) await syncCashSessionSnapshotTx(tx, payment.cashSessionId);

    await tx.auditLog.create({
      data: {
        actorUserId: input.actorUserId,
        branchId: payment.saleOrder?.branchId ?? null,
        module: "payments",
        action: PAYMENT_METHOD_CORRECTED,
        entityType: "PaymentTender",
        entityId: tender.id,
        metadataJson: {
          orderNumber: payment.saleOrder?.orderNumber ?? null,
          amount: Number(tender.amount),
          from: { method: tender.method, receivedAmount: tender.receivedAmount == null ? null : Number(tender.receivedAmount), changeAmount: tender.changeAmount == null ? null : Number(tender.changeAmount) },
          to: { method, referenceNumber: input.referenceNumber.trim(), bankAccountId: updated.bankAccountId },
          reason: input.reason.trim(),
          cashSessionId: payment.cashSessionId,
        } satisfies Prisma.InputJsonValue,
      },
    });
    return { paymentTenderId: tender.id, method, amount: Number(tender.amount) };
  });
}
