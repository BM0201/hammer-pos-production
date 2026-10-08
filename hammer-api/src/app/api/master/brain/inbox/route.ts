import { fail, ok } from "@/lib/api/response";
import { toHttpErrorResponse } from "@/lib/http";
import { assertAuthenticated, assertMaster } from "@/modules/auth/access";
import { getCurrentSession } from "@/modules/auth/service";
import { getBrainInbox } from "@/modules/brain/inbox-service";
import { inboxFiltersSchema } from "@/modules/brain/validators";

/** prompt-brain-centro-decisiones.md Fase 2.1 — bandeja agrupada por tipo, armada con groupBy en la base. */
export async function GET(request: Request) {
  try {
    const session = await getCurrentSession();
    assertAuthenticated(session);
    assertMaster(session);

    const url = new URL(request.url);
    const parsed = inboxFiltersSchema.safeParse(Object.fromEntries(url.searchParams.entries()));
    if (!parsed.success) return fail("VALIDATION_ERROR", "Filtros invalidos.", 400, parsed.error.flatten());

    const data = await getBrainInbox(parsed.data);
    return ok(data);
  } catch (error) {
    return toHttpErrorResponse(error);
  }
}
