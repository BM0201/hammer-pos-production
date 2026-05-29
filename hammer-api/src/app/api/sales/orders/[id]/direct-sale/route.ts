export const dynamic = "force-dynamic";

import { SaleOrderStatus } from "@prisma/client";
import { getCurrentSession } from "@/modules/auth/service";
import { assertAuthenticated } from "@/modules/auth/access";
import { submitDirectSale } from "@/modules/sales/service";
import { prisma } from "@/lib/prisma";
import { CAPABILITIES } from "@/modules/rbac/policies";
import { requireBranchCapability } from "@/modules/rbac/guards";
import { requireCsrf } from "@/modules/security/csrf";
import { saleOrderDirectSaleSchema } from "@/modules/sales/validators";
import { ok, validationFail, fail, notFound } from "@/lib/api/response";
import { toApiErrorResponse } from "@/lib/api/errors";
import { assertBranchWorkflowAction, WORKFLOW_ACTIONS } from "@/modules/workflow/branch-workflow";

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const session = await getCurrentSession();
    assertAuthenticated(session);
    await requireCsrf(request, session);

    const parsedBody = saleOrderDirectSaleSchema.safeParse(await request.json());
    if (!parsedBody.success) {
      return validationFail(parsedBody.error.flatten());
    }

    const body = parsedBody.data;
    const { id } = await params;

    const order = await prisma.saleOrder.findUnique({
      where: { id },
      select: { id: true, branchId: true, status: true },
    });

    if (!order) {
      return notFound("Orden no encontrada");
    }

    if (order.status !== SaleOrderStatus.DRAFT) {
      return fail("ORDER_NOT_DRAFT", "La orden no esta en estado editable.", 409);
    }

    // RBAC checks
    requireBranchCapability(session, order.branchId, CAPABILITIES.SALES_SUBMIT_PAYMENT);

    // Workflow guard: cashier must be DISABLED for direct sale
    await assertBranchWorkflowAction(order.branchId, WORKFLOW_ACTIONS.DIRECT_SALE);

    const result = await submitDirectSale({
      saleOrderId: order.id,
      actorUserId: session.userId,
      cashSessionId: body.cashSessionId,
      method: body.method ?? "CASH",
      requiresTransport: body.requiresTransport,
      transportAmount: body.transportAmount,
      referenceNumber: body.referenceNumber ?? null,
    });

    return ok(result);
  } catch (error) {
    return toApiErrorResponse(error);
  }
}
