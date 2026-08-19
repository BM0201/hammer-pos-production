import { getCurrentSession } from "@/modules/auth/service";
import { assertAuthenticated, assertMaster } from "@/modules/auth/access";
import { ok, created, fail } from "@/lib/api/response";
import { toHttpErrorResponse } from "@/lib/http";
import { requireCsrf } from "@/modules/security/csrf";
import { confirmBankDepositSchema } from "@/modules/treasury/validators";
import { confirmBankDeposit } from "@/modules/treasury/service";

/** Confirma un depósito real — una de las dos fuentes del saldo esperado de la cuenta (§2.2). */
export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id: bankAccountId } = await params;
    const session = await getCurrentSession();
    assertAuthenticated(session);
    assertMaster(session);
    await requireCsrf(request, session);

    const parsed = confirmBankDepositSchema.safeParse(await request.json());
    if (!parsed.success) return fail("VALIDATION_ERROR", "Payload invalido.", 400, parsed.error.flatten());
    if (parsed.data.bankAccountId !== bankAccountId) return fail("VALIDATION_ERROR", "bankAccountId no coincide con la URL.", 400);

    const deposit = await confirmBankDeposit({ ...parsed.data, confirmedByUserId: session.userId });
    return created(deposit);
  } catch (error) {
    return toHttpErrorResponse(error);
  }
}
