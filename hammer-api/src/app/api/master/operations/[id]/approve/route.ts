import { fail, ok } from "@/lib/api/response";
import { toHttpErrorResponse } from "@/lib/http";
import { assertAuthenticated, assertMaster } from "@/modules/auth/access";
import { getCurrentSession } from "@/modules/auth/service";
import { approveOperationalDayReview } from "@/modules/operations/service";
import { requireCsrf } from "@/modules/security/csrf";

export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  try {
    const session = await getCurrentSession();
    assertAuthenticated(session);
    await requireCsrf(request, session);
    assertMaster(session);
    const { id } = await context.params;
    return ok(await approveOperationalDayReview({ id, actorUserId: session.userId }));
  } catch (error) {
    if (error instanceof Error && error.message === "OPERATIONAL_DAY_REVIEW_HAS_BLOCKERS") {
      return fail(
        "OPERATIONAL_DAY_REVIEW_HAS_BLOCKERS",
        "El dia operativo tiene pendientes antes de aprobar.",
        409,
        (error as unknown as { blockers?: unknown }).blockers,
      );
    }
    return toHttpErrorResponse(error);
  }
}
