import { getCurrentSession } from "@/modules/auth/service";
import { assertAuthenticated } from "@/modules/auth/access";
import { submitSaleOrderToPendingPayment } from "@/modules/sales/service";
import { saleOrderTransportSchema } from "@/modules/sales/validators";
import { prisma } from "@/lib/prisma";
import { requireCsrf } from "@/modules/security/csrf";
import { ok, validationFail } from "@/lib/api/response";
import { toApiErrorResponse } from "@/lib/api/errors";
import { requireBranchCapability } from "@/modules/rbac/guards";
import { CAPABILITIES } from "@/modules/rbac/policies";
import { assertBranchWorkflowAction, WORKFLOW_ACTIONS } from "@/modules/workflow/branch-workflow";

export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  try {
    const session = await getCurrentSession();
    assertAuthenticated(session);
    await requireCsrf(request, session);

    const { id } = await context.params;
    const order = await prisma.saleOrder.findUniqueOrThrow({ where: { id } });

    // RBAC check
    requireBranchCapability(session, order.branchId, CAPABILITIES.SALES_SUBMIT_PAYMENT);

    // Workflow guard: cashier must be enabled for submit-to-cashier flow
    await assertBranchWorkflowAction(order.branchId, WORKFLOW_ACTIONS.SUBMIT_TO_CASHIER);

    const transportPayload = saleOrderTransportSchema.safeParse(await request.json().catch(() => ({})));
    if (!transportPayload.success) {
      return validationFail(transportPayload.error.flatten());
    }

    const data = await submitSaleOrderToPendingPayment({
      saleOrderId: id,
      actorUserId: session.userId,
      requiresTransport: transportPayload.data.requiresTransport,
      transportAmount: transportPayload.data.transportAmount,
    });
    return ok(data);
  } catch (error) {
    return toApiErrorResponse(error);
  }
}
