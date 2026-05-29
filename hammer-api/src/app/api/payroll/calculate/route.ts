import { NextRequest } from "next/server";
import { getCurrentSession } from "@/modules/auth/service";
import { assertAuthenticated, assertMaster } from "@/modules/auth/access";
import { toHttpErrorResponse } from "@/lib/http";
import { calculatePayrollRun, serializePayrollRunResult } from "@/modules/payroll/payroll-service";
import { requireCsrf } from "@/modules/security/csrf";
import { ok, fail } from "@/lib/api/response";

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
      return fail("ERROR", "Campo requerido: month (YYYY-MM)", 400);
    }

    const [yearStr, monthStr] = month.split("-");
    const year = parseInt(yearStr);
    const mon = parseInt(monthStr);

    if (isNaN(year) || isNaN(mon) || mon < 1 || mon > 12) {
      return fail("ERROR", "Formato de mes inv\u00e1lido. Use YYYY-MM", 400);
    }

    const result = await calculatePayrollRun(year, mon, branchId, session!.userId);
    const serialized = serializePayrollRunResult(result.payrollRun, result.employees);

    return ok({
      period: month,
      branchId: branchId ?? "all",
      ...serialized,
      syncResult: null,
      note: syncToExpenses
        ? "La sincronizacion de gastos se realiza al postear la nomina, no durante el calculo."
        : undefined,
    });
  } catch (err: any) {
    return toHttpErrorResponse(err);
  }
}
