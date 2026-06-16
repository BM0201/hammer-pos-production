import { getCurrentSession } from "@/modules/auth/service";
import { assertAuthenticated } from "@/modules/auth/access";
import { postPaymentSchema } from "@/modules/payments/validators";
import { postSaleOrderPayment } from "@/modules/payments/service";
import { prisma } from "@/lib/prisma";
import { toApiErrorResponse } from "@/lib/api/errors";
import { created, validationFail } from "@/lib/api/response";
import { requireBranchCapability } from "@/modules/rbac/guards";
import { CAPABILITIES } from "@/modules/rbac/policies";
import { requireCsrf } from "@/modules/security/csrf";
import { assertBranchWorkflowAction, WORKFLOW_ACTIONS } from "@/modules/workflow/branch-workflow";

export async function POST(request: Request) {
  try {
    const session = await getCurrentSession();
    assertAuthenticated(session);
    await requireCsrf(request, session);

    const parsed = postPaymentSchema.safeParse(await request.json());
    if (!parsed.success) {
      return validationFail(parsed.error.flatten());
    }

    const order = await prisma.saleOrder.findUniqueOrThrow({ where: { id: parsed.data.saleOrderId } });

    // RBAC
    requireBranchCapability(session, order.branchId, CAPABILITIES.CASH_PAYMENTS_COLLECT);

    // Workflow guard: cashier must be enabled
    await assertBranchWorkflowAction(order.branchId, WORKFLOW_ACTIONS.COLLECT_PAYMENT);

    const data = await postSaleOrderPayment({
      saleOrderId: parsed.data.saleOrderId,
      cashSessionId: parsed.data.cashSessionId,
      amount: parsed.data.amount,
      method: parsed.data.method,
      actorUserId: session.userId,
      referenceNumber: parsed.data.referenceNumber,
      tenders: parsed.data.tenders,
    });

    return created(data);
  } catch (error) {
    return toApiErrorResponse(error);
  }
}
