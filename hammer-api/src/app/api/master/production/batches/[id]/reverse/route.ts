import { getCurrentSession } from "@/modules/auth/service";
import { assertAuthenticated } from "@/modules/auth/access";
import { assertProductionPermission } from "@/modules/auth/production-guard";
import { reverseBatch } from "@/modules/production/service";
import { reverseBatchSchema } from "@/modules/production/validators";
import { toHttpErrorResponse } from "@/lib/http";
import { requireCsrf } from "@/modules/security/csrf";
import { ok, validationFail } from "@/lib/api/response";

/**
 * Producción v2 Fase 4 — revierte un lote COMPLETED: devuelve los insumos
 * consumidos y retira el producto terminado, con movimientos inversos
 * auditados. Requiere el permiso dedicado production.batches.reverse (no
 * basta con poder completar lotes) y un motivo.
 */
export async function POST(
  request: Request,
  context: { params: Promise<{ id: string }> },
) {
  try {
    const session = await getCurrentSession();
    assertAuthenticated(session);
    await requireCsrf(request, session);
    await assertProductionPermission(session, "production.batches.reverse");

    const { id } = await context.params;
    const parsed = reverseBatchSchema.safeParse(await request.json());
    if (!parsed.success) {
      return validationFail(parsed.error.issues);
    }

    const batch = await reverseBatch(id, { ...parsed.data, actorUserId: session.userId });
    return ok(batch);
  } catch (error) {
    return toHttpErrorResponse(error);
  }
}
