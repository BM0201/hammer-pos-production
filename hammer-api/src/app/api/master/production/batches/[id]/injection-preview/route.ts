import { getCurrentSession } from "@/modules/auth/service";
import { assertAuthenticated } from "@/modules/auth/access";
import { assertProductionPermission } from "@/modules/auth/production-guard";
import { getBatchInjectionPreview } from "@/modules/production/service";
import { injectionPreviewSchema } from "@/modules/production/validators";
import { toHttpErrorResponse } from "@/lib/http";
import { requireCsrf } from "@/modules/security/csrf";
import { ok, validationFail } from "@/lib/api/response";

/**
 * Producción v2 Fase 3 — preview de inyección: costo/precio ANTES→DESPUÉS
 * del producto terminado, sin escribir nada. El frontend debe pedir este
 * preview antes de cerrar el lote y enviar su hash a /complete — si el
 * inventario cambió entre medias, el hash no coincide y el cierre falla.
 */
export async function POST(
  request: Request,
  context: { params: Promise<{ id: string }> },
) {
  try {
    const session = await getCurrentSession();
    assertAuthenticated(session);
    await requireCsrf(request, session);
    await assertProductionPermission(session, "production.batches.complete");

    const { id } = await context.params;
    const parsed = injectionPreviewSchema.safeParse(await request.json());
    if (!parsed.success) {
      return validationFail(parsed.error.issues);
    }

    const preview = await getBatchInjectionPreview(id, parsed.data);
    return ok(preview);
  } catch (error) {
    return toHttpErrorResponse(error);
  }
}
