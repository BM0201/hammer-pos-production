import { z } from "zod";
import { fail, ok } from "@/lib/api/response";
import { toHttpErrorResponse } from "@/lib/http";
import { assertAuthenticated } from "@/modules/auth/access";
import { getCurrentSession } from "@/modules/auth/service";
import { isMaster } from "@/modules/rbac/guards";
import { requireCsrf } from "@/modules/security/csrf";
import { correctTenderMethod } from "@/modules/payments/correct-method";

const schema = z.object({
  method: z.enum(["CARD", "TRANSFER"]),
  referenceNumber: z.string().trim().min(1).max(100),
  bankAccountId: z.string().cuid().optional().nullable(),
  reason: z.string().trim().min(3).max(300),
});

/** POST /api/master/payment-tenders/[id]/correct-method — solo Master: un cobro anotado como efectivo que fue tarjeta o transferencia. */
export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const session = await getCurrentSession();
    assertAuthenticated(session);
    if (!isMaster(session)) return fail("FORBIDDEN", "Solo Master puede corregir el método de un cobro.", 403);
    await requireCsrf(request, session);

    const { id } = await params;
    const parsed = schema.safeParse(await request.json());
    if (!parsed.success) return fail("VALIDATION_ERROR", "Revisa método, referencia, cuenta y motivo.", 400, parsed.error.flatten());

    return ok(await correctTenderMethod({ paymentTenderId: id, ...parsed.data, actorUserId: session!.userId }));
  } catch (error) {
    const code = error instanceof Error ? error.message : "";
    const messages: Record<string, string> = {
      PAYMENT_NOT_POSTED: "Ese cobro no está registrado como cobrado.",
      SALE_ORDER_CANCELLED: "La venta está anulada.",
      TENDER_NOT_CASH: "Solo se corrige un cobro anotado como efectivo.",
      TENDER_IS_USD: "Un cobro en dólares no se corrige así.",
      CORRECTION_REASON_REQUIRED: "Escribe el motivo de la corrección.",
    };
    if (messages[code]) return fail(code, messages[code], 400);
    return toHttpErrorResponse(error);
  }
}
