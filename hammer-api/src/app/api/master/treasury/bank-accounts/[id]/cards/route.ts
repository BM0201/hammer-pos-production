import { getCurrentSession } from "@/modules/auth/service";
import { assertAuthenticated, assertMaster } from "@/modules/auth/access";
import { ok, created, fail } from "@/lib/api/response";
import { toHttpErrorResponse } from "@/lib/http";
import { requireCsrf } from "@/modules/security/csrf";
import { createTreasuryCardSchema } from "@/modules/treasury/validators";
import { createTreasuryCard, listTreasuryCards } from "@/modules/treasury/service";

/** Tarjetas ligadas a una cuenta de banco. */
export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params;
    const session = await getCurrentSession();
    assertAuthenticated(session);
    return ok(await listTreasuryCards(id));
  } catch (error) {
    return toHttpErrorResponse(error);
  }
}

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params;
    const session = await getCurrentSession();
    assertAuthenticated(session);
    assertMaster(session);
    await requireCsrf(request, session);

    const parsed = createTreasuryCardSchema.safeParse(await request.json());
    if (!parsed.success) return fail("VALIDATION_ERROR", "Payload invalido.", 400, parsed.error.flatten());

    const card = await createTreasuryCard({ ...parsed.data, accountId: id, actorUserId: session.userId });
    return created(card);
  } catch (error) {
    return toHttpErrorResponse(error);
  }
}
