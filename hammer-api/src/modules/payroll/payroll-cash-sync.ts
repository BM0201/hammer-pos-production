import { CashMovementType, CashSessionStatus, Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { logAuditEvent } from "@/modules/audit/service";
import { getActiveCashSession, syncCashSessionSnapshotTx } from "@/modules/cash-session/service";

const PERIOD_LABEL: Record<string, string> = { FIRST_HALF: "1ra", SECOND_HALF: "2da" };

/**
 * Aplica a la caja física todos los PayrollDisbursement PAID con cashMovementId = null
 * de una sucursal, agrupados por payrollRunId + period en un único EXPENSE_OUT por grupo.
 *
 * Llamar dentro de una transacción Prisma activa (tx).
 * Devuelve cuántos grupos se aplicaron.
 */
export async function applyPendingPayrollCashOuts(
  tx: Prisma.TransactionClient,
  branchId: string,
  cashSessionId: string,
  actorUserId: string,
): Promise<number> {
  const pending = await tx.payrollDisbursement.findMany({
    where: { branchId, status: "PAID", cashMovementId: null },
  });
  if (pending.length === 0) return 0;

  // Agrupar por payrollRunId + period — un único CashMovement por grupo
  const groups = new Map<string, typeof pending>();
  for (const d of pending) {
    const key = `${d.payrollRunId}:${d.period}`;
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key)!.push(d);
  }

  let applied = 0;
  for (const [key, rows] of groups) {
    const period = key.split(":")[1];
    const total = rows.reduce((s, r) => s + Number(r.amount), 0);
    if (total <= 0) continue;

    const movement = await tx.cashMovement.create({
      data: {
        cashSessionId,
        type: CashMovementType.EXPENSE_OUT,
        amount: new Prisma.Decimal(total),
        reason: `Nómina ${PERIOD_LABEL[period] ?? period} quincena (${rows.length} empleado${rows.length === 1 ? "" : "s"})`,
        createdByUserId: actorUserId,
      },
    });

    await tx.payrollDisbursement.updateMany({
      where: { id: { in: rows.map((r) => r.id) } },
      data: { cashMovementId: movement.id },
    });

    await logAuditEvent({
      actorUserId,
      branchId,
      module: "payroll",
      action: "payroll_disbursement.cash_applied",
      entityType: "CashMovement",
      entityId: movement.id,
      metadataJson: {
        period,
        total,
        employeeCount: rows.length,
        cashSessionId,
        disbursementIds: rows.map((r) => r.id),
      },
    });

    applied++;
  }

  if (applied > 0) {
    await syncCashSessionSnapshotTx(tx, cashSessionId);
  }
  return applied;
}

/**
 * Punto de entrada post-pago: si hay caja OPEN en la sucursal ahora mismo, aplica
 * de inmediato los disbursements pendientes. Si no, no hace nada (quedan para C.3).
 */
export async function tryApplyPayrollCashOutNow(
  branchId: string,
  actorUserId: string,
): Promise<{ applied: boolean; appliedGroups?: number; reason?: string }> {
  const activeSession = await getActiveCashSession({ branchId });
  if (!activeSession || activeSession.status !== CashSessionStatus.OPEN) {
    return { applied: false, reason: "NO_OPEN_SESSION" };
  }

  return prisma.$transaction(async (tx) => {
    const count = await applyPendingPayrollCashOuts(tx, branchId, activeSession.id, actorUserId);
    return { applied: count > 0, appliedGroups: count };
  });
}
