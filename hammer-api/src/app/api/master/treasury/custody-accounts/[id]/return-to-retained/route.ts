import { getCurrentSession } from "@/modules/auth/service";
import { assertAuthenticated, assertMaster } from "@/modules/auth/access";
import { ok, fail } from "@/lib/api/response";
import { toHttpErrorResponse } from "@/lib/http";
import { requireCsrf } from "@/modules/security/csrf";
import { returnCustodyToRetainedSchema } from "@/modules/treasury/validators";
import { returnCustodyToRetained } from "@/modules/treasury/service";

/**
 * prompt-tesoreria-sin-transito.md Fase 1.5 — limpia un remanente legacy en
 * custodia (dejado por un depósito directo de antes de esta fase): sale de
 * la custodia y vuelve al acumulado retenido de la sucursal elegida.
 */
export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const session = await getCurrentSession();
    assertAuthenticated(session);
    assertMaster(session);
    await requireCsrf(request, session);

    const { id } = await params;
    const parsed = returnCustodyToRetainedSchema.safeParse(await request.json());
    if (!parsed.success) return fail("VALIDATION_ERROR", "Payload invalido.", 400, parsed.error.flatten());

    const result = await returnCustodyToRetained({ custodyAccountId: id, ...parsed.data, actorUserId: session.userId });
    return ok(result);
  } catch (error) {
    return toHttpErrorResponse(error);
  }
}
