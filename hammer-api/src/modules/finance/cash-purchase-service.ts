import { CashMovementType, Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { getActiveCashSession, syncCashSessionSnapshotTx, userCanOperateCashSessionTx } from "@/modules/cash-session/service";
import { logAuditEvent } from "@/modules/audit/service";

/**
 * prompt-caja-gastos-pos-cobro.md Commit 1 — "Compra de mercadería o flete"
 * pagada con caja: arena, bloques, cemento, el flete de traerlos. Dinero que
 * SÍ sale de la caja (CashMovement PURCHASE_OUT, resta igual que un gasto —
 * ver CASH_OUTFLOW_TYPES) pero NUNCA es un gasto operativo: no crea
 * OperatingExpense, así que "Gastos del Local" y el libro de gastos no la
 * cuentan sin necesitar un filtro aparte en cada pantalla.
 *
 * Requiere caja abierta (a diferencia de createOperatingExpense, que puede
 * registrar sin caja abierta): una compra es SIEMPRE "pagué esto ahora", si
 * no hay caja abierta no hay de dónde salió el dinero.
 */
export type CreateCashPurchaseInput = {
  branchId: string;
  amount: number;
  description: string;
  supplierName?: string | null;
  kind: "GOODS" | "FREIGHT";
};

export async function createCashPurchase(input: CreateCashPurchaseInput, actorUserId: string) {
  const activeSession = await getActiveCashSession({ branchId: input.branchId });
  if (!activeSession) {
    throw new Error("VALIDATION_ERROR: no hay una caja abierta en esta sucursal para pagar esta compra.");
  }

  const result = await prisma.$transaction(async (tx) => {
    if (!(await userCanOperateCashSessionTx(tx, { cashSessionId: activeSession.id, userId: actorUserId, branchId: input.branchId }))) {
      throw new Error("CASH_SESSION_OPERATOR_REQUIRED");
    }

    const movement = await tx.cashMovement.create({
      data: {
        cashSessionId: activeSession.id,
        type: CashMovementType.PURCHASE_OUT,
        amount: new Prisma.Decimal(input.amount),
        reason: input.description,
        createdByUserId: actorUserId,
      },
    });

    const purchase = await tx.cashPurchase.create({
      data: {
        branchId: input.branchId,
        amount: new Prisma.Decimal(input.amount),
        description: input.description,
        supplierName: input.supplierName ?? null,
        kind: input.kind,
        cashMovementId: movement.id,
        createdById: actorUserId,
      },
    });

    await syncCashSessionSnapshotTx(tx, activeSession.id);

    return purchase;
  });

  await logAuditEvent({
    actorUserId,
    branchId: input.branchId,
    module: "finance",
    action: "CASH_PURCHASE_CREATED",
    entityType: "CashPurchase",
    entityId: result.id,
    metadataJson: { amount: input.amount, description: input.description, kind: input.kind, supplierName: input.supplierName ?? null },
  });

  return result;
}

/** "Informativo: compras pagadas con caja" en Gastos, y "pendiente de vincular a una Entrada" en Compras. */
export async function listCashPurchasesByBranch(branchId: string, range?: { gte: Date; lt: Date }) {
  return prisma.cashPurchase.findMany({
    where: { branchId, ...(range ? { createdAt: { gte: range.gte, lt: range.lt } } : {}) },
    orderBy: { createdAt: "desc" },
  });
}

/** Vincula una compra ya pagada a la Entrada real cuando el material llega — no mueve inventario, solo deja el rastro. */
export async function linkCashPurchaseToIntake(cashPurchaseId: string, intakeId: string, actorUserId: string) {
  const purchase = await prisma.cashPurchase.findUnique({ where: { id: cashPurchaseId } });
  if (!purchase) throw new Error("NOT_FOUND: compra no encontrada.");
  if (purchase.linkedIntakeId) throw new Error("CONFLICT: esta compra ya está vinculada a una Entrada.");

  const updated = await prisma.cashPurchase.update({ where: { id: cashPurchaseId }, data: { linkedIntakeId: intakeId } });

  await logAuditEvent({
    actorUserId,
    branchId: purchase.branchId,
    module: "finance",
    action: "CASH_PURCHASE_LINKED_TO_INTAKE",
    entityType: "CashPurchase",
    entityId: cashPurchaseId,
    metadataJson: { intakeId },
  });

  return updated;
}
