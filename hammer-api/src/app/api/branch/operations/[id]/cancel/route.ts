import { fail, ok } from "@/lib/api/response";
import { toHttpErrorResponse } from "@/lib/http";
import { assertAuthenticated } from "@/modules/auth/access";
import { getCurrentSession } from "@/modules/auth/service";
import { cancelOperationalDay } from "@/modules/operations/service";
import { cancelOperationalDaySchema } from "@/modules/operations/validators";
import { isMaster } from "@/modules/rbac/guards";
import { requireCsrf } from "@/modules/security/csrf";

export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  try {
    const session = await getCurrentSession();
    assertAuthenticated(session);
    await requireCsrf(request, session);
    if (!isMaster(session)) return fail("FORBIDDEN", "Solo MASTER puede cancelar un dia operativo.", 403);
    const { id } = await context.params;
    const parsed = cancelOperationalDaySchema.safeParse(await request.json().catch(() => ({})));
    if (!parsed.success) return fail("VALIDATION_ERROR", "Datos invalidos.", 400, parsed.error.flatten());
    return ok(await cancelOperationalDay({ id, actorUserId: session.userId, ...parsed.data }));
  } catch (error) {
    if (
      error instanceof Error &&
      (error.message === "OPERATIONAL_DAY_HAS_REAL_ACTIVITY" || error.message === "OPERATIONAL_DAY_HAS_REAL_PAYMENTS")
    ) {
      const checklist = (error as unknown as { checklist?: unknown }).checklist ?? null;
      return fail(
        "CONFLICT",
        "No se puede cancelar un dia con actividad real (pagos, devoluciones o movimientos) sin override.",
        409,
        checklist,
      );
    }
    return toHttpErrorResponse(error);
  }
}
