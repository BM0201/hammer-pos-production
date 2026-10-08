import { fail, ok } from "@/lib/api/response";
import { toHttpErrorResponse } from "@/lib/http";
import { assertAuthenticated, assertMaster } from "@/modules/auth/access";
import { getCurrentSession } from "@/modules/auth/service";
import { resolveBrainDecision } from "@/modules/brain/service";
import { decisionNoteSchema } from "@/modules/brain/validators";
import { requireCsrf } from "@/modules/security/csrf";

/** prompt-brain-centro-decisiones.md Fase 1.6 — "Ya lo resolví": antes no existía, solo "Descartar" (que volvía a los 14 días). */
export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  try {
    const session = await getCurrentSession();
    assertAuthenticated(session);
    await requireCsrf(request, session);
    assertMaster(session);

    const { id } = await context.params;
    const parsed = decisionNoteSchema.safeParse(await request.json().catch(() => ({})));
    if (!parsed.success) return fail("VALIDATION_ERROR", "Datos invalidos.", 400, parsed.error.flatten());

    const data = await resolveBrainDecision(id, session.userId, parsed.data.note);
    return ok(data);
  } catch (error) {
    return toHttpErrorResponse(error);
  }
}
