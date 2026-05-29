import { getCurrentSession } from "@/modules/auth/service";
import { assertAuthenticated } from "@/modules/auth/access";
import { createTransportService, listTransportServices } from "@/modules/transport/service";
import { createTransportSchema } from "@/modules/transport/validators";
import { TransportServiceStatus } from "@prisma/client";
import { CAPABILITIES } from "@/modules/rbac/policies";
import {
  getBranchIdsWithCapability,
  isPrivilegedGlobal,
  requireAnyBranchCapability,
  requireBranchCapability,
} from "@/modules/rbac/guards";
import { requireCsrf } from "@/modules/security/csrf";
import { ok, created, validationFail } from "@/lib/api/response";
import { toApiErrorResponse } from "@/lib/api/errors";
import { assertBranchWorkflowAction, WORKFLOW_ACTIONS } from "@/modules/workflow/branch-workflow";

export async function GET(request: Request) {
  try {
    const session = await getCurrentSession();
    assertAuthenticated(session);

    requireAnyBranchCapability(session, [CAPABILITIES.DISPATCH_VIEW]);

    const { searchParams } = new URL(request.url);
    const branchId = searchParams.get("branchId");
    const statusFilter = searchParams.get("status");

    const status = statusFilter ? (statusFilter.split(",") as TransportServiceStatus[]) : undefined;

    if (branchId) {
      requireBranchCapability(session, branchId, CAPABILITIES.DISPATCH_VIEW);
      const data = await listTransportServices({ branchIds: [branchId], status });
      return ok(data);
    }

    const branchIds = isPrivilegedGlobal(session)
      ? undefined
      : getBranchIdsWithCapability(session, CAPABILITIES.DISPATCH_VIEW);

    if (!isPrivilegedGlobal(session) && (!branchIds || branchIds.length === 0)) {
      return ok([]);
    }

    const data = await listTransportServices({ branchIds, status });
    return ok(data);
  } catch (error) {
    return toApiErrorResponse(error);
  }
}

export async function POST(request: Request) {
  try {
    const session = await getCurrentSession();
    assertAuthenticated(session);
    await requireCsrf(request, session);

    const parsed = createTransportSchema.safeParse(await request.json());
    if (!parsed.success) {
      return validationFail(parsed.error.flatten());
    }

    const body = parsed.data;

    requireAnyBranchCapability(session, [CAPABILITIES.DISPATCH_MARK]);
    requireBranchCapability(session, body.branchId, CAPABILITIES.DISPATCH_MARK);

    // Workflow guard
    await assertBranchWorkflowAction(body.branchId, WORKFLOW_ACTIONS.CREATE_TRANSPORT);

    const transport = await createTransportService({
      saleOrderId: body.saleOrderId,
      branchId: body.branchId,
      customerName: body.customerName,
      reference: body.reference ?? null,
      price: body.price,
      scheduledPaymentTime: body.scheduledPaymentTime ?? null,
      notes: body.notes ?? null,
      createdByUserId: session.userId,
    });

    return created(transport);
  } catch (error) {
    return toApiErrorResponse(error);
  }
}
