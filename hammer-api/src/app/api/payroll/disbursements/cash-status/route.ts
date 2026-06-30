import { NextRequest } from "next/server";
import { getCurrentSession } from "@/modules/auth/service";
import { assertAuthenticated, assertMaster } from "@/modules/auth/access";
import { toHttpErrorResponse } from "@/lib/http";
import { ok, fail } from "@/lib/api/response";
import { getCashStatusByRun } from "@/modules/payroll/payroll-disbursement-service";

/** GET /api/payroll/disbursements/cash-status?payrollRunId=xxx — estado de aplicación a caja por sucursal */
export async function GET(req: NextRequest) {
  try {
    const session = await getCurrentSession();
    assertAuthenticated(session);
    assertMaster(session);

    const { searchParams } = new URL(req.url);
    const payrollRunId = searchParams.get("payrollRunId");
    if (!payrollRunId) {
      return fail("INVALID_INPUT", "Se requiere payrollRunId", 400);
    }

    const data = await getCashStatusByRun(payrollRunId);
    return ok(data);
  } catch (err: unknown) {
    return toHttpErrorResponse(err);
  }
}
