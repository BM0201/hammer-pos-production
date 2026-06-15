import { ok, validationFail } from "@/lib/api/response";
import { toApiErrorResponse } from "@/lib/api/errors";
import { assertAuthenticated } from "@/modules/auth/access";
import { getCurrentSession } from "@/modules/auth/service";
import { requireBranchCapability, isMaster } from "@/modules/rbac/guards";
import { CAPABILITIES } from "@/modules/rbac/policies";
import { requireCsrf } from "@/modules/security/csrf";
import { executeSaleReturn, getSaleReturn } from "@/modules/sales-returns/service";
import { executeSaleReturnSchema } from "@/modules/sales-returns/validators";

export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  try {
    const session = await getCurrentSession();
    assertAuthenticated(session);
    await requireCsrf(request, session);
    const parsed = executeSaleReturnSchema.safeParse(await request.json().catch(() => ({})));
    if (!parsed.success) return validationFail(parsed.error.flatten());
    const { id } = await context.params;
    const saleReturn = await getSaleReturn(id);
    if (!isMaster(session)) requireBranchCapability(session, saleReturn.branchId, CAPABILITIES.SALE_RETURN_EXECUTE);
    return ok(await executeSaleReturn(id, parsed.data, {
      userId: session.userId,
      roleCode: session.roleCode,
      globalRoles: session.globalRoles as string[],
    }));
  } catch (error) {
    return toApiErrorResponse(error);
  }
}
