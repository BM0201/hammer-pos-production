import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { logAuditEvent } from "@/modules/audit/service";

export type CreateEmployeeLoanInput = {
  employeeId: string;
  branchId: string;
  principalAmount: number;
  installmentAmount?: number | null;
  notes?: string | null;
};

export type ListEmployeeLoansFilters = {
  employeeId?: string;
  branchId?: string;
  status?: string;
};

export type UpdateEmployeeLoanInput = {
  installmentAmount?: number | null;
  notes?: string | null;
};

function assertPositiveAmount(value: number, field: string) {
  if (!Number.isFinite(value) || value <= 0) {
    throw new Error(`INVALID_INPUT: ${field} debe ser mayor a 0`);
  }
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

export async function updateEmployeeLoan(id: string, input: UpdateEmployeeLoanInput, actorUserId?: string) {
  if (input.installmentAmount !== undefined && input.installmentAmount !== null) {
    assertPositiveAmount(input.installmentAmount, "installmentAmount");
  }

  const existing = await prisma.employeeLoan.findUnique({ where: { id } });
  if (!existing) throw new Error("EMPLOYEE_LOAN_NOT_FOUND");
  if (existing.status !== "ACTIVE") {
    throw new Error("INVALID_INPUT: Solo se pueden editar prestamos activos");
  }

  const loan = await prisma.employeeLoan.update({
    where: { id },
    data: {
      ...(input.installmentAmount !== undefined
        ? { installmentAmount: input.installmentAmount === null ? null : toDecimal(input.installmentAmount) }
        : {}),
      ...(input.notes !== undefined ? { notes: input.notes?.trim() || null } : {}),
    },
    include: {
      employee: { select: { id: true, fullName: true, position: true } },
      branch: { select: { id: true, code: true, name: true } },
      installments: { orderBy: { createdAt: "desc" }, take: 12 },
    },
  });

  await logAuditEvent({
    actorUserId,
    branchId: loan.branchId,
    module: "payroll",
    action: "employee_loan.updated",
    entityType: "EmployeeLoan",
    entityId: loan.id,
    metadataJson: input,
  });

  return loan;
}

export async function cancelEmployeeLoan(id: string, actorUserId?: string) {
  const existing = await prisma.employeeLoan.findUnique({ where: { id } });
  if (!existing) throw new Error("EMPLOYEE_LOAN_NOT_FOUND");
  if (existing.status !== "ACTIVE") {
    throw new Error("INVALID_INPUT: Solo se pueden cancelar prestamos activos");
  }

  const loan = await prisma.employeeLoan.update({
    where: { id },
    data: { status: "CANCELLED" },
    include: {
      employee: { select: { id: true, fullName: true, position: true } },
      branch: { select: { id: true, code: true, name: true } },
      installments: { orderBy: { createdAt: "desc" }, take: 12 },
    },
  });

  await logAuditEvent({
    actorUserId,
    branchId: loan.branchId,
    module: "payroll",
    action: "employee_loan.cancelled",
    entityType: "EmployeeLoan",
    entityId: loan.id,
    metadataJson: { outstandingBalance: loan.outstandingBalance.toString() },
  });

  return loan;
}

export async function registerManualLoanPayment(id: string, amount: number, actorUserId?: string) {
  assertPositiveAmount(amount, "amount");

  return prisma.$transaction(async (tx) => {
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

    await logAuditEvent({
      actorUserId,
      branchId: loan.branchId,
      module: "payroll",
      action: "employee_loan.manual_payment",
      entityType: "EmployeeLoan",
      entityId: loan.id,
      metadataJson: { amount: paymentAmount, outstandingBalance: nextBalance },
    });

    return loan;
  });
}
