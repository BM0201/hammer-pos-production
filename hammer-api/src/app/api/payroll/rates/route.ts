import { NextRequest } from "next/server";
import { getCurrentSession } from "@/modules/auth/service";
import { assertAuthenticated, assertFinanceAccess, assertMaster } from "@/modules/auth/access";
import { toHttpErrorResponse } from "@/lib/http";
import { getPayrollRates, updatePayrollRates } from "@/modules/payroll/payroll-rate-config";
import { IR_TABLE_ANNUAL } from "@/modules/payroll/payroll-nicaragua";
import { requireCsrf } from "@/modules/security/csrf";
import { ok } from "@/lib/api/response";

/** GET /api/payroll/rates — tasas de nómina vigentes + tabla IR (Ley 822). */
export async function GET() {
  try {
    const session = await getCurrentSession();
    assertAuthenticated(session);
    assertFinanceAccess(session!);

    const rates = await getPayrollRates();
    return ok({ rates, irTableAnnual: IR_TABLE_ANNUAL });
  } catch (err: unknown) {
    return toHttpErrorResponse(err);
  }
}

/** PATCH /api/payroll/rates — edita tasas (solo Master; p.ej. INSS patronal 21.5%→22.5%). */
export async function PATCH(req: NextRequest) {
  try {
    const session = await getCurrentSession();
    assertAuthenticated(session);
    await requireCsrf(req, session);
    assertMaster(session!);

    const body = await req.json();
    const rates = await updatePayrollRates(body, session!.userId);
    return ok({ rates, irTableAnnual: IR_TABLE_ANNUAL });
  } catch (err: unknown) {
    return toHttpErrorResponse(err);
  }
}
