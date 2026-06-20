import { getCurrentSession } from "@/modules/auth/service";
import { assertAuthenticated } from "@/modules/auth/access";
import { ok } from "@/lib/api/response";
import { toHttpErrorResponse } from "@/lib/http";
import { renderTransferDocument } from "@/modules/printing/printing-service";
import { requireTransferPrintAccess } from "@/modules/printing/printing-access";

type RouteParams = { params: Promise<{ transferId: string }> };

export async function GET(request: Request, { params }: RouteParams) {
  try {
    const session = await getCurrentSession();
    assertAuthenticated(session);
    const { transferId } = await params;
    await requireTransferPrintAccess(session!, transferId);
    const url = new URL(request.url);
    return ok(await renderTransferDocument({
      transferId,
      branchId: url.searchParams.get("branchId") ?? undefined,
      format: url.searchParams.get("format"),
    }));
  } catch (error) {
    return toHttpErrorResponse(error);
  }
}
