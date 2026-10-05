import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { logAuditEvent } from "@/modules/audit/service";

export type LoanInstallmentFrequency = "MONTHLY" | "BIWEEKLY";

export type CreateEmployeeLoanInput = {
  employeeId: string;
  branchId: string;
  principalAmount: number;
  installmentAmount?: number | null;
  installmentFrequency?: LoanInstallmentFrequency;
  notes?: string | null;
};

export type ListEmployeeLoansFilters = {
  employeeId?: string;
  branchId?: string;
  status?: string;
};

export type UpdateEmployeeLoanInput = {
  installmentAmount?: number | null;
  installmentFrequency?: LoanInstallmentFrequency;
  notes?: string | null;
};

function assertPositiveAmount(value: number, field: string) {
  if (!Number.isFinite(value) || value <= 0) {
    throw new Error(`INVALID_INPUT: ${field} debe ser mayor a 0`);
  }
}

function normalizeFrequency(value: LoanInstallmentFrequency | undefined): LoanInstallmentFrequency {
  return value === "BIWEEKLY" ? "BIWEEKLY" : "MONTHLY";
}

function toDecimal(value: number) {
  return new Prisma.Decimal(value);
}

export async function createEmployeeLoan(input: CreateEmployeeLoanInput, actorUserId?: string) {
  assertPositiveAmount(input.principalAmount, "principalAmount");
  if (input.installmentAmount !== undefined && input.installmentAmount !== null) {
    assertPositiveAmount(input.installmentAmount, "installmentAmount");
  }

  const employee = await prisma.employee.findUnique({
    where: { id: input.employeeId },
    select: { id: true, branchId: true, fullName: true },
  });
  if (!employee) throw new Error("EMPLOYEE_NOT_FOUND");
  if (employee.branchId !== input.branchId) {
    throw new Error("INVALID_INPUT: La sucursal del prestamo debe coincidir con la sucursal del empleado");
  }

  const branch = await prisma.branch.findUnique({ where: { id: input.branchId }, select: { id: true } });
  if (!branch) throw new Error("BRANCH_NOT_FOUND");

  const principal = toDecimal(input.principalAmount);
  const loan = await prisma.employeeLoan.create({
    data: {
      employeeId: input.employeeId,
      branchId: input.branchId,
      principalAmount: principal,
      outstandingBalance: principal,
      installmentAmount: input.installmentAmount ? toDecimal(input.installmentAmount) : null,
      installmentFrequency: normalizeFrequency(input.installmentFrequency),
      status: "ACTIVE",
      notes: input.notes?.trim() || null,
    },
    include: {
      employee: { select: { id: true, fullName: true, position: true } },
      branch: { select: { id: true, code: true, name: true } },
      installments: { orderBy: { createdAt: "desc" }, take: 12 },
    },
  });

  await logAuditEvent({
    actorUserId,
    branchId: input.branchId,
    module: "payroll",
    action: "employee_loan.created",
    entityType: "EmployeeLoan",
    entityId: loan.id,
    metadataJson: {
      employeeId: input.employeeId,
      principalAmount: input.principalAmount,
      installmentAmount: input.installmentAmount ?? null,
    },
  });

  return loan;
}

export async function listEmployeeLoans(filters: ListEmployeeLoansFilters = {}) {
  return prisma.employeeLoan.findMany({
    where: {
      ...(filters.employeeId ? { employeeId: filters.employeeId } : {}),
      ...(filters.branchId ? { branchId: filters.branchId } : {}),
      ...(filters.status ? { status: filters.status } : {}),
    },
    include: {
      employee: { select: { id: true, fullName: true, position: true } },
      branch: { select: { id: true, code: true, name: true } },
      installments: { orderBy: { createdAt: "desc" }, take: 12 },
    },
    orderBy: [{ status: "asc" }, { issuedAt: "desc" }],
    take: 500,
  });
}

export async function getEmployeeLoan(id: string) {
  return prisma.employeeLoan.findUnique({
    where: { id },
    include: {
      employee: { select: { id: true, fullName: true, position: true } },
      branch: { select: { id: true, code: true, name: true } },
      installments: { orderBy: { createdAt: "desc" } },
    },
  });
}

/**
 * prompt-seguridad-basica.md Fase 1 — mismo patrón lock+CAS que el resto del
 * módulo. `status` es un campo string ("ACTIVE"|"PAID"|"CANCELLED"), no un
 * enum, pero el CAS funciona igual.
 */
export async function updateEmployeeLoanTx(
  tx: Prisma.TransactionClient,
  id: string,
  input: UpdateEmployeeLoanInput,
  actorUserId?: string,
) {
  if (input.installmentAmount !== undefined && input.installmentAmount !== null) {
    assertPositiveAmount(input.installmentAmount, "installmentAmount");
  }

  await tx.$queryRaw`SELECT id FROM "EmployeeLoan" WHERE id = ${id} FOR UPDATE`;

  const existing = await tx.employeeLoan.findUnique({ where: { id } });
  if (!existing) throw new Error("EMPLOYEE_LOAN_NOT_FOUND");
  if (existing.status !== "ACTIVE") throw new Error("ALREADY_PROCESSED");

  const updateResult = await tx.employeeLoan.updateMany({
    where: { id, status: "ACTIVE" },
    data: {
      ...(input.installmentAmount !== undefined
        ? { installmentAmount: input.installmentAmount === null ? null : toDecimal(input.installmentAmount) }
        : {}),
      ...(input.installmentFrequency !== undefined
        ? { installmentFrequency: normalizeFrequency(input.installmentFrequency) }
        : {}),
      ...(input.notes !== undefined ? { notes: input.notes?.trim() || null } : {}),
    },
  });
  if (updateResult.count === 0) throw new Error("ALREADY_PROCESSED");

  const loan = await tx.employeeLoan.findUniqueOrThrow({
    where: { id },
    include: {
      employee: { select: { id: true, fullName: true, position: true } },
      branch: { select: { id: true, code: true, name: true } },
      installments: { orderBy: { createdAt: "desc" }, take: 12 },
    },
  });

  await tx.auditLog.create({
    data: {
      actorUserId: actorUserId ?? null,
      branchId: loan.branchId,
      module: "payroll",
      action: "employee_loan.updated",
      entityType: "EmployeeLoan",
      entityId: loan.id,
      metadataJson: input as unknown as Prisma.InputJsonValue,
    },
  });

  return loan;
}

export async function updateEmployeeLoan(id: string, input: UpdateEmployeeLoanInput, actorUserId?: string) {
  return prisma.$transaction((tx) => updateEmployeeLoanTx(tx, id, input, actorUserId));
}

export async function cancelEmployeeLoanTx(tx: Prisma.TransactionClient, id: string, actorUserId?: string) {
  await tx.$queryRaw`SELECT id FROM "EmployeeLoan" WHERE id = ${id} FOR UPDATE`;

  const existing = await tx.employeeLoan.findUnique({ where: { id } });
  if (!existing) throw new Error("EMPLOYEE_LOAN_NOT_FOUND");
  if (existing.status !== "ACTIVE") throw new Error("ALREADY_PROCESSED");

  const updateResult = await tx.employeeLoan.updateMany({
    where: { id, status: "ACTIVE" },
    data: { status: "CANCELLED" },
  });
  if (updateResult.count === 0) throw new Error("ALREADY_PROCESSED");

  const loan = await tx.employeeLoan.findUniqueOrThrow({
    where: { id },
    include: {
      employee: { select: { id: true, fullName: true, position: true } },
      branch: { select: { id: true, code: true, name: true } },
      installments: { orderBy: { createdAt: "desc" }, take: 12 },
    },
  });

  await tx.auditLog.create({
    data: {
      actorUserId: actorUserId ?? null,
      branchId: loan.branchId,
      module: "payroll",
      action: "employee_loan.cancelled",
      entityType: "EmployeeLoan",
      entityId: loan.id,
      metadataJson: { outstandingBalance: loan.outstandingBalance.toString() } as unknown as Prisma.InputJsonValue,
    },
  });

  return loan;
}

export async function cancelEmployeeLoan(id: string, actorUserId?: string) {
  return prisma.$transaction((tx) => cancelEmployeeLoanTx(tx, id, actorUserId));
}

/**
 * prompt-seguridad-basica.md Fase 1 — esto YA corría dentro de su propia
 * transacción, pero sin FOR UPDATE: dos pagos concurrentes leían el MISMO
 * outstandingBalance y cada uno restaba desde ahí — un pago se perdía
 * (lost update) aunque las dos cuotas (EmployeeLoanInstallment) quedaran
 * creadas. El lock serializa: el segundo pago, tras obtener el lock, lee el
 * balance YA actualizado por el primero.
 */
export async function registerManualLoanPaymentTx(
  tx: Prisma.TransactionClient,
  id: string,
  amount: number,
  actorUserId?: string,
) {
  assertPositiveAmount(amount, "amount");

  await tx.$queryRaw`SELECT id FROM "EmployeeLoan" WHERE id = ${id} FOR UPDATE`;

  const existing = await tx.employeeLoan.findUnique({ where: { id } });
  if (!existing) throw new Error("EMPLOYEE_LOAN_NOT_FOUND");
  if (existing.status !== "ACTIVE") {
    throw new Error("INVALID_INPUT: Solo se pueden registrar pagos en prestamos activos");
  }

  const currentBalance = Number(existing.outstandingBalance);
  const paymentAmount = Math.min(amount, currentBalance);
  const nextBalance = Math.max(0, currentBalance - paymentAmount);
  const now = new Date();

  await tx.employeeLoanInstallment.create({
    data: {
      loanId: existing.id,
      dueYear: now.getFullYear(),
      dueMonth: now.getMonth() + 1,
      amount: toDecimal(paymentAmount),
      status: "PAID",
      deductedAt: now,
    },
  });

  const loan = await tx.employeeLoan.update({
    where: { id },
    data: {
      outstandingBalance: toDecimal(nextBalance),
      status: nextBalance <= 0 ? "PAID" : "ACTIVE",
    },
    include: {
      employee: { select: { id: true, fullName: true, position: true } },
      branch: { select: { id: true, code: true, name: true } },
      installments: { orderBy: { createdAt: "desc" }, take: 12 },
    },
  });

  await tx.auditLog.create({
    data: {
      actorUserId: actorUserId ?? null,
      branchId: loan.branchId,
      module: "payroll",
      action: "employee_loan.manual_payment",
      entityType: "EmployeeLoan",
      entityId: loan.id,
      metadataJson: { amount: paymentAmount, outstandingBalance: nextBalance } as unknown as Prisma.InputJsonValue,
    },
  });

  return loan;
}

export async function registerManualLoanPayment(id: string, amount: number, actorUserId?: string) {
  return prisma.$transaction((tx) => registerManualLoanPaymentTx(tx, id, amount, actorUserId));
}
