import { SaleReturnStatus } from "@prisma/client";
import { created, ok, validationFail } from "@/lib/api/response";
import { toApiErrorResponse } from "@/lib/api/errors";
import { prisma } from "@/lib/prisma";
import { assertAuthenticated } from "@/modules/auth/access";
import { getCurrentSession } from "@/modules/auth/service";
import { requireBranchCapability, getBranchIdsWithCapability, isMaster } from "@/modules/rbac/guards";
import { CAPABILITIES } from "@/modules/rbac/policies";
import { requireCsrf } from "@/modules/security/csrf";
import { listSaleReturns, requestSaleReturn } from "@/modules/sales-returns/service";
import { requestSaleReturnSchema } from "@/modules/sales-returns/validators";

export async function GET(request: Request) {
  try {
    const session = await getCurrentSession();
    assertAuthenticated(session);
    const { searchParams } = new URL(request.url);
    const status = searchParams.get("status") as SaleReturnStatus | null;
    const branchIds = isMaster(session) ? undefined : getBranchIdsWithCapability(session, CAPABILITIES.SALE_RETURN_REQUEST);
    return ok(await listSaleReturns({ branchIds, status: status ?? undefined }));
  } catch (error) {
    return toApiErrorResponse(error);
  }
}

export async function POST(request: Request) {
  try {
    const session = await getCurrentSession();
    assertAuthenticated(session);
    await requireCsrf(request, session);
    const parsed = requestSaleReturnSchema.safeParse(await request.json());
    if (!parsed.success) return validationFail(parsed.error.flatten());

    const order = await prisma.saleOrder.findUniqueOrThrow({
      where: { id: parsed.data.saleOrderId },
      select: { branchId: true },
    });
    requireBranchCapability(session, order.branchId, CAPABILITIES.SALE_RETURN_REQUEST);

    return created(await requestSaleReturn(parsed.data, {
      userId: session.userId,
      roleCode: session.roleCode,
      globalRoles: session.globalRoles as string[],
    }));
  } catch (error) {
    return toApiErrorResponse(error);
  }
}
