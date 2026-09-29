import { NextRequest } from "next/server";
import { z } from "zod";
import { getCurrentSession } from "@/modules/auth/service";
import { assertAuthenticated, assertMaster } from "@/modules/auth/access";
import { requireCsrf } from "@/modules/security/csrf";
import { created, validationFail } from "@/lib/api/response";
import { toHttpErrorResponse } from "@/lib/http";
import { createLegalRateVersion } from "@/modules/payroll/payroll-rate-config";
import { validateLegalRates } from "@/modules/payroll/payroll-nicaragua";

/**
 * POST /api/payroll/legal-rates — registra una reforma legal (INSS, INATEC,
 * tabla IR) vigente desde un mes dado. Solo Master. prompt-nomina-config.md
 * Fase 2.4.
 */

const irBracketSchema = z.object({
  from: z.number(),
  base: z.number(),
  rate: z.number(),
});

const bodySchema = z.object({
  effectiveFrom: z.string().min(1),
  inssIntegralLaboral: z.number(),
  inssIntegralPatronalLt50: z.number(),
  inssIntegralPatronalGte50: z.number(),
  inssIvmRpLaboral: z.number(),
  inssIvmRpPatronalLt50: z.number(),
  inssIvmRpPatronalGte50: z.number(),
  inssEmployerSizeThreshold: z.number(),
  inatecRate: z.number(),
  irTableAnnual: z.array(irBracketSchema).min(1),
  legalBasis: z.string().min(1),
});

export async function POST(req: NextRequest) {
  try {
    const session = await getCurrentSession();
    assertAuthenticated(session);
    await requireCsrf(req, session);
    assertMaster(session!);

    const parsed = bodySchema.safeParse(await req.json());
    if (!parsed.success) return validationFail(parsed.error.flatten());

    // Validación de negocio (rangos de tasa, consistencia de la tabla IR) —
    // separada de la forma (Zod, arriba). Devuelve la lista completa de
    // errores, no solo el primero.
    const errors = validateLegalRates(parsed.data);
    if (errors.length > 0) return validationFail({ errors });

    const version = await createLegalRateVersion(parsed.data, session!.userId);
    return created(version);
  } catch (err: unknown) {
    return toHttpErrorResponse(err);
  }
}
