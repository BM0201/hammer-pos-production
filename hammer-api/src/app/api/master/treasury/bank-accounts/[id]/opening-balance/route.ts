import { getCurrentSession } from "@/modules/auth/service";
import { assertAuthenticated, assertMaster } from "@/modules/auth/access";
import { ok, fail } from "@/lib/api/response";
import { toHttpErrorResponse } from "@/lib/http";
import { requireCsrf } from "@/modules/security/csrf";
import { setOpeningBalanceSchema } from "@/modules/treasury/validators";
import { setOpeningBalance } from "@/modules/treasury/service";

/**
 * prompt-libro-mayor-tesoreria.md §5 — el saldo de apertura se declara una
 * vez desde el estado de cuenta real, a una fecha de corte. No es un saldo
 * editable: es el punto de partida del que se calcula todo lo demás.
 */
export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params;
    const session = await getCurrentSession();
    assertAuthenticated(session);
    assertMaster(session);
    await requireCsrf(request, session);

    const parsed = setOpeningBalanceSchema.safeParse(await request.json());
    if (!parsed.success) return fail("VALIDATION_ERROR", "Payload invalido.", 400, parsed.error.flatten());

    const account = await setOpeningBalance({ accountId: id, ...parsed.data, actorUserId: session.userId });
    return ok(account);
  } catch (error) {
    return toHttpErrorResponse(error);
  }
}
