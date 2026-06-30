import { NextRequest } from "next/server";
import { getCurrentSession } from "@/modules/auth/service";
import { assertAuthenticated, assertMaster } from "@/modules/auth/access";
import { toHttpErrorResponse } from "@/lib/http";
import { ok } from "@/lib/api/response";
import { listPendingDisbursements, listDisbursementsByRun } from "@/modules/payroll/payroll-disbursement-service";

export async function GET(req: NextRequest) {
  try {
    const session = await getCurrentSession();
    assertAuthenticated(session);
    assertMaster(session);

    const { searchParams } = new URL(req.url);
    const branchId = searchParams.get("branchId") ?? undefined;
    const period = searchParams.get("period") as "FIRST_HALF" | "SECOND_HALF" | null;
    const payrollRunId = searchParams.get("payrollRunId") ?? undefined;

    if (payrollRunId) {
      const data = await listDisbursementsByRun(payrollRunId);
      return ok(data);
    }

    const data = await listPendingDisbursements(branchId, period ?? undefined);
    return ok(data);
  } catch (err: unknown) {
    return toHttpErrorResponse(err);
  }
}
