import { NextRequest } from "next/server";
import { getCurrentSession } from "@/modules/auth/service";
import { assertAuthenticated, assertMaster } from "@/modules/auth/access";
import { requireCsrf } from "@/modules/security/csrf";
import { toHttpErrorResponse } from "@/lib/http";
import { ok, fail } from "@/lib/api/response";
import { payDisbursementsForPeriod } from "@/modules/payroll/payroll-disbursement-service";

type Params = { params: Promise<{ period: string }> };

export async function POST(req: NextRequest, { params }: Params) {
  try {
    const session = await getCurrentSession();
    assertAuthenticated(session);
    await requireCsrf(req, session);
    assertMaster(session);

    const { period: rawPeriod } = await params;
    const period = rawPeriod === "first-half" ? "FIRST_HALF" : rawPeriod === "second-half" ? "SECOND_HALF" : null;
    if (!period) {
      return fail("INVALID_INPUT", "El período debe ser 'first-half' o 'second-half'", 400);
    }

    const body = (await req.json()) as { payrollRunId?: string };
    if (!body.payrollRunId) {
      return fail("INVALID_INPUT", "Se requiere payrollRunId", 400);
    }

    const result = await payDisbursementsForPeriod(body.payrollRunId, period, session.userId);
    return ok(result);
  } catch (err: unknown) {
    return toHttpErrorResponse(err);
  }
}
