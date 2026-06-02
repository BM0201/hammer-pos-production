import { getCurrentSession } from "@/modules/auth/service";
import { assertAuthenticated } from "@/modules/auth/access";
import { ok } from "@/lib/api/response";
import { toHttpErrorResponse } from "@/lib/http";
import { renderPurchaseReceiptDocument } from "@/modules/printing/printing-service";

type RouteParams = { params: Promise<{ purchaseOrderId: string }> };

export async function GET(request: Request, { params }: RouteParams) {
  try {
    const session = await getCurrentSession();
    assertAuthenticated(session);
    const { purchaseOrderId } = await params;
    const url = new URL(request.url);
    return ok(await renderPurchaseReceiptDocument({
      purchaseOrderId,
      branchId: url.searchParams.get("branchId") ?? undefined,
      format: url.searchParams.get("format"),
    }));
  } catch (error) {
    return toHttpErrorResponse(error);
  }
}
