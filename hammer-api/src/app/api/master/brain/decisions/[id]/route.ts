import { fail, ok } from "@/lib/api/response";
import { toHttpErrorResponse } from "@/lib/http";
import { assertAuthenticated, assertMaster } from "@/modules/auth/access";
import { getCurrentSession } from "@/modules/auth/service";
import { snoozeBrainDecision } from "@/modules/brain/service";
import { snoozeDecisionSchema } from "@/modules/brain/validators";
import { requireCsrf } from "@/modules/security/csrf";

export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  try {
    const session = await getCurrentSession();
    assertAuthenticated(session);
    await requireCsrf(request, session);
    assertMaster(session);

    const { id } = await context.params;
    const parsed = snoozeDecisionSchema.safeParse(await request.json().catch(() => ({})));
    if (!parsed.success) return fail("VALIDATION_ERROR", "Datos invalidos.", 400, parsed.error.flatten());

    const data = await snoozeBrainDecision(id, session.userId, {
      note: parsed.data.note,
      until: parsed.data.until ? new Date(parsed.data.until) : undefined,
      days: parsed.data.days,
    });
    return ok(data);
  } catch (error) {
    return toHttpErrorResponse(error);
  }
}
