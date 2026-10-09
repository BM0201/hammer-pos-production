import { getCurrentSession } from "@/modules/auth/service";
import { assertAuthenticated, assertMaster } from "@/modules/auth/access";
import { dismissDuplicatePair } from "@/modules/catalog/duplicate-finder-service";
import { dismissDuplicatePairSchema } from "@/modules/catalog/validators";
import { toHttpErrorResponse } from "@/lib/http";
import { requireCsrf } from "@/modules/security/csrf";
import { ok, fail } from "@/lib/api/response";

/**
 * POST /api/master/catalog/products/duplicates/dismiss
 *
 * prompt-codigos-y-duplicados.md Fase 4 — "no son el mismo producto".
 */
export async function POST(request: Request) {
  try {
    const session = await getCurrentSession();
    assertAuthenticated(session);
    await requireCsrf(request, session);
    assertMaster(session);

    const parsed = dismissDuplicatePairSchema.safeParse(await request.json());
    if (!parsed.success) {
      return fail("VALIDATION_ERROR", "Invalid payload", 400);
    }

    const dismissal = await dismissDuplicatePair({ ...parsed.data, actorUserId: session.userId });
    return ok(dismissal);
  } catch (error) {
    return toHttpErrorResponse(error);
  }
}
