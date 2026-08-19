import { fail, ok } from "@/lib/api/response";
import { toHttpErrorResponse } from "@/lib/http";
import { assertAuthenticated, assertMaster } from "@/modules/auth/access";
import { getCurrentSession } from "@/modules/auth/service";
import { reopenOperationalDay } from "@/modules/operations/service";
import { reopenOperationalDaySchema } from "@/modules/operations/validators";
import { requireCsrf } from "@/modules/security/csrf";

export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  try {
    const session = await getCurrentSession();
    assertAuthenticated(session);
    await requireCsrf(request, session);
    assertMaster(session);

    const { id } = await context.params;
    const body = await request.json().catch(() => ({}));
    const parsed = reopenOperationalDaySchema.safeParse(body);
    if (!parsed.success) return fail("VALIDATION_ERROR", "Se requiere una nota para reabrir el dia operativo.", 400);

    return ok(await reopenOperationalDay({ id, actorUserId: session.userId, note: parsed.data.note }));
  } catch (error) {
    return toHttpErrorResponse(error);
  }
}
