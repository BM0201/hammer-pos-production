import { getCurrentSession } from "@/modules/auth/service";
import { assertAuthenticated, assertMaster } from "@/modules/auth/access";
import { mergeProducts } from "@/modules/catalog/product-merge-service";
import { executeMergeSchema } from "@/modules/catalog/validators";
import { toHttpErrorResponse } from "@/lib/http";
import { requireCsrf } from "@/modules/security/csrf";
import { ok, fail } from "@/lib/api/response";

/**
 * POST /api/master/catalog/products/merge
 *
 * prompt-codigos-y-duplicados.md Fase 3 — unificar productos duplicados.
 * "No unificar productos reales en producción para probar." — ejecuta de
 * verdad: re-valida todo dentro de la transacción (nunca confía en un
 * preview pedido antes) y exige escribir el SKU del producto a fusionar
 * como confirmación explícita.
 */
export async function POST(request: Request) {
  try {
    const session = await getCurrentSession();
    assertAuthenticated(session);
    await requireCsrf(request, session);
    assertMaster(session);

    const parsed = executeMergeSchema.safeParse(await request.json());
    if (!parsed.success) {
      return fail("VALIDATION_ERROR", "Invalid payload", 400);
    }

    const merge = await mergeProducts({ ...parsed.data, actorUserId: session.userId });
    return ok(merge);
  } catch (error) {
    return toHttpErrorResponse(error);
  }
}
