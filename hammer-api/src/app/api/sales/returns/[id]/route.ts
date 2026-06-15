import { ok } from "@/lib/api/response";
import { toApiErrorResponse } from "@/lib/api/errors";
import { assertAuthenticated } from "@/modules/auth/access";
import { getCurrentSession } from "@/modules/auth/service";
import { requireBranchCapability, isMaster } from "@/modules/rbac/guards";
import { CAPABILITIES } from "@/modules/rbac/policies";
import { getSaleReturn } from "@/modules/sales-returns/service";

export async function GET(_request: Request, context: { params: Promise<{ id: string }> }) {
  try {
    const session = await getCurrentSession();
    assertAuthenticated(session);
    const { id } = await context.params;
    const saleReturn = await getSaleReturn(id);
    if (!isMaster(session)) {
      requireBranchCapability(session, saleReturn.branchId, CAPABILITIES.SALE_RETURN_REQUEST);
    }
    return ok(saleReturn);
  } catch (error) {
    return toApiErrorResponse(error);
  }
}
