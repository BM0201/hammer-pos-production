import { getCurrentSession } from "@/modules/auth/service";
import { assertAuthenticated, assertMaster } from "@/modules/auth/access";
import { requireCsrf } from "@/modules/security/csrf";
import { ok, fail } from "@/lib/api/response";
import { toHttpErrorResponse } from "@/lib/http";
import { previewFusionCreation, type WizardMember } from "@/modules/catalog/fusion-wizard-service";

// POST → paso 3 del asistente de creación (Fusión de Inventario v2, Fase 2.1):
// preview del stock actual de cada miembro por sucursal, SIN escribir nada.
// Obligatorio antes de crear — el frontend nunca debería poder saltarse este paso.
export async function POST(request: Request) {
  try {
    const session = await getCurrentSession();
    assertAuthenticated(session);
    assertMaster(session);
    // Auditoría 2026-08-03: sin requireCsrf, el middleware global solo
    // verifica que el header exista (no su validez).
    await requireCsrf(request, session);

    const body = (await request.json().catch(() => ({}))) as { members?: WizardMember[] };
    if (!Array.isArray(body.members) || body.members.length < 2) {
      return fail("VALIDATION_ERROR", "Se requieren al menos 2 productos (1 principal y 1 derivado).", 400);
    }
    const canonicalCount = body.members.filter((m) => m.isCanonical).length;
    if (canonicalCount !== 1) {
      return fail("VALIDATION_ERROR", "Debe haber exactamente un producto principal (unidad base).", 400);
    }

    return ok(await previewFusionCreation({ members: body.members }));
  } catch (error) {
    return toHttpErrorResponse(error);
  }
}
