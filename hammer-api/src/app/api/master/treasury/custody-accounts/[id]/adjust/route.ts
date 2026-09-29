import { getCurrentSession } from "@/modules/auth/service";
import { assertAuthenticated, assertMaster } from "@/modules/auth/access";
import { ok, fail } from "@/lib/api/response";
import { toHttpErrorResponse } from "@/lib/http";
import { requireCsrf } from "@/modules/security/csrf";
import { adjustCustodyBalanceSchema } from "@/modules/treasury/validators";
import { adjustCustodyBalance } from "@/modules/treasury/service";

/**
 * prompt-tesoreria-depositos.md Fase 3 — da de baja efectivo que nunca
 * existió de verdad en una custodia (el caso fantasma del Bug 1). Una sola
 * entrada OUT RECONCILIATION — no hay a dónde transferirlo.
 */
export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const session = await getCurrentSession();
    assertAuthenticated(session);
    assertMaster(session);
    await requireCsrf(request, session);

    const { id } = await params;
    const parsed = adjustCustodyBalanceSchema.safeParse(await request.json());
    if (!parsed.success) return fail("VALIDATION_ERROR", "Payload invalido.", 400, parsed.error.flatten());

    const result = await adjustCustodyBalance({ custodyAccountId: id, amount: parsed.data.amount, reason: parsed.data.reason, actorUserId: session.userId });
    return ok(result);
  } catch (error) {
    return toHttpErrorResponse(error);
  }
}
