import { NextRequest } from "next/server";
import { getCurrentSession } from "@/modules/auth/service";
import { assertAuthenticated, assertFinanceAccess, assertMaster } from "@/modules/auth/access";
import { toHttpErrorResponse } from "@/lib/http";
import { getPayrollRates, resolvedInssRatesFor, updatePayrollRates } from "@/modules/payroll/payroll-rate-config";
import { IR_TABLE_ANNUAL } from "@/modules/payroll/payroll-nicaragua";
import { requireCsrf } from "@/modules/security/csrf";
import { ok } from "@/lib/api/response";

/**
 * GET /api/payroll/rates — configuración de nómina vigente (régimen INSS,
 * modos de prestaciones, salario mínimo), tasas INSS resueltas por tamaño de
 * empresa y tabla IR (Ley 822).
 */
export async function GET() {
  try {
    const session = await getCurrentSession();
    assertAuthenticated(session);
    assertFinanceAccess(session!);

    const rates = await getPayrollRates();
    return ok({ rates, inss: resolvedInssRatesFor(rates), irTableAnnual: IR_TABLE_ANNUAL });
  } catch (err: unknown) {
    return toHttpErrorResponse(err);
  }
}

/** PATCH /api/payroll/rates — edita la config (solo Master; p.ej. régimen INSS o modos). */
export async function PATCH(req: NextRequest) {
  try {
    const session = await getCurrentSession();
    assertAuthenticated(session);
    await requireCsrf(req, session);
    assertMaster(session!);

    const body = await req.json();
    const rates = await updatePayrollRates(body, session!.userId);
    return ok({ rates, inss: resolvedInssRatesFor(rates), irTableAnnual: IR_TABLE_ANNUAL });
  } catch (err: unknown) {
    return toHttpErrorResponse(err);
  }
}
