import { fail, ok } from "@/lib/api/response";
import { toHttpErrorResponse } from "@/lib/http";
import { assertAuthenticated, assertMaster } from "@/modules/auth/access";
import { getCurrentSession } from "@/modules/auth/service";
import { revertOperationalDayConfirmation } from "@/modules/operations/service";
import { revertConfirmationOperationalDaySchema } from "@/modules/operations/validators";
import { requireCsrf } from "@/modules/security/csrf";

/** Revertir confirmación (CONFIRMED → PENDING) — solo Master, nota obligatoria, auditada. */
export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  try {
    const session = await getCurrentSession();
    assertAuthenticated(session);
    await requireCsrf(request, session);
    assertMaster(session);

    const { id } = await context.params;
    const parsed = revertConfirmationOperationalDaySchema.safeParse(await request.json().catch(() => ({})));
    if (!parsed.success) return fail("VALIDATION_ERROR", "Se requiere una nota para revertir la confirmación.", 400);

    return ok(await revertOperationalDayConfirmation({ id, actorUserId: session.userId, note: parsed.data.note }));
  } catch (error) {
    return toHttpErrorResponse(error);
  }
}
