import { getCurrentSession } from "@/modules/auth/service";
import { assertAuthenticated, assertMaster } from "@/modules/auth/access";
import { created, fail } from "@/lib/api/response";
import { toHttpErrorResponse } from "@/lib/http";
import { requireCsrf } from "@/modules/security/csrf";
import { recordAccountPaymentSchema } from "@/modules/treasury/validators";
import { recordAccountPayment } from "@/modules/treasury/service";

/**
 * Registrar un pago que SALE de una cuenta registrada (proveedor, planilla o
 * gasto). Baja el saldo esperado de esa cuenta — la contraparte del cobro que
 * ya entraba por venta. Solo Master.
 */
export async function POST(request: Request) {
  try {
    const session = await getCurrentSession();
    assertAuthenticated(session);
    assertMaster(session);
    await requireCsrf(request, session);

    const parsed = recordAccountPaymentSchema.safeParse(await request.json());
    if (!parsed.success) return fail("VALIDATION_ERROR", "Payload invalido.", 400, parsed.error.flatten());

    const entry = await recordAccountPayment({ ...parsed.data, actorUserId: session.userId });
    return created(entry);
  } catch (error) {
    return toHttpErrorResponse(error);
  }
}
