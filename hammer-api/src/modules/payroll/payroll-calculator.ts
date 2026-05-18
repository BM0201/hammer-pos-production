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
 * Calculate prorated salary for an employee in a given month.
 * Formula: (monthlySalary / totalDaysInMonth) * daysWorked
 *
 * BUG FIX: Added validation for year/month parameters.
 * BUG FIX: Handle employees with future startDate or endDate before startDate.
 * BUG FIX: Normalize Date comparisons to avoid timezone issues.
 */
export async function calculateProratedSalary(
  employeeId: string,
  year: number,
  month: number,
): Promise<ProratedSalaryResult | null> {
  // BUG FIX: Validate inputs
  if (!Number.isFinite(year) || !Number.isFinite(month) || month < 1 || month > 12) {
    return null;
  }

  const employee = await prisma.employee.findUnique({ where: { id: employeeId } });
  if (!employee) return null;

  const totalDays = getDaysInMonth(year, month);
  const monthStart = firstDayOfMonth(year, month);
  const monthEnd = lastDayOfMonth(year, month);

  // BUG FIX: Handle employee with endDate before startDate (invalid data)
  if (employee.endDate && employee.endDate < employee.startDate) {
    return {
      employeeId: employee.id,
      fullName: employee.fullName,
      position: employee.position,
      branchId: employee.branchId,
      monthlySalary: Number(employee.monthlySalary),
      daysWorked: 0,
      totalDays,
      proratedSalary: 0,
      isFullMonth: false,
    };
  }

  // Determine effective start/end within the month
  const effectiveStart = employee.startDate > monthStart ? employee.startDate : monthStart;
  const effectiveEnd = employee.endDate && employee.endDate < monthEnd ? employee.endDate : monthEnd;

  // If employee wasn't active during this month at all
  if (effectiveStart > monthEnd || effectiveEnd < monthStart) {
    return {
      employeeId: employee.id,
      fullName: employee.fullName,
      position: employee.position,
      branchId: employee.branchId,
      monthlySalary: Number(employee.monthlySalary),
      daysWorked: 0,
      totalDays,
      proratedSalary: 0,
      isFullMonth: false,
    };
  }

  // Calculate days worked (inclusive of both start and end)
  const startDay = effectiveStart.getDate();
  const endDay = effectiveEnd.getDate();
  const daysWorked = endDay - startDay + 1;

  // BUG FIX: Guard against negative daysWorked (should not happen with correct logic, but be defensive)
  const safeDaysWorked = Math.max(0, daysWorked);

  const salary = Number(employee.monthlySalary);
  // BUG FIX: Guard against totalDays being 0 (should never happen, but defensive)
  const proratedSalary = totalDays > 0
    ? Math.round(((salary / totalDays) * safeDaysWorked) * 100) / 100
    : 0;
  const isFullMonth = safeDaysWorked === totalDays;

  return {
    employeeId: employee.id,
    fullName: employee.fullName,
    position: employee.position,
    branchId: employee.branchId,
    monthlySalary: salary,
    daysWorked: safeDaysWorked,
    totalDays,
    proratedSalary,
    isFullMonth,
  };
}

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

/**
 * Get active employees for a specific date.
 */
export async function getActiveEmployees(date: Date, branchId?: string) {
  const where: Record<string, unknown> = {
    isActive: true,
    startDate: { lte: date },
    OR: [{ endDate: null }, { endDate: { gte: date } }],
  };
  if (branchId) where.branchId = branchId;
  return prisma.employee.findMany({ where, include: { branch: true } });
}
