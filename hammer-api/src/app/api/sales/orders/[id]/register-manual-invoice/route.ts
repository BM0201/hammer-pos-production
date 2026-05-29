/**
 * POST /api/sales/orders/[id]/register-manual-invoice
 * Registra los datos de una factura manual emitida para la orden.
 */
import { z } from "zod";
import { getCurrentSession } from "@/modules/auth/service";
import { assertAuthenticated } from "@/modules/auth/access";
import { toHttpErrorResponse } from "@/lib/http";
import { requireCsrf } from "@/modules/security/csrf";
import { ok, validationFail } from "@/lib/api/response";
import { registerManualInvoice } from "@/modules/documents/document-service";

type RouteParams = { params: Promise<{ id: string }> };

const registerManualInvoiceSchema = z.object({
  series: z.string().min(1).max(10),
  number: z.string().min(1).max(20),
  date: z.string().min(1),
  customerName: z.string().min(1).max(200),
  customerRuc: z.string().min(1).max(30),
  notes: z.string().max(500).optional(),
});

export async function POST(request: Request, { params }: RouteParams) {
  try {
    const session = await getCurrentSession();
    assertAuthenticated(session);
    await requireCsrf(request, session);

    const { id } = await params;
    const body = await request.json();
    const parsed = registerManualInvoiceSchema.safeParse(body);
    if (!parsed.success) return validationFail(parsed.error);

    const result = await registerManualInvoice({
      orderId: id,
      ...parsed.data,
      registeredByUserId: session.userId,
    });

    return ok(result);
  } catch (err) {
    return toHttpErrorResponse(err);
  }
}
