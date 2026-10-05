/**
 * Liquidación de un trabajador — dos modalidades:
 *
 *  - ROLLOVER (liquidación y recontratación INMEDIATA): el empleado SIGUE
 *    ACTIVO. Se paga lo acumulado (aguinaldo proporcional, vacaciones,
 *    indemnización Art. 45 — SIEMPRE, sin causal) y se resetea el reloj de
 *    antigüedad (Employee.lastLiquidationAt) para que la indemnización no
 *    acumule sin límite ("bola de nieve") si nunca se liquida. `startDate`
 *    jamás se toca — es el ingreso real original.
 *  - TERMINATION (baja definitiva): termina el empleo; requiere `causal`
 *    (Arts. 45/48 CT), que decide si la indemnización aplica.
 *
 * El servidor SIEMPRE recalcula el monto desde el estado vivo de la BD (nunca
 * confía en un total que mande el cliente) — mismo principio que ya se aplicó
 * al bug de la quincena partida de INSS.
 */
import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { aguinaldoAccrued, indemnizacionPayout, vacationDaysAccrued, vacationPayout } from "./prestaciones-sociales";
import { vacationDaysTakenByEmployee } from "./employee-vacation-service";

export const SETTLEMENT_KINDS = ["ROLLOVER", "TERMINATION"] as const;
export type SettlementKind = (typeof SETTLEMENT_KINDS)[number];

/** Causales de terminación (Arts. 45/48 CT): deciden si la indemnización se paga. */
export const TERMINATION_CAUSALES = [
  "DESPIDO_SIN_CAUSA",
  "MUTUO_ACUERDO",
  "RENUNCIA_CON_PREAVISO",
  "DESPIDO_CON_CAUSA",
  "RENUNCIA_SIN_PREAVISO",
] as const;
export type TerminationCausal = (typeof TERMINATION_CAUSALES)[number];

const CAUSAL_PAYS_INDEMNIZACION: Record<TerminationCausal, boolean> = {
  DESPIDO_SIN_CAUSA: true,
  MUTUO_ACUERDO: true,
  RENUNCIA_CON_PREAVISO: true,
  DESPIDO_CON_CAUSA: false,
  RENUNCIA_SIN_PREAVISO: false,
};

export type SettleEmployeeInput = {
  kind: SettlementKind;
  causal?: TerminationCausal;
  notes?: string | null;
};

function round2(n: number): number {
  return Math.round((n + Number.EPSILON) * 100) / 100;
}

/**
 * prompt-seguridad-basica.md Fase 1 — Employee no tiene un campo "status":
 * ROLLOVER mantiene isActive=true (solo cambia lastLiquidationAt), así que un
 * CAS plano `where:{isActive:true}` NO frena un doble-ROLLOVER concurrente —
 * hace falta anclar también `lastLiquidationAt` al valor leído BAJO EL LOCK.
 * TERMINATION sí pone isActive=false, así que ahí `where:{isActive:true}`
 * alcanza. El lock (FOR UPDATE) serializa el segundo intento contra el
 * primero; todas las lecturas (empleado, préstamos activos, vacaciones
 * tomadas) se mueven DESPUÉS del lock para que el segundo intento calcule
 * sobre el estado YA actualizado por el primero.
 */
export async function settleEmployeeTx(
  tx: Prisma.TransactionClient,
  employeeId: string,
  input: SettleEmployeeInput,
  actorUserId?: string,
) {
  if (!SETTLEMENT_KINDS.includes(input.kind)) {
    throw new Error("INVALID_INPUT: kind debe ser ROLLOVER o TERMINATION");
  }
  if (input.kind === "TERMINATION" && !input.causal) {
    throw new Error("INVALID_INPUT: causal es requerida para TERMINATION");
  }
  if (input.causal && !TERMINATION_CAUSALES.includes(input.causal)) {
    throw new Error("INVALID_INPUT: causal invalida");
  }

  await tx.$queryRaw`SELECT id FROM "Employee" WHERE id = ${employeeId} FOR UPDATE`;

  const employee = await tx.employee.findUnique({ where: { id: employeeId } });
  if (!employee) throw new Error("EMPLOYEE_NOT_FOUND");
  if (!employee.isActive) throw new Error("ALREADY_PROCESSED");
  const lastLiquidationAtAtLock = employee.lastLiquidationAt;

  const at = new Date();
  const anchor = employee.lastLiquidationAt ?? employee.startDate;
  const salary = Number(employee.monthlySalary);

  const aguinaldo = aguinaldoAccrued(salary, anchor, at);

  const daysAccrued = vacationDaysAccrued(anchor, at);
  const [daysTakenMap, activeLoans] = await Promise.all([
    vacationDaysTakenByEmployee([employeeId], tx),
    tx.employeeLoan.findMany({ where: { employeeId, status: "ACTIVE", outstandingBalance: { gt: 0 } } }),
  ]);
  const daysTaken = daysTakenMap.get(employeeId) ?? 0;
  const vacationDaysBalance = Math.max(0, round2(daysAccrued - daysTaken));
  const vacationValue = vacationPayout(vacationDaysBalance, salary);

  const paysIndemnizacion = input.kind === "ROLLOVER" ? true : CAUSAL_PAYS_INDEMNIZACION[input.causal!];
  const indemnizacion = paysIndemnizacion ? indemnizacionPayout(salary, anchor, at) : 0;

  const loanOutstanding = round2(activeLoans.reduce((sum, l) => sum + Number(l.outstandingBalance), 0));

  const totalPaid = Math.max(0, round2(aguinaldo + vacationValue + indemnizacion - loanOutstanding));

  if (vacationDaysBalance > 0) {
    await tx.vacationEntry.create({
      data: {
        employeeId,
        date: at,
        days: vacationDaysBalance,
        kind: "PAGADAS",
        notes: input.kind === "ROLLOVER" ? "Liquidación y recontratación inmediata" : "Liquidación por baja",
        createdByUserId: actorUserId ?? null,
      },
    });
  }

  for (const loan of activeLoans) {
    const amount = Number(loan.outstandingBalance);
    await tx.employeeLoanInstallment.create({
      data: {
        loanId: loan.id,
        dueYear: at.getFullYear(),
        dueMonth: at.getMonth() + 1,
        amount: new Prisma.Decimal(amount),
        status: "PAID",
        deductedAt: at,
      },
    });
    await tx.employeeLoan.update({ where: { id: loan.id }, data: { outstandingBalance: 0, status: "PAID" } });
  }

  const created = await tx.employeeSettlement.create({
    data: {
      employeeId,
      kind: input.kind,
      causal: input.kind === "TERMINATION" ? input.causal : null,
      date: at,
      aguinaldoPaid: new Prisma.Decimal(aguinaldo),
      vacationDaysPaid: new Prisma.Decimal(vacationDaysBalance),
      vacationValuePaid: new Prisma.Decimal(vacationValue),
      indemnizacionPaid: new Prisma.Decimal(indemnizacion),
      loanDeduction: new Prisma.Decimal(loanOutstanding),
      totalPaid: new Prisma.Decimal(totalPaid),
      notes: input.notes ?? null,
      createdByUserId: actorUserId ?? null,
    },
  });

  if (input.kind === "ROLLOVER") {
    const updateResult = await tx.employee.updateMany({
      where: { id: employeeId, isActive: true, lastLiquidationAt: lastLiquidationAtAtLock },
      data: { lastLiquidationAt: at },
    });
    if (updateResult.count === 0) throw new Error("ALREADY_PROCESSED");
  } else {
    const updateResult = await tx.employee.updateMany({
      where: { id: employeeId, isActive: true },
      data: { isActive: false, endDate: at },
    });
    if (updateResult.count === 0) throw new Error("ALREADY_PROCESSED");
  }

  await tx.auditLog.create({
    data: {
      actorUserId: actorUserId ?? null,
      branchId: employee.branchId,
      module: "payroll",
      action: input.kind === "ROLLOVER" ? "employee.rollover_liquidation" : "employee.termination_liquidation",
      entityType: "Employee",
      entityId: employeeId,
      metadataJson: {
        causal: input.causal ?? null,
        aguinaldo,
        vacationDaysBalance,
        vacationValue,
        indemnizacion,
        loanOutstanding,
        totalPaid,
      } as unknown as Prisma.InputJsonValue,
    },
  });

  return created;
}

export async function settleEmployee(employeeId: string, input: SettleEmployeeInput, actorUserId?: string) {
  return prisma.$transaction((tx) => settleEmployeeTx(tx, employeeId, input, actorUserId));
}

/** Historial de liquidaciones de un empleado (para el drawer). */
export async function listSettlements(employeeId: string) {
  return prisma.employeeSettlement.findMany({ where: { employeeId }, orderBy: { date: "desc" } });
}
