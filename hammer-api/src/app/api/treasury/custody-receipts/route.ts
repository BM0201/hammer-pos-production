import { getCurrentSession } from "@/modules/auth/service";
import { assertAuthenticated } from "@/modules/auth/access";
import { isMaster } from "@/modules/rbac/guards";
import { created, fail } from "@/lib/api/response";
import { toHttpErrorResponse } from "@/lib/http";
import { requireCsrf } from "@/modules/security/csrf";
import { confirmCustodyReceiptSchema } from "@/modules/treasury/validators";
import { confirmCustodyReceipt } from "@/modules/treasury/cash-monitor";

/**
 * Confirma que se recibió efectivo que estaba en custodia de otra persona —
 * el lado que faltaba: sendCashOutToCustody solo dejaba el dinero en la
 * custodia de quien lo carga, nadie del otro lado confirmaba haberlo
 * recibido. Cualquier autenticado puede confirmar su PROPIA recepción;
 * confirmar en nombre de otra persona requiere Master.
 */
export async function POST(request: Request) {
  try {
    const session = await getCurrentSession();
    assertAuthenticated(session);
    await requireCsrf(request, session);

    const parsed = confirmCustodyReceiptSchema.safeParse(await request.json());
    if (!parsed.success) return fail("VALIDATION_ERROR", "Payload invalido.", 400, parsed.error.flatten());

    const receivedByUserId = parsed.data.receivedByUserId ?? session.userId;
    if (receivedByUserId !== session.userId && !isMaster(session)) {
      return fail("FORBIDDEN", "Solo podes confirmar recepcion hacia tu propia custodia.", 403);
    }

    const result = await confirmCustodyReceipt({
      fromCustodyAccountId: parsed.data.fromCustodyAccountId,
      amount: parsed.data.amount,
      receivedByUserId,
      notes: parsed.data.notes,
    });
    return created(result);
  } catch (error) {
    return toHttpErrorResponse(error);
  }
}
