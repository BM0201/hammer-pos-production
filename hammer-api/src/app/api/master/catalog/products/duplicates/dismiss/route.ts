import { getCurrentSession } from "@/modules/auth/service";
import { assertAuthenticated, assertMaster } from "@/modules/auth/access";
import { dismissDuplicatePair, listDismissedDuplicatePairs, restoreDismissedDuplicatePair } from "@/modules/catalog/duplicate-finder-service";
import { dismissDuplicatePairSchema } from "@/modules/catalog/validators";
import { toHttpErrorResponse } from "@/lib/http";
import { requireCsrf } from "@/modules/security/csrf";
import { ok, fail } from "@/lib/api/response";

/**
 * /api/master/catalog/products/duplicates/dismiss
 *
 * prompt-codigos-y-duplicados.md Fase 4 — "no son el mismo producto".
 * GET lista los descartados, POST descarta, DELETE deshace un descarte por error.
 */
export async function GET() {
  try {
    const session = await getCurrentSession();
    assertAuthenticated(session);
    assertMaster(session);
    return ok(await listDismissedDuplicatePairs());
  } catch (error) {
    return toHttpErrorResponse(error);
  }
}

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

export async function DELETE(request: Request) {
  try {
    const session = await getCurrentSession();
    assertAuthenticated(session);
    await requireCsrf(request, session);
    assertMaster(session);

    const parsed = dismissDuplicatePairSchema.safeParse(await request.json());
    if (!parsed.success) {
      return fail("VALIDATION_ERROR", "Invalid payload", 400);
    }

    await restoreDismissedDuplicatePair(parsed.data);
    return ok({ restored: true });
  } catch (error) {
    return toHttpErrorResponse(error);
  }
}
