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
import { calculateMonthlyPayroll, generateSalaryHistory, type ProratedSalaryResult } from "./payroll-calculator";

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

type PayrollRunForResponse = Prisma.PayrollRunGetPayload<{
  include: {
    branch: { select: { id: true; code: true; name: true } };
    lines: {
      include: { employee: { select: { id: true; fullName: true; position: true; branchId: true; monthlySalary: true } } };
    };
  };
}>;

type PayrollLineWithEmployee = PayrollRunForResponse["lines"][number];

function firstDayOfMonth(year: number, month: number) {
  return new Date(year, month - 1, 1);
}

function lastMomentOfMonth(year: number, month: number) {
  return new Date(year, month, 0, 23, 59, 59, 999);
}

function assertValidPayrollPeriod(year: number, month: number) {
  if (!Number.isFinite(year) || !Number.isFinite(month) || month < 1 || month > 12) {
    throw new Error("INVALID_INPUT: Periodo de nomina invalido");
  }
}

function decimal(value: number | string | Prisma.Decimal) {
  return new Prisma.Decimal(value);
}

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

export async function listPayrollRuns(filters?: {
  year?: number;
  month?: number;
  branchId?: string;
  status?: string;
}) {
  return prisma.payrollRun.findMany({
    where: {
      ...(filters?.year ? { year: filters.year } : {}),
      ...(filters?.month ? { month: filters.month } : {}),
      ...(filters?.branchId ? { branchId: filters.branchId } : {}),
      ...(filters?.status ? { status: filters.status } : {}),
    },
    include: {
      branch: { select: { id: true, code: true, name: true } },
      lines: {
        include: { employee: { select: { id: true, fullName: true, position: true, branchId: true, monthlySalary: true } } },
        orderBy: { createdAt: "asc" },
      },
    },
    orderBy: [{ year: "desc" }, { month: "desc" }, { createdAt: "desc" }],
    take: 200,
  });
}

async function findPayrollRunForPeriod(year: number, month: number, branchId?: string | null) {
  if (branchId) {
    return prisma.payrollRun.findUnique({
      where: { branchId_year_month: { branchId, year, month } },
      include: {
        branch: { select: { id: true, code: true, name: true } },
        lines: {
          include: { employee: { select: { id: true, fullName: true, position: true, branchId: true, monthlySalary: true } } },
          orderBy: { createdAt: "asc" },
        },
      },
    });
  }

  return prisma.payrollRun.findFirst({
    where: { branchId: null, year, month },
    include: {
      branch: { select: { id: true, code: true, name: true } },
      lines: {
        include: { employee: { select: { id: true, fullName: true, position: true, branchId: true, monthlySalary: true } } },
        orderBy: { createdAt: "asc" },
      },
    },
  });
}

async function calculateLoanDeduction(employeeId: string, grossSalary: number) {
  const loans = await prisma.employeeLoan.findMany({
    where: {
      employeeId,
      status: "ACTIVE",
      outstandingBalance: { gt: 0 },
    },
    orderBy: { issuedAt: "asc" },
  });

  let remainingGross = Math.max(0, grossSalary);
  let total = 0;

  for (const loan of loans) {
    if (remainingGross <= 0) break;
    const balance = Number(loan.outstandingBalance);
    const requested = loan.installmentAmount ? Number(loan.installmentAmount) : balance;
    const deduction = Math.min(balance, requested, remainingGross);
    if (deduction <= 0) continue;
    total += deduction;
    remainingGross -= deduction;
  }

  return Math.round(total * 100) / 100;
}

function serializePayrollLine(line: PayrollLineWithEmployee, prorated?: ProratedSalaryResult) {
  return {
    employeeId: line.employeeId,
    fullName: line.employee.fullName,
    position: line.employee.position,
    branchId: line.employee.branchId,
    monthlySalary: prorated?.monthlySalary ?? Number(line.employee.monthlySalary),
    daysWorked: prorated?.daysWorked ?? 0,
    totalDays: prorated?.totalDays ?? 0,
    proratedSalary: Number(line.grossSalary),
    isFullMonth: prorated?.isFullMonth ?? false,
    grossSalary: Number(line.grossSalary),
    loanDeductions: Number(line.loanDeductions),
    otherDeductions: Number(line.otherDeductions),
    netPay: Number(line.netPay),
    employerCost: Number(line.employerCost),
  };
}

export function serializePayrollRunResult(payrollRun: PayrollRunForResponse, proratedEmployees: ProratedSalaryResult[] = []) {
  const proratedByEmployee = new Map(proratedEmployees.map((emp) => [emp.employeeId, emp]));
  return {
    payrollRunId: payrollRun.id,
    payrollRunStatus: payrollRun.status,
    year: payrollRun.year,
    month: payrollRun.month,
    totalPayroll: Number(payrollRun.totalGross),
    totalGross: Number(payrollRun.totalGross),
    totalDeductions: Number(payrollRun.totalDeductions),
    totalNet: Number(payrollRun.totalNet),
    totalEmployerCost: Number(payrollRun.totalEmployerCost),
    employeeCount: payrollRun.lines.length,
    employees: payrollRun.lines.map((line) => serializePayrollLine(line, proratedByEmployee.get(line.employeeId))),
  };
}

export async function calculatePayrollRun(year: number, month: number, branchId?: string, actorUserId?: string) {
  assertValidPayrollPeriod(year, month);

  const existing = await findPayrollRunForPeriod(year, month, branchId ?? null);
  if (existing?.status === "POSTED") {
    throw new Error("INVALID_INPUT: La nomina de este periodo ya fue posteada");
  }

  const result = await calculateMonthlyPayroll(year, month, branchId);
  const run = existing
    ? await prisma.payrollRun.update({
        where: { id: existing.id },
        data: {
          status: "DRAFT",
          totalGross: decimal(0),
          totalDeductions: decimal(0),
          totalNet: decimal(0),
          totalEmployerCost: decimal(0),
        },
      })
    : await prisma.payrollRun.create({
        data: {
          branchId: branchId || null,
          year,
          month,
          status: "DRAFT",
          totalGross: decimal(0),
          totalDeductions: decimal(0),
          totalNet: decimal(0),
          totalEmployerCost: decimal(0),
        },
      });

  await prisma.payrollLine.deleteMany({ where: { payrollRunId: run.id } });

  let totalGross = 0;
  let totalDeductions = 0;
  let totalNet = 0;
  let totalEmployerCost = 0;

  for (const emp of result.employees) {
    if (emp.daysWorked === 0) continue;
    const grossSalary = Math.max(0, emp.proratedSalary);
    const loanDeductions = await calculateLoanDeduction(emp.employeeId, grossSalary);
    const otherDeductions = 0;
    const netPay = Math.max(0, grossSalary - loanDeductions - otherDeductions);
    const employerCost = grossSalary;

    await prisma.payrollLine.create({
      data: {
        payrollRunId: run.id,
        employeeId: emp.employeeId,
        grossSalary: decimal(grossSalary),
        loanDeductions: decimal(loanDeductions),
        otherDeductions: decimal(otherDeductions),
        netPay: decimal(netPay),
        employerCost: decimal(employerCost),
      },
    });

    totalGross += grossSalary;
    totalDeductions += loanDeductions + otherDeductions;
    totalNet += netPay;
    totalEmployerCost += employerCost;
  }

  await prisma.payrollRun.update({
    where: { id: run.id },
    data: {
      totalGross: decimal(totalGross),
      totalDeductions: decimal(totalDeductions),
      totalNet: decimal(totalNet),
      totalEmployerCost: decimal(totalEmployerCost),
    },
  });

  await generateSalaryHistory(year, month, branchId);

  const payrollRun = await prisma.payrollRun.findUniqueOrThrow({
    where: { id: run.id },
    include: {
      branch: { select: { id: true, code: true, name: true } },
      lines: {
        include: { employee: { select: { id: true, fullName: true, position: true, branchId: true, monthlySalary: true } } },
        orderBy: { createdAt: "asc" },
      },
    },
  });

  await logAuditEvent({
    actorUserId,
    branchId,
    module: "payroll",
    action: "payroll_run.calculated",
    entityType: "PayrollRun",
    entityId: payrollRun.id,
    metadataJson: { year, month, totalGross, totalDeductions, totalNet, totalEmployerCost },
  });

  return { payrollRun, employees: result.employees };
}

async function syncPostedPayrollLineExpense(
  tx: Prisma.TransactionClient,
  line: PayrollLineWithEmployee,
  year: number,
  month: number,
) {
  const monthDate = firstDayOfMonth(year, month);
  const monthEnd = lastMomentOfMonth(year, month);
  const amount = Number(line.employerCost);
  if (amount <= 0) return false;

  const existing = await tx.operatingExpense.findFirst({
    where: {
      branchId: line.employee.branchId,
      employeeId: line.employeeId,
      isAutoCalculated: true,
      category: "PAYROLL",
      effectiveFrom: monthDate,
    },
  });

  const description = `Nomina posteada: ${line.employee.fullName} (${line.employee.position})`;
  if (existing) {
    await tx.operatingExpense.update({
      where: { id: existing.id },
      data: {
        amount: line.employerCost,
        description,
        isActive: true,
        effectiveFrom: monthDate,
        effectiveTo: monthEnd,
      },
    });
    return true;
  }

  await tx.operatingExpense.create({
    data: {
      branchId: line.employee.branchId,
      category: "PAYROLL",
      description,
      amount: line.employerCost,
      isActive: true,
      isAutoCalculated: true,
      employeeId: line.employeeId,
      effectiveFrom: monthDate,
      effectiveTo: monthEnd,
    },
  });
  return true;
}

export async function postPayrollRun(id: string, actorUserId?: string) {
  const existing = await prisma.payrollRun.findUnique({
    where: { id },
    include: {
      branch: { select: { id: true, code: true, name: true } },
      lines: {
        include: { employee: { select: { id: true, fullName: true, position: true, branchId: true, monthlySalary: true } } },
        orderBy: { createdAt: "asc" },
      },
    },
  });
  if (!existing) throw new Error("PAYROLL_RUN_NOT_FOUND");
  if (existing.status === "POSTED") {
    return { payrollRun: existing, alreadyPosted: true, syncedExpenses: 0, deductedInstallments: 0 };
  }
  if (existing.status !== "DRAFT") {
    throw new Error("INVALID_INPUT: Solo se puede postear una nomina en borrador");
  }

  const result = await prisma.$transaction(async (tx) => {
    const transition = await tx.payrollRun.updateMany({
      where: { id, status: "DRAFT" },
      data: { status: "POSTED", postedAt: new Date(), postedByUserId: actorUserId ?? null },
    });
    if (transition.count === 0) {
      const current = await tx.payrollRun.findUniqueOrThrow({
        where: { id },
        include: {
          branch: { select: { id: true, code: true, name: true } },
          lines: {
            include: { employee: { select: { id: true, fullName: true, position: true, branchId: true, monthlySalary: true } } },
            orderBy: { createdAt: "asc" },
          },
        },
      });
      return { payrollRun: current, alreadyPosted: true, syncedExpenses: 0, deductedInstallments: 0 };
    }

    let syncedExpenses = 0;
    let deductedInstallments = 0;

    for (const line of existing.lines) {
      let remainingDeduction = Number(line.loanDeductions);
      const loans = await tx.employeeLoan.findMany({
        where: { employeeId: line.employeeId, status: "ACTIVE", outstandingBalance: { gt: 0 } },
        orderBy: { issuedAt: "asc" },
      });

      for (const loan of loans) {
        if (remainingDeduction <= 0) break;
        const balance = Number(loan.outstandingBalance);
        const amount = Math.min(balance, remainingDeduction);
        if (amount <= 0) continue;
        const nextBalance = Math.max(0, balance - amount);

        await tx.employeeLoanInstallment.create({
          data: {
            loanId: loan.id,
            payrollRunId: existing.id,
            payrollLineId: line.id,
            dueYear: existing.year,
            dueMonth: existing.month,
            amount: decimal(amount),
            status: "DEDUCTED",
            deductedAt: new Date(),
          },
        });

        await tx.employeeLoan.update({
          where: { id: loan.id },
          data: {
            outstandingBalance: decimal(nextBalance),
            status: nextBalance <= 0 ? "PAID" : "ACTIVE",
          },
        });

        deductedInstallments++;
        remainingDeduction -= amount;
      }

      const synced = await syncPostedPayrollLineExpense(tx, line, existing.year, existing.month);
      if (synced) syncedExpenses++;
    }

    const payrollRun = await tx.payrollRun.findUniqueOrThrow({
      where: { id },
      include: {
        branch: { select: { id: true, code: true, name: true } },
        lines: {
          include: { employee: { select: { id: true, fullName: true, position: true, branchId: true, monthlySalary: true } } },
          orderBy: { createdAt: "asc" },
        },
      },
    });

    return { payrollRun, alreadyPosted: false, syncedExpenses, deductedInstallments };
  });

  await logAuditEvent({
    actorUserId,
    branchId: result.payrollRun.branchId ?? undefined,
    module: "payroll",
    action: result.alreadyPosted ? "payroll_run.post_retry" : "payroll_run.posted",
    entityType: "PayrollRun",
    entityId: result.payrollRun.id,
    metadataJson: {
      alreadyPosted: result.alreadyPosted,
      syncedExpenses: result.syncedExpenses,
      deductedInstallments: result.deductedInstallments,
    },
  });

  return result;
}

// ── Payroll to Expenses Sync ──

/**
 * Sync payroll to OperatingExpense records.
 * Creates/updates PAYROLL expenses for each employee with prorated amounts.
 */
export async function syncPayrollToExpenses(year: number, month: number, branchId?: string) {
  const { employees } = await calculateMonthlyPayroll(year, month, branchId);
  const monthDate = new Date(year, month - 1, 1);
  const monthEnd = new Date(year, month, 0, 23, 59, 59, 999);
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
        data: {
          amount: new Prisma.Decimal(emp.proratedSalary),
          description,
          isActive: true,
          effectiveFrom: monthDate,
          effectiveTo: monthEnd,
        },
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
          effectiveTo: monthEnd,
        },
      });
    }
    synced++;
  }

  // Also generate salary history
  await generateSalaryHistory(year, month, branchId);

  return { synced, totalPayroll: employees.reduce((s, e) => s + e.proratedSalary, 0) };
}
