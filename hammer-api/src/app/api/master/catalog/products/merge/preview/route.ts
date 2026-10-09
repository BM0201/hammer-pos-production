import { getCurrentSession } from "@/modules/auth/service";
import { assertAuthenticated, assertMaster } from "@/modules/auth/access";
import { previewMerge } from "@/modules/catalog/product-merge-service";
import { previewMergeSchema } from "@/modules/catalog/validators";
import { toHttpErrorResponse } from "@/lib/http";
import { ok, fail } from "@/lib/api/response";

/**
 * POST /api/master/catalog/products/merge/preview
 *
 * prompt-codigos-y-duplicados.md Fase 3 — unificar productos duplicados.
 * Solo lectura: puede llamarse las veces que haga falta mientras se arma
 * la decisión. Nunca escribe nada.
 */
export async function POST(request: Request) {
  try {
    const session = await getCurrentSession();
    assertAuthenticated(session);
    assertMaster(session);

    const parsed = previewMergeSchema.safeParse(await request.json());
    if (!parsed.success) {
      return fail("VALIDATION_ERROR", "Invalid payload", 400);
    }

    const preview = await previewMerge(parsed.data);
    return ok(preview);
  } catch (error) {
    return toHttpErrorResponse(error);
  }
}
