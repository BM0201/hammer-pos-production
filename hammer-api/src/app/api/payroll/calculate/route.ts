import { NextRequest, NextResponse } from "next/server";
import { getCurrentSession } from "@/modules/auth/service";
import { assertAuthenticated, assertMaster } from "@/modules/auth/access";
import { toHttpErrorResponse } from "@/lib/http";
import { calculateMonthlyPayroll, generateSalaryHistory } from "@/modules/payroll/payroll-calculator";
import { syncPayrollToExpenses } from "@/modules/payroll/payroll-service";
import { requireCsrf } from "@/modules/security/csrf";

/** POST /api/payroll/calculate — calculate payroll for a month */
export async function POST(req: NextRequest) {
  try {
    const session = await getCurrentSession();
    assertAuthenticated(session);
    await requireCsrf(req, session);
    assertMaster(session!);

    const body = await req.json();
    const { month, branchId, syncToExpenses } = body;

    if (!month) {
      return NextResponse.json({ error: "Campo requerido: month (YYYY-MM)" }, { status: 400 });
    }

    const [yearStr, monthStr] = month.split("-");
    const year = parseInt(yearStr);
    const mon = parseInt(monthStr);

    if (isNaN(year) || isNaN(mon) || mon < 1 || mon > 12) {
      return NextResponse.json({ error: "Formato de mes inv\u00e1lido. Use YYYY-MM" }, { status: 400 });
    }

    const result = await calculateMonthlyPayroll(year, mon, branchId);

    // Generate salary history records
    await generateSalaryHistory(year, mon, branchId);

    // Optionally sync to expenses
    let syncResult = null;
    if (syncToExpenses) {
      syncResult = await syncPayrollToExpenses(year, mon, branchId);
    }

    return NextResponse.json({
      data: {
        month,
        branchId: branchId ?? "all",
        totalPayroll: result.totalPayroll,
        employeeCount: result.employees.length,
        employees: result.employees,
        syncResult,
      },
    });
  } catch (err: any) {
    return toHttpErrorResponse(err);
  }
}
