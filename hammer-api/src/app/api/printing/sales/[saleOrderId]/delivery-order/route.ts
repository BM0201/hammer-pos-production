import { getCurrentSession } from "@/modules/auth/service";
import { assertAuthenticated } from "@/modules/auth/access";
import { ok } from "@/lib/api/response";
import { toHttpErrorResponse } from "@/lib/http";
import { renderDeliveryOrder } from "@/modules/printing/printing-service";
import { requireSaleOrderPrintAccess } from "@/modules/printing/printing-access";

type RouteParams = { params: Promise<{ saleOrderId: string }> };

export async function GET(request: Request, { params }: RouteParams) {
  try {
    const session = await getCurrentSession();
    assertAuthenticated(session);
    const { saleOrderId } = await params;
    await requireSaleOrderPrintAccess(session!, saleOrderId);
    const url = new URL(request.url);
    return ok(await renderDeliveryOrder({
      saleOrderId,
      branchId: url.searchParams.get("branchId") ?? undefined,
      format: url.searchParams.get("format"),
    }));
  } catch (error) {
    return toHttpErrorResponse(error);
  }
}
