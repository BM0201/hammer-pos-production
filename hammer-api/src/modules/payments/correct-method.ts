import { PaymentMethod, PaymentStatus, Prisma, SaleOrderStatus } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { makeDecisionFingerprint } from "@/modules/brain/scoring";
import { buildCloseDiscrepancySignal, syncCashSessionSnapshotTx } from "@/modules/cash-session/service";
import { raiseCashDiscrepancy } from "@/modules/treasury/discrepancy-signals";
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
  dayConfirmed = false,
) {
  if (payment.status !== PaymentStatus.POSTED) throw new Error("PAYMENT_NOT_POSTED");
  // Un día ya firmado no cambia por debajo: se reabre en Día operativo y se vuelve a firmar.
  if (dayConfirmed) throw new Error("OPERATIONAL_DAY_ALREADY_CONFIRMED");
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
            operationalDay: { select: { reviewStatus: true } },
            cashSession: { select: { operationalDay: { select: { reviewStatus: true } } } },
            tenders: { select: { id: true } },
            saleOrder: { select: { id: true, orderNumber: true, status: true, branchId: true } },
          },
        },
      },
    });
    const { payment } = tender;
    await tx.$queryRaw`SELECT id FROM "Payment" WHERE id = ${payment.id} FOR UPDATE`;
    const dayConfirmed = [payment.operationalDay, payment.cashSession.operationalDay].some((d) => d?.reviewStatus === "CONFIRMED");
    assertTenderCorrectable(tender, payment, payment.saleOrder?.status ?? null, input, dayConfirmed);

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
    await syncCashSessionSnapshotTx(tx, payment.cashSessionId);
    await refreshCloseDiscrepancyTx(tx, payment.cashSessionId, input.actorUserId);

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

/**
 * El aviso "Descuadre al cerrar caja" de Brain se escribió con la diferencia
 * del cierre. Tras corregir un cobro la diferencia cambia: se reescribe con
 * los números nuevos, o se cierra solo si ya quedó dentro del umbral.
 */
async function refreshCloseDiscrepancyTx(tx: Prisma.TransactionClient, cashSessionId: string, actorUserId: string) {
  const fingerprint = makeDecisionFingerprint(["cash-session", "close-discrepancy", cashSessionId]);
  const decision = await tx.brainDecision.findUnique({ where: { fingerprint }, select: { id: true, status: true, evidenceJson: true } });
  if (!decision) return;
  const session = await tx.cashSession.findUniqueOrThrow({
    where: { id: cashSessionId },
    select: { expectedCashAmount: true, countedCashAmount: true, differenceAmount: true, physicalCashBoxId: true, physicalCashBox: { select: { code: true, branchId: true } } },
  });
  const difference = Number(session.differenceAmount ?? 0);
  const threshold = Number((decision.evidenceJson as { threshold?: number } | null)?.threshold ?? 0);
  if (Math.abs(difference) > threshold) {
    await raiseCashDiscrepancy(tx, buildCloseDiscrepancySignal({
      physicalCashBoxCode: session.physicalCashBox.code,
      physicalCashBoxId: session.physicalCashBoxId,
      branchId: session.physicalCashBox.branchId,
      cashSessionId,
      expectedCash: Number(session.expectedCashAmount ?? 0),
      countedCash: Number(session.countedCashAmount ?? 0),
      difference,
      threshold,
    }));
    return;
  }
  if (decision.status === "RESOLVED") return;
  await tx.brainDecision.update({
    where: { id: decision.id },
    data: { status: "RESOLVED", resolvedAt: new Date(), resolvedByUserId: actorUserId, resolutionSource: "USER", resolutionNote: "Cuadró al corregir el método de un cobro." },
  });
}
