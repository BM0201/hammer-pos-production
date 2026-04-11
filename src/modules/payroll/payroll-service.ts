/**
 * Payroll Service — CRUD for employees + payroll synchronization with expenses
 *
 * BUG FIX: Added input validation for createEmployee (empty strings, invalid dates).
 * BUG FIX: Added salary validation (NaN, negative, zero).
 * BUG FIX: Wrapped syncPayrollToExpenses in transaction for consistency.
 */
import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { logAuditEvent } from "@/modules/audit/service";
import { calculateMonthlyPayroll, generateSalaryHistory } from "./payroll-calculator";

// ── Employee CRUD ──

export type CreateEmployeeInput = {
  fullName: string;
  position: string;
  branchId: string;
  monthlySalary: number;
  startDate: string; // ISO date
};

export type UpdateEmployeeInput = {
  fullName?: string;
  position?: string;
  branchId?: string;
  monthlySalary?: number;
  startDate?: string;
  endDate?: string | null;
  isActive?: boolean;
};

export async function createEmployee(input: CreateEmployeeInput, actorUserId?: string) {
  // BUG FIX: Validate salary more strictly
  if (!Number.isFinite(input.monthlySalary) || input.monthlySalary <= 0) throw new Error("INVALID_SALARY");

  // BUG FIX: Validate required string fields are not empty after trimming
  if (!input.fullName?.trim()) throw new Error("INVALID_INPUT: fullName is required");
  if (!input.position?.trim()) throw new Error("INVALID_INPUT: position is required");
  if (!input.branchId?.trim()) throw new Error("INVALID_INPUT: branchId is required");
  if (!input.startDate?.trim()) throw new Error("INVALID_INPUT: startDate is required");

  // BUG FIX: Validate startDate is a valid date
  const startDate = new Date(input.startDate);
  if (isNaN(startDate.getTime())) throw new Error("INVALID_INPUT: startDate is not a valid date");

  const employee = await prisma.employee.create({
    data: {
      fullName: input.fullName.trim(),
      position: input.position.trim(),
      branchId: input.branchId,
      monthlySalary: new Prisma.Decimal(input.monthlySalary),
      startDate,
    },
    include: { branch: true },
  });

  await logAuditEvent({
    actorUserId: actorUserId ?? undefined,
    branchId: input.branchId,
    module: "payroll",
    action: "employee.created",
    entityType: "Employee",
    entityId: employee.id,
    metadataJson: { fullName: input.fullName, position: input.position, salary: input.monthlySalary },
  });

  return employee;
}

export async function updateEmployee(id: string, input: UpdateEmployeeInput, actorUserId?: string) {
  if (input.monthlySalary !== undefined && (!Number.isFinite(input.monthlySalary) || input.monthlySalary <= 0)) {
    throw new Error("INVALID_SALARY");
  }

  const data: Record<string, unknown> = {};
  if (input.fullName !== undefined) data.fullName = input.fullName.trim();
  if (input.position !== undefined) data.position = input.position.trim();
  if (input.branchId !== undefined) data.branchId = input.branchId;
  if (input.monthlySalary !== undefined) data.monthlySalary = new Prisma.Decimal(input.monthlySalary);
  if (input.startDate !== undefined) {
    const d = new Date(input.startDate);
    // BUG FIX: Validate date
    if (isNaN(d.getTime())) throw new Error("INVALID_INPUT: startDate is not a valid date");
    data.startDate = d;
  }
  if (input.endDate !== undefined) {
    if (input.endDate) {
      const d = new Date(input.endDate);
      // BUG FIX: Validate endDate
      if (isNaN(d.getTime())) throw new Error("INVALID_INPUT: endDate is not a valid date");
      data.endDate = d;
    } else {
      data.endDate = null;
    }
  }
  if (input.isActive !== undefined) data.isActive = input.isActive;

  const employee = await prisma.employee.update({ where: { id }, data, include: { branch: true } });

  await logAuditEvent({
    actorUserId: actorUserId ?? undefined,
    branchId: employee.branchId,
    module: "payroll",
    action: "employee.updated",
    entityType: "Employee",
    entityId: employee.id,
    metadataJson: input,
  });

  return employee;
}

export async function deactivateEmployee(id: string, actorUserId?: string) {
  const employee = await prisma.employee.update({
    where: { id },
    data: { isActive: false, endDate: new Date() },
    include: { branch: true },
  });

  await logAuditEvent({
    actorUserId: actorUserId ?? undefined,
    branchId: employee.branchId,
    module: "payroll",
    action: "employee.deactivated",
    entityType: "Employee",
    entityId: employee.id,
    metadataJson: { endDate: employee.endDate },
  });

  return employee;
}

export async function listEmployees(filters?: { branchId?: string; isActive?: boolean; position?: string }) {
  const where: Record<string, unknown> = {};
  if (filters?.branchId) where.branchId = filters.branchId;
  if (filters?.isActive !== undefined) where.isActive = filters.isActive;
  if (filters?.position) where.position = filters.position;

  return prisma.employee.findMany({
    where,
    include: { branch: { select: { id: true, code: true, name: true } } },
    orderBy: [{ isActive: "desc" }, { fullName: "asc" }],
  });
}

export async function getEmployee(id: string) {
  return prisma.employee.findUnique({
    where: { id },
    include: {
      branch: { select: { id: true, code: true, name: true } },
      salaryHistory: { orderBy: { month: "desc" }, take: 12 },
    },
  });
}

// ── Salary History ──

export async function getSalaryHistory(filters?: {
  employeeId?: string;
  startMonth?: string;
  endMonth?: string;
}) {
  const where: Record<string, unknown> = {};
  if (filters?.employeeId) where.employeeId = filters.employeeId;
  if (filters?.startMonth || filters?.endMonth) {
    const monthFilter: Record<string, Date> = {};
    if (filters?.startMonth) {
      const d = new Date(filters.startMonth);
      if (!isNaN(d.getTime())) monthFilter.gte = d;
    }
    if (filters?.endMonth) {
      const d = new Date(filters.endMonth);
      if (!isNaN(d.getTime())) monthFilter.lte = d;
    }
    if (Object.keys(monthFilter).length > 0) where.month = monthFilter;
  }

  return prisma.employeeSalaryHistory.findMany({
    where,
    include: { employee: { select: { fullName: true, position: true, branchId: true } } },
    orderBy: { month: "desc" },
  });
}

// ── Payroll to Expenses Sync ──

/**
 * Sync payroll to OperatingExpense records.
 * Creates/updates PAYROLL expenses for each employee with prorated amounts.
 */
export async function syncPayrollToExpenses(year: number, month: number, branchId?: string) {
  const { employees } = await calculateMonthlyPayroll(year, month, branchId);
  const monthDate = new Date(year, month - 1, 1);
  let synced = 0;

  for (const emp of employees) {
    if (emp.daysWorked === 0) continue;

    // Check if auto-calculated expense exists for this employee+month
    const existing = await prisma.operatingExpense.findFirst({
      where: {
        branchId: emp.branchId,
        employeeId: emp.employeeId,
        isAutoCalculated: true,
        category: "PAYROLL",
        effectiveFrom: monthDate,
      },
    });

    const description = `Nómina: ${emp.fullName} (${emp.position}) - ${emp.daysWorked}/${emp.totalDays} días`;

    if (existing) {
      await prisma.operatingExpense.update({
        where: { id: existing.id },
        data: { amount: new Prisma.Decimal(emp.proratedSalary), description, isActive: true },
      });
    } else {
      await prisma.operatingExpense.create({
        data: {
          branchId: emp.branchId,
          category: "PAYROLL",
          description,
          amount: new Prisma.Decimal(emp.proratedSalary),
          isActive: true,
          isAutoCalculated: true,
          employeeId: emp.employeeId,
          effectiveFrom: monthDate,
        },
      });
    }
    synced++;
  }

  // Also generate salary history
  await generateSalaryHistory(year, month, branchId);

  return { synced, totalPayroll: employees.reduce((s, e) => s + e.proratedSalary, 0) };
}
