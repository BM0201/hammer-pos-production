import { NextRequest } from "next/server";
import { getCurrentSession } from "@/modules/auth/service";
import { assertAuthenticated } from "@/modules/auth/access";
import { requireBranchCapability } from "@/modules/rbac/guards";
import { CAPABILITIES } from "@/modules/rbac/policies";
import { requireCsrf } from "@/modules/security/csrf";
import { ok, created, fail } from "@/lib/api/response";
import { toApiErrorResponse } from "@/lib/api/errors";
import { createOperatingExpense, listExpensesByBranch } from "@/modules/pricing/service";
import { prisma } from "@/lib/prisma";
import { z } from "zod";
import { EXPENSE_CATEGORIES } from "@/modules/pricing/validators";

/** Returns year, month (1-based) and day in America/Managua timezone. */
function getNicaraguaDateParts() {
  const formatter = new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/Managua",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  });
  const [year, month, day] = formatter.format(new Date()).split("-").map(Number);
  // Last day of the current month (day 0 of next month)
  const lastDay = new Date(year, month, 0).getDate();
  return { year, month, day, lastDay };
}

/**
 * UTC range [start, end) covering the current business day in America/Managua
 * (fixed UTC-6, no DST). Used so the "Gastos del Local" panel only lists the
 * expenses registered today — they clear automatically when the day rolls over.
 */
function getManaguaDayUtcRange() {
  const { year, month, day } = getNicaraguaDateParts();
  const start = new Date(Date.UTC(year, month - 1, day, 6, 0, 0, 0)); // Managua 00:00 → 06:00 UTC
  const end = new Date(start.getTime() + 24 * 60 * 60 * 1000);
  return { start, end };
}

const createSchema = z.object({
  branchId: z.string().min(1),
  category: z.enum(EXPENSE_CATEGORIES),
  description: z.string().min(1).max(200),
  amount: z.number().positive(),
  effectiveFrom: z.string().optional(),
  effectiveTo: z.string().optional(),
});

/**
 * Adds `disbursementCashApplied` to PAYROLL expenses: true if the matching PayrollDisbursement
 * was already discounted from a physical cash box (has cashMovementId), false if paid but still
 * pending application, null if no matching disbursement was found.
 */
async function enrichWithCashStatus(expenses: Awaited<ReturnType<typeof listExpensesByBranch>>) {
  const payrollExpenses = expenses.filter((e) => e.category === "PAYROLL" && e.employeeId);
  if (payrollExpenses.length === 0) return expenses;

  const disbursements = await prisma.payrollDisbursement.findMany({
    where: {
      OR: payrollExpenses.map((e) => ({
        branchId: e.branchId,
        employeeId: e.employeeId as string,
        scheduledDate: e.effectiveFrom,
      })),
    },
    select: { branchId: true, employeeId: true, scheduledDate: true, status: true, cashMovementId: true },
  });

  const statusByKey = new Map<string, boolean>();
  for (const d of disbursements) {
    const key = `${d.branchId}:${d.employeeId}:${d.scheduledDate.toISOString()}`;
    statusByKey.set(key, d.status === "PAID" && d.cashMovementId != null);
  }

  return expenses.map((e) => {
    if (e.category !== "PAYROLL" || !e.employeeId) return e;
    const key = `${e.branchId}:${e.employeeId}:${new Date(e.effectiveFrom).toISOString()}`;
    return { ...e, disbursementCashApplied: statusByKey.has(key) ? statusByKey.get(key)! : null };
  });
}

/**
 * GET /api/branch/expenses?branchId=xxx
 * Lists operating expenses for a branch. Accessible to BRANCH_ADMIN and MASTER.
 */
export async function GET(req: NextRequest) {
  try {
    const session = await getCurrentSession();
    assertAuthenticated(session);

    const branchId = new URL(req.url).searchParams.get("branchId");
    if (!branchId) return fail("VALIDATION_ERROR", "branchId es requerido", 400);

    requireBranchCapability(session, branchId, CAPABILITIES.OPERATING_EXPENSE_VIEW);

    // Only the expenses registered during the current business day are listed here,
    // so the "Gastos del Local" panel clears automatically at the end of each day.
    const { start, end } = getManaguaDayUtcRange();
    const expenses = await listExpensesByBranch(branchId, { effectiveFromGte: start, effectiveFromLt: end });

    // Payroll expenses are only visible on the 15th and the last day of the month
    // (Nicaraguan quincena cycle). Once the PayrollRun for this month is POSTED
    // (Master approved), payroll expenses are no longer surfaced here.
    const hasPayroll = expenses.some((e) => e.category === "PAYROLL");
    if (hasPayroll) {
      const { year, month, day, lastDay } = getNicaraguaDateParts();
      const isPayrollDay = day === 15 || day === lastDay;

      if (!isPayrollDay) {
        return ok(expenses.filter((e) => e.category !== "PAYROLL"));
      }

      const payrollRun = await prisma.payrollRun.findUnique({
        where: { branchId_year_month: { branchId, year, month } },
        select: { status: true },
      });
      if (payrollRun?.status === "POSTED") {
        return ok(expenses.filter((e) => e.category !== "PAYROLL"));
      }
    }

    return ok(await enrichWithCashStatus(expenses));
  } catch (error) {
    return toApiErrorResponse(error);
  }
}

/**
 * POST /api/branch/expenses
 * Creates a manual operating expense. Accessible to BRANCH_ADMIN and MASTER.
 */
export async function POST(req: NextRequest) {
  try {
    const session = await getCurrentSession();
    assertAuthenticated(session);
    await requireCsrf(req, session);

    const body = await req.json();
    const parsed = createSchema.safeParse(body);
    if (!parsed.success) return fail("VALIDATION_ERROR", "Datos inválidos", 400);

    requireBranchCapability(session, parsed.data.branchId, CAPABILITIES.OPERATING_EXPENSE_CREATE);

    const expense = await createOperatingExpense(parsed.data, session.userId);
    return created(expense);
  } catch (error) {
    return toApiErrorResponse(error);
  }
}
