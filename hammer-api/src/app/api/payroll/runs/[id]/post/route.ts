import { NextRequest } from "next/server";
import { getCurrentSession } from "@/modules/auth/service";
import { assertAuthenticated, assertMaster } from "@/modules/auth/access";
import { requireCsrf } from "@/modules/security/csrf";
import { toHttpErrorResponse } from "@/lib/http";
import { ok } from "@/lib/api/response";
import { postPayrollRun, serializePayrollRunResult } from "@/modules/payroll/payroll-service";

type Params = { params: Promise<{ id: string }> };

export async function POST(req: NextRequest, { params }: Params) {
  try {
    const session = await getCurrentSession();
    assertAuthenticated(session);
    await requireCsrf(req, session);
    assertMaster(session);

    const { id } = await params;
    const result = await postPayrollRun(id, session.userId);
    return ok({
      ...serializePayrollRunResult(result.payrollRun),
      alreadyPosted: result.alreadyPosted,
      syncedExpenses: result.syncedExpenses,
      deductedInstallments: result.deductedInstallments,
    });
  } catch (err: unknown) {
    return toHttpErrorResponse(err);
  }
}
