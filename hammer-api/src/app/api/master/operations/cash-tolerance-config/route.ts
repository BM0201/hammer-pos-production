import { z } from "zod";
import { getCurrentSession } from "@/modules/auth/service";
import { assertAuthenticated, assertMaster } from "@/modules/auth/access";
import { ok, fail } from "@/lib/api/response";
import { toHttpErrorResponse } from "@/lib/http";
import { requireCsrf } from "@/modules/security/csrf";
import { getCashToleranceConfig, updateCashToleranceConfig } from "@/modules/operations/cash-tolerance-config";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const updateSchema = z.object({
  defaultToleranceAmount: z.number().min(0).optional(),
  byBranch: z.record(z.string(), z.number().min(0)).optional(),
});

export async function GET() {
  try {
    const session = await getCurrentSession();
    assertAuthenticated(session);
    assertMaster(session);
    return ok(await getCashToleranceConfig());
  } catch (error) {
    return toHttpErrorResponse(error);
  }
}

export async function PUT(request: Request) {
  try {
    const session = await getCurrentSession();
    assertAuthenticated(session);
    await requireCsrf(request, session);
    assertMaster(session);

    const parsed = updateSchema.safeParse(await request.json());
    if (!parsed.success) {
      return fail("VALIDATION_ERROR", "Configuración de tolerancia inválida.", 400);
    }

    return ok(await updateCashToleranceConfig(parsed.data, session.userId));
  } catch (error) {
    return toHttpErrorResponse(error);
  }
}
