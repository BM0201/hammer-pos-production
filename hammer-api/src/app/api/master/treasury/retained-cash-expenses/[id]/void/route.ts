import { getCurrentSession } from "@/modules/auth/service";
import { assertAuthenticated, assertMaster } from "@/modules/auth/access";
import { ok, fail } from "@/lib/api/response";
import { toHttpErrorResponse } from "@/lib/http";
import { requireCsrf } from "@/modules/security/csrf";
import { voidRetainedCashExpenseSchema } from "@/modules/treasury/validators";
import { voidRetainedCashExpense } from "@/modules/treasury/service";

/**
 * Anular un gasto pagado con efectivo retenido — no borra nada, escribe un
 * asiento inverso (T-1). El acumulado vuelve a subir por la misma vía por
 * la que bajó.
 */
export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const session = await getCurrentSession();
    assertAuthenticated(session);
    assertMaster(session);
    await requireCsrf(request, session);

    const { id } = await params;
    const parsed = voidRetainedCashExpenseSchema.safeParse(await request.json());
    if (!parsed.success) return fail("VALIDATION_ERROR", "Se requiere una razón de anulación de al menos 10 caracteres.", 400, parsed.error.flatten());

    const result = await voidRetainedCashExpense({ expenseId: id, actorUserId: session.userId, reason: parsed.data.reason });
    return ok(result);
  } catch (error) {
    return toHttpErrorResponse(error);
  }
}
