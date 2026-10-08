import { fail, ok } from "@/lib/api/response";
import { toHttpErrorResponse } from "@/lib/http";
import { assertAuthenticated, assertMaster } from "@/modules/auth/access";
import { getCurrentSession } from "@/modules/auth/service";
import { bulkUpdateBrainDecisions } from "@/modules/brain/service";
import { bulkDecisionSchema } from "@/modules/brain/validators";
import { requireCsrf } from "@/modules/security/csrf";

/** prompt-brain-centro-decisiones.md Fase 1.6 — selección múltiple dentro de un grupo: resolve/dismiss/snooze en lote, cada id con su propio updateMany condicionado. */
export async function POST(request: Request) {
  try {
    const session = await getCurrentSession();
    assertAuthenticated(session);
    await requireCsrf(request, session);
    assertMaster(session);

    const parsed = bulkDecisionSchema.safeParse(await request.json().catch(() => ({})));
    if (!parsed.success) return fail("VALIDATION_ERROR", "Datos invalidos.", 400, parsed.error.flatten());

    if (parsed.data.action === "dismiss" && (!parsed.data.note || parsed.data.note.trim().length < 3)) {
      return fail("VALIDATION_ERROR", "El motivo es obligatorio para descartar.", 400);
    }

    const data = await bulkUpdateBrainDecisions(parsed.data.ids, parsed.data.action, session.userId, { note: parsed.data.note, days: parsed.data.days });
    return ok(data);
  } catch (error) {
    return toHttpErrorResponse(error);
  }
}
