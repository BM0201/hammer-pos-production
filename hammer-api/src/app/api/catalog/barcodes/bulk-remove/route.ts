import { getCurrentSession } from "@/modules/auth/service";
import { assertAuthenticated, assertMaster } from "@/modules/auth/access";
import { bulkRemoveBarcodes } from "@/modules/catalog/product-barcode-service";
import { bulkRemoveBarcodesSchema } from "@/modules/catalog/validators";
import { toHttpErrorResponse } from "@/lib/http";
import { requireCsrf } from "@/modules/security/csrf";
import { ok, fail } from "@/lib/api/response";

export const maxDuration = 60;

/**
 * POST /api/catalog/barcodes/bulk-remove
 *
 * prompt-codigos-editar-eliminar.md Fase 1.2 — quitar en lote (hasta 200),
 * cada uno en su propia transacción. Motivo obligatorio y auditado.
 */
export async function POST(request: Request) {
  try {
    const session = await getCurrentSession();
    assertAuthenticated(session);
    await requireCsrf(request, session);
    assertMaster(session);

    const parsed = bulkRemoveBarcodesSchema.safeParse(await request.json());
    if (!parsed.success) return fail("VALIDATION_ERROR", "Parámetros inválidos.", 400, parsed.error.flatten());

    const result = await bulkRemoveBarcodes({ ids: parsed.data.ids, reason: parsed.data.reason, actorUserId: session.userId });
    return ok(result);
  } catch (error) {
    return toHttpErrorResponse(error);
  }
}
