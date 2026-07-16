import { NextRequest } from "next/server";
import { getCurrentSession } from "@/modules/auth/service";
import { assertAuthenticated, assertFinanceAccess } from "@/modules/auth/access";
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
    assertFinanceAccess(session!);

    const body = await req.json();
    const { month, branchId, syncToExpenses, includeEmployeeIds, skipLoanEmployeeIds } = body;

    if (!month) {
      return fail("ERROR", "Campo requerido: month (YYYY-MM)", 400);
    }

    const [yearStr, monthStr] = month.split("-");
    const year = parseInt(yearStr);
    const mon = parseInt(monthStr);

    if (isNaN(year) || isNaN(mon) || mon < 1 || mon > 12) {
      return fail("ERROR", "Formato de mes inv\u00e1lido. Use YYYY-MM", 400);
    }

    // Selecci\u00f3n "esto s\u00ed, esto no": subconjunto de empleados y pr\u00e9stamos a saltar.
    const asIdArray = (v: unknown): string[] | undefined =>
      Array.isArray(v) ? v.filter((x): x is string => typeof x === "string" && x.length > 0) : undefined;

    const result = await calculatePayrollRun(year, mon, branchId, session!.userId, {
      includeEmployeeIds: asIdArray(includeEmployeeIds),
      skipLoanEmployeeIds: asIdArray(skipLoanEmployeeIds),
    });
    // Incluye `rates` (tasas usadas) y el desglose INSS/IR/patronal por línea.
    const serialized = serializePayrollRunResult(result.payrollRun, result.employees, result.rates);

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
