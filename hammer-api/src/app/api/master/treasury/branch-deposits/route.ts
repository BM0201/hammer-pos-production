import { getCurrentSession } from "@/modules/auth/service";
import { assertAuthenticated, assertMaster } from "@/modules/auth/access";
import { created, fail } from "@/lib/api/response";
import { toHttpErrorResponse } from "@/lib/http";
import { requireCsrf } from "@/modules/security/csrf";
import { directBranchDepositSchema } from "@/modules/treasury/validators";
import { depositBranchCashDirect } from "@/modules/treasury/service";

/** Depósito directo: el acumulado de la sucursal sale directo al banco, sin pasar por "enviar y confirmar" (confirmBankDeposit). */
export async function POST(request: Request) {
  try {
    const session = await getCurrentSession();
    assertAuthenticated(session);
    assertMaster(session);
    await requireCsrf(request, session);

    const parsed = directBranchDepositSchema.safeParse(await request.json());
    if (!parsed.success) return fail("VALIDATION_ERROR", "Payload invalido.", 400, parsed.error.flatten());

    const result = await depositBranchCashDirect({ ...parsed.data, actorUserId: session.userId });
    return created(result);
  } catch (error) {
    return toHttpErrorResponse(error);
  }
}
