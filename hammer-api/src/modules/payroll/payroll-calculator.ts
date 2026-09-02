/**
 * Payroll Calculator — Prorated salary computation
 * Calculates salaries proportionally based on days worked in a month.
 */
import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";

/** Get number of days in a specific month */
function getDaysInMonth(year: number, month: number): number {
  return new Date(year, month, 0).getDate();
}

/** Get the first day of a month as Date */
function firstDayOfMonth(year: number, month: number): Date {
  return new Date(year, month - 1, 1);
}

/** Get the last day of a month as Date */
function lastDayOfMonth(year: number, month: number): Date {
  return new Date(year, month, 0);
}

export type ProratedSalaryResult = {
  employeeId: string;
  fullName: string;
  position: string;
  branchId: string;
  monthlySalary: number;
  daysWorked: number;
  totalDays: number;
  proratedSalary: number;
  isFullMonth: boolean;
};

/**
 * Calculate monthly payroll for all active employees, optionally filtered by branch.
 *
 * BUG FIX: Added validation for year/month.
 * BUG FIX: Guard against negative daysWorked.
 * BUG FIX: Handle employee with endDate before startDate.
 */
export async function calculateMonthlyPayroll(
  year: number,
  month: number,
  branchId?: string,
): Promise<{ totalPayroll: number; employees: ProratedSalaryResult[] }> {
  // BUG FIX: Validate inputs
  if (!Number.isFinite(year) || !Number.isFinite(month) || month < 1 || month > 12) {
    return { totalPayroll: 0, employees: [] };
  }

  const monthStart = firstDayOfMonth(year, month);
  const monthEnd = lastDayOfMonth(year, month);

  const where: Record<string, unknown> = {
    OR: [
      { endDate: null },
      { endDate: { gte: monthStart } },
    ],
    startDate: { lte: monthEnd },
  };
  if (branchId) where.branchId = branchId;

  const employees = await prisma.employee.findMany({ where });
  const results: ProratedSalaryResult[] = [];
  let totalPayroll = 0;

  for (const emp of employees) {
    const totalDays = getDaysInMonth(year, month);

    // BUG FIX: Skip employees with invalid date range
    if (emp.endDate && emp.endDate < emp.startDate) continue;

    const effectiveStart = emp.startDate > monthStart ? emp.startDate : monthStart;
    const effectiveEnd = emp.endDate && emp.endDate < monthEnd ? emp.endDate : monthEnd;

    if (effectiveStart > monthEnd || effectiveEnd < monthStart) continue;

    const startDay = effectiveStart.getDate();
    const endDay = effectiveEnd.getDate();
    const daysWorked = Math.max(0, endDay - startDay + 1);
    const salary = Number(emp.monthlySalary);
    // BUG FIX: Guard against division by zero
    const proratedSalary = totalDays > 0
      ? Math.round(((salary / totalDays) * daysWorked) * 100) / 100
      : 0;

    results.push({
      employeeId: emp.id,
      fullName: emp.fullName,
      position: emp.position,
      branchId: emp.branchId,
      monthlySalary: salary,
      daysWorked,
      totalDays,
      proratedSalary,
      isFullMonth: daysWorked === totalDays,
    });
    totalPayroll += proratedSalary;
  }

  return { totalPayroll: Math.round(totalPayroll * 100) / 100, employees: results };
}

/**
 * Generate EmployeeSalaryHistory records for a given month.
 * Upserts — safe to call multiple times for the same month.
 */
export async function generateSalaryHistory(
  year: number,
  month: number,
  branchId?: string,
): Promise<number> {
  const { employees } = await calculateMonthlyPayroll(year, month, branchId);
  const monthDate = firstDayOfMonth(year, month);
  let count = 0;

  for (const emp of employees) {
    if (emp.daysWorked === 0) continue;
    await prisma.employeeSalaryHistory.upsert({
      where: { employeeId_month: { employeeId: emp.employeeId, month: monthDate } },
      create: {
        employeeId: emp.employeeId,
        month: monthDate,
        daysWorked: emp.daysWorked,
        totalDays: emp.totalDays,
        proratedSalary: new Prisma.Decimal(emp.proratedSalary),
        fullSalary: new Prisma.Decimal(emp.monthlySalary),
      },
      update: {
        daysWorked: emp.daysWorked,
        totalDays: emp.totalDays,
        proratedSalary: new Prisma.Decimal(emp.proratedSalary),
        fullSalary: new Prisma.Decimal(emp.monthlySalary),
      },
    });
    count++;
  }

  return count;
}
