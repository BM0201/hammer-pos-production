import { fail, ok } from "@/lib/api/response";
import { toHttpErrorResponse } from "@/lib/http";
import { assertAuthenticated, assertMaster } from "@/modules/auth/access";
import { getCurrentSession } from "@/modules/auth/service";
import { getBrainInboxItems } from "@/modules/brain/inbox-service";
import { inboxItemsQuerySchema } from "@/modules/brain/validators";
import { parseListLimit } from "@/lib/api/list-limit";

/** prompt-brain-centro-decisiones.md Fase 2.2 — las decisiones de un grupo, paginadas. */
export async function GET(request: Request, context: { params: Promise<{ type: string }> }) {
  try {
    const session = await getCurrentSession();
    assertAuthenticated(session);
    assertMaster(session);

    const { type } = await context.params;
    const url = new URL(request.url);
    const parsed = inboxItemsQuerySchema.safeParse(Object.fromEntries(url.searchParams.entries()));
    if (!parsed.success) return fail("VALIDATION_ERROR", "Filtros invalidos.", 400, parsed.error.flatten());

    const limit = parseListLimit(parsed.data.limit != null ? String(parsed.data.limit) : null, { default: 50, max: 100 });
    const data = await getBrainInboxItems(decodeURIComponent(type), parsed.data, { cursor: parsed.data.cursor, limit });
    return ok(data);
  } catch (error) {
    return toHttpErrorResponse(error);
  }
}
