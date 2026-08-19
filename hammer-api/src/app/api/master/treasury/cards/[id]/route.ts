import { getCurrentSession } from "@/modules/auth/service";
import { assertAuthenticated, assertMaster } from "@/modules/auth/access";
import { ok, fail } from "@/lib/api/response";
import { toHttpErrorResponse } from "@/lib/http";
import { requireCsrf } from "@/modules/security/csrf";
import { updateTreasuryCardSchema } from "@/modules/treasury/validators";
import { updateTreasuryCard } from "@/modules/treasury/service";

/** Editar / desactivar una tarjeta ligada a una cuenta. */
export async function PATCH(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params;
    const session = await getCurrentSession();
    assertAuthenticated(session);
    assertMaster(session);
    await requireCsrf(request, session);

    const parsed = updateTreasuryCardSchema.safeParse(await request.json());
    if (!parsed.success) return fail("VALIDATION_ERROR", "Payload invalido.", 400, parsed.error.flatten());

    const card = await updateTreasuryCard(id, { ...parsed.data, actorUserId: session.userId });
    return ok(card);
  } catch (error) {
    return toHttpErrorResponse(error);
  }
}
