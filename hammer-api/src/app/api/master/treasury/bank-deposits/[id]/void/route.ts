import { getCurrentSession } from "@/modules/auth/service";
import { assertAuthenticated, assertMaster } from "@/modules/auth/access";
import { ok, fail } from "@/lib/api/response";
import { toHttpErrorResponse } from "@/lib/http";
import { requireCsrf } from "@/modules/security/csrf";
import { voidBankDepositSchema } from "@/modules/treasury/validators";
import { voidBankDeposit } from "@/modules/treasury/service";

/**
 * prompt-tesoreria-depositos.md Fase 3 — anular un BankDeposit: no borra
 * nada, devuelve el monto del banco a la custodia de origen (RECONCILIATION)
 * y marca el depósito. El corte de getAccumulatedRetainedTx no se mueve.
 */
export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const session = await getCurrentSession();
    assertAuthenticated(session);
    assertMaster(session);
    await requireCsrf(request, session);

    const { id } = await params;
    const parsed = voidBankDepositSchema.safeParse(await request.json());
    if (!parsed.success) return fail("VALIDATION_ERROR", "Se requiere un motivo de anulación de al menos 10 caracteres.", 400, parsed.error.flatten());

    const result = await voidBankDeposit({ bankDepositId: id, actorUserId: session.userId, reason: parsed.data.reason });
    return ok(result);
  } catch (error) {
    return toHttpErrorResponse(error);
  }
}
