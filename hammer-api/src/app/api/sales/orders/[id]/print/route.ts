import { getCurrentSession } from "@/modules/auth/service";
import { assertAuthenticated } from "@/modules/auth/access";
import { createPrintLog, getPrintLogsForOrder } from "@/modules/print/service";
import { createPrintLogSchema } from "@/modules/print/validation";
import { toHttpErrorResponse } from "@/lib/http";
import { requireCsrf } from "@/modules/security/csrf";
import { ok, created, validationFail } from "@/lib/api/response";

type RouteParams = { params: Promise<{ id: string }> };

/**
 * GET /api/sales/orders/[id]/print
 * Obtener logs de impresión de una orden.
 */
export async function GET(_request: Request, { params }: RouteParams) {
  try {
    const session = await getCurrentSession();
    assertAuthenticated(session);

    const { id } = await params;
    const logs = await getPrintLogsForOrder(id);
    return ok(logs);
  } catch (err) {
    return toHttpErrorResponse(err);
  }
}

/**
 * POST /api/sales/orders/[id]/print
 * Registrar una impresión de documento para una orden.
 */
export async function POST(request: Request, { params }: RouteParams) {
  try {
    const session = await getCurrentSession();
    assertAuthenticated(session);
    await requireCsrf(request, session);

    const { id } = await params;
    const body = await request.json();
    const parsed = createPrintLogSchema.safeParse(body);
    if (!parsed.success) return validationFail(parsed.error);

    const log = await createPrintLog({
      saleOrderId: id,
      printedById: session.userId,
      ...parsed.data,
    });
    return created(log);
  } catch (err) {
    return toHttpErrorResponse(err);
  }
}
