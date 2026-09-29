import { NextRequest } from "next/server";
import { getCurrentSession } from "@/modules/auth/service";
import { assertAuthenticated, assertFinanceAccess, assertMaster } from "@/modules/auth/access";
import { toHttpErrorResponse } from "@/lib/http";
import {
  countActiveEmployeesBelowMinimum,
  getPayrollRates,
  listLegalRateVersions,
  resolveLegalRates,
  resolvedInssRatesFor,
  updatePayrollRates,
} from "@/modules/payroll/payroll-rate-config";
import { requireCsrf } from "@/modules/security/csrf";
import { ok } from "@/lib/api/response";

/**
 * GET /api/payroll/rates — configuración de nómina vigente (régimen INSS,
 * modos de prestaciones, salario mínimo), tasas INSS resueltas por tamaño de
 * empresa, tasas legales vigentes (INSS/INATEC/IR — versionadas, ver
 * prompt-nomina-config.md Fase 2) y su historial completo.
 */
async function buildResponsePayload() {
  const rates = await getPayrollRates();
  const [activeEmployeesBelowMinimum, { source: legalSource }, legalVersions] = await Promise.all([
    countActiveEmployeesBelowMinimum(rates.salarioMinimoSectorial),
    resolveLegalRates(),
    listLegalRateVersions(),
  ]);
  return {
    rates,
    inss: resolvedInssRatesFor(rates),
    // irTableAnnual sale de legal (la versión vigente del mes actual), no de
    // la constante — antes de la Fase 2 era siempre la misma tabla fija.
    irTableAnnual: rates.legal.irTableAnnual,
    activeEmployeesBelowMinimum,
    legal: rates.legal,
    legalSource,
    legalVersions,
  };
}

export async function GET() {
  try {
    const session = await getCurrentSession();
    assertAuthenticated(session);
    assertFinanceAccess(session!);

    return ok(await buildResponsePayload());
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
    await updatePayrollRates(body, session!.userId);
    return ok(await buildResponsePayload());
  } catch (err: unknown) {
    return toHttpErrorResponse(err);
  }
}
