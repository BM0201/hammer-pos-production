import { getCurrentSession } from "@/modules/auth/service";
import { assertAuthenticated, assertMaster } from "@/modules/auth/access";
import { created, fail } from "@/lib/api/response";
import { toHttpErrorResponse } from "@/lib/http";
import { requireCsrf } from "@/modules/security/csrf";
import { confirmCardSettlementSchema } from "@/modules/treasury/validators";
import { confirmCardSettlement } from "@/modules/treasury/service";

/** Confirma que el adquirente liquidó SETTLEMENT hacia una cuenta bancaria — el bruto sale de SETTLEMENT, el neto entra al banco, la comisión queda como CARD_FEE. */
export async function POST(request: Request) {
  try {
    const session = await getCurrentSession();
    assertAuthenticated(session);
    assertMaster(session);
    await requireCsrf(request, session);

    const parsed = confirmCardSettlementSchema.safeParse(await request.json());
    if (!parsed.success) return fail("VALIDATION_ERROR", "Payload invalido.", 400, parsed.error.flatten());

    const result = await confirmCardSettlement({ ...parsed.data, confirmedByUserId: session.userId });
    return created(result);
  } catch (error) {
    return toHttpErrorResponse(error);
  }
}
