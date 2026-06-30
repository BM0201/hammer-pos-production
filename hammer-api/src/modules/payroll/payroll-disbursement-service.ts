import { Prisma, PayrollDisbursementPeriod, PayrollDisbursementStatus } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { logAuditEvent } from "@/modules/audit/service";
import { tryApplyPayrollCashOutNow } from "@/modules/payroll/payroll-cash-sync";

function decimal(v: number): Prisma.Decimal {
  return new Prisma.Decimal(v);
}

function round2(v: number): number {
  return Math.round(v * 100) / 100;
}

/** Día 15 del mes dado. */
function scheduledFirstHalf(year: number, month: number): Date {
  return new Date(year, month - 1, 15);
}

/** Último día del mes dado. */
function scheduledSecondHalf(year: number, month: number): Date {
  return new Date(year, month, 0); // day 0 of next month = last day of this month
}

/**
 * Genera (o regenera) los dos disbursements 50/50 de cada PayrollLine de una corrida.
 * Seguro de repetir: borra solo los PENDING existentes; lanza error si alguno ya está PAID.
 */
export async function generateDisbursementsForRun(
  payrollRunId: string,
  tx?: Prisma.TransactionClient,
): Promise<void> {
  const db = tx ?? prisma;

  const run = await db.payrollRun.findUniqueOrThrow({
    where: { id: payrollRunId },
    include: {
      lines: {
        include: { employee: { select: { id: true, branchId: true } } },
      },
    },
  });

  for (const line of run.lines) {
    // Guard: no pisar disbursements ya pagados
    const paidCount = await db.payrollDisbursement.count({
      where: { payrollLineId: line.id, status: PayrollDisbursementStatus.PAID },
    });
    if (paidCount > 0) {
      throw new Error(
        `PAYROLL_LINE_HAS_PAID_DISBURSEMENT: La línea ${line.id} ya tiene un pago registrado. No se puede recalcular.`,
      );
    }

    await db.payrollDisbursement.deleteMany({
      where: { payrollLineId: line.id, status: PayrollDisbursementStatus.PENDING },
    });

    const netPay = Number(line.netPay);
    const firstHalf = round2(netPay / 2);
    const secondHalf = round2(netPay - firstHalf);
    const branchId = line.employee.branchId;

    await db.payrollDisbursement.createMany({
      data: [
        {
          payrollRunId,
          payrollLineId: line.id,
          employeeId: line.employeeId,
          branchId,
          period: PayrollDisbursementPeriod.FIRST_HALF,
          amount: decimal(firstHalf),
          status: PayrollDisbursementStatus.PENDING,
          scheduledDate: scheduledFirstHalf(run.year, run.month),
        },
        {
          payrollRunId,
          payrollLineId: line.id,
          employeeId: line.employeeId,
          branchId,
          period: PayrollDisbursementPeriod.SECOND_HALF,
          amount: decimal(secondHalf),
          status: PayrollDisbursementStatus.PENDING,
          scheduledDate: scheduledSecondHalf(run.year, run.month),
        },
      ],
    });
  }
}

/**
 * Marca como PAID todos los disbursements de una corrida y período, y crea el gasto operativo
 * correspondiente en la fecha real de desembolso.
 */
export async function payDisbursementsForPeriod(
  payrollRunId: string,
  period: "FIRST_HALF" | "SECOND_HALF",
  actorUserId: string,
): Promise<{ paid: number; cashSync: Array<{ branchId: string; applied: boolean; appliedGroups?: number; reason?: string }> }> {
  const run = await prisma.payrollRun.findUnique({ where: { id: payrollRunId } });
  if (!run) throw new Error("PAYROLL_RUN_NOT_FOUND");
  if (run.status !== "POSTED") {
    throw new Error(
      "INVALID_INPUT: La nomina debe estar posteada antes de pagar una quincena",
    );
  }

  const periodEnum =
    period === "FIRST_HALF" ? PayrollDisbursementPeriod.FIRST_HALF : PayrollDisbursementPeriod.SECOND_HALF;

  const disbursements = await prisma.payrollDisbursement.findMany({
    where: { payrollRunId, period: periodEnum, status: PayrollDisbursementStatus.PENDING },
    include: { employee: { select: { id: true, fullName: true } } },
  });

  if (disbursements.length === 0) {
    return { paid: 0, cashSync: [] };
  }

  const now = new Date();
  let paid = 0;

  await prisma.$transaction(async (tx) => {
    for (const d of disbursements) {
      await tx.payrollDisbursement.update({
        where: { id: d.id },
        data: {
          status: PayrollDisbursementStatus.PAID,
          paidAt: now,
          paidByUserId: actorUserId,
        },
      });

      const description = `Nómina (${period === "FIRST_HALF" ? "1ra" : "2da"} quincena): ${d.employee.fullName}`;

      const existing = await tx.operatingExpense.findFirst({
        where: {
          branchId: d.branchId,
          employeeId: d.employeeId,
          isAutoCalculated: true,
          category: "PAYROLL",
          effectiveFrom: d.scheduledDate,
        },
      });

      if (existing) {
        await tx.operatingExpense.update({
          where: { id: existing.id },
          data: { amount: d.amount, description, isActive: true, effectiveTo: d.scheduledDate },
        });
      } else {
        await tx.operatingExpense.create({
          data: {
            branchId: d.branchId,
            employeeId: d.employeeId,
            category: "PAYROLL",
            description,
            amount: d.amount,
            isActive: true,
            isAutoCalculated: true,
            effectiveFrom: d.scheduledDate,
            effectiveTo: d.scheduledDate,
          },
        });
      }

      await logAuditEvent({
        actorUserId,
        branchId: d.branchId,
        module: "payroll",
        action: "payroll_disbursement.paid",
        entityType: "PayrollDisbursement",
        entityId: d.id,
        metadataJson: {
          payrollRunId,
          period,
          amount: Number(d.amount),
          employeeId: d.employeeId,
          scheduledDate: d.scheduledDate,
        },
      });

      paid++;
    }
  });

  // Intentar aplicar a caja inmediatamente en cada sucursal afectada
  const affectedBranchIds = [...new Set(disbursements.map((d) => d.branchId))];
  const cashSyncResults = await Promise.all(
    affectedBranchIds.map((branchId) => tryApplyPayrollCashOutNow(branchId, actorUserId)),
  );

  return {
    paid,
    cashSync: affectedBranchIds.map((branchId, i) => ({ branchId, ...cashSyncResults[i] })),
  };
}

/** Lista disbursements pendientes, opcionalmente filtrados por sucursal y período. */
export async function listPendingDisbursements(
  branchId?: string,
  period?: "FIRST_HALF" | "SECOND_HALF",
) {
  const periodEnum = period
    ? period === "FIRST_HALF"
      ? PayrollDisbursementPeriod.FIRST_HALF
      : PayrollDisbursementPeriod.SECOND_HALF
    : undefined;

  return prisma.payrollDisbursement.findMany({
    where: {
      ...(branchId ? { branchId } : {}),
      ...(periodEnum ? { period: periodEnum } : {}),
      status: PayrollDisbursementStatus.PENDING,
    },
    include: {
      employee: { select: { id: true, fullName: true, position: true } },
      payrollRun: { select: { id: true, year: true, month: true, status: true } },
    },
    orderBy: [{ scheduledDate: "asc" }, { branchId: "asc" }],
  });
}

/** Lista todos los disbursements de una corrida específica. */
export async function listDisbursementsByRun(payrollRunId: string) {
  return prisma.payrollDisbursement.findMany({
    where: { payrollRunId },
    include: {
      employee: { select: { id: true, fullName: true, position: true } },
    },
    orderBy: [{ period: "asc" }, { employeeId: "asc" }],
  });
}

/**
 * Estado de aplicación a caja de los disbursements PAID de una corrida, agrupado por sucursal.
 * Útil para que el frontend muestre qué sucursales ya descontaron la nómina de su caja física
 * y cuáles quedan pendientes (se aplicarán automáticamente al abrir la próxima caja).
 */
export async function getCashStatusByRun(payrollRunId: string) {
  const disbursements = await prisma.payrollDisbursement.findMany({
    where: { payrollRunId, status: PayrollDisbursementStatus.PAID },
    include: { branch: { select: { id: true, code: true, name: true } } },
  });

  const byBranch = new Map<
    string,
    { branchId: string; branchCode: string; branchName: string; appliedCount: number; appliedAmount: number; pendingCount: number; pendingAmount: number }
  >();

  for (const d of disbursements) {
    if (!byBranch.has(d.branchId)) {
      byBranch.set(d.branchId, {
        branchId: d.branchId,
        branchCode: d.branch.code,
        branchName: d.branch.name,
        appliedCount: 0,
        appliedAmount: 0,
        pendingCount: 0,
        pendingAmount: 0,
      });
    }
    const entry = byBranch.get(d.branchId)!;
    if (d.cashMovementId) {
      entry.appliedCount++;
      entry.appliedAmount = round2(entry.appliedAmount + Number(d.amount));
    } else {
      entry.pendingCount++;
      entry.pendingAmount = round2(entry.pendingAmount + Number(d.amount));
    }
  }

  return [...byBranch.values()].sort((a, b) => a.branchCode.localeCompare(b.branchCode));
}
