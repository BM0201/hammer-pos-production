export const dynamic = "force-dynamic";

import { SaleOrderStatus } from "@prisma/client";
import { getCurrentSession } from "@/modules/auth/service";
import { assertAuthenticated } from "@/modules/auth/access";
import { submitDirectSale } from "@/modules/sales/service";
import { prisma } from "@/lib/prisma";
import { CAPABILITIES } from "@/modules/rbac/policies";
import { canInBranch, requireBranchCapability } from "@/modules/rbac/guards";
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
    if (body.method === "CREDIT") {
      return fail("CREDIT_DIRECT_SALE_UNSUPPORTED", "Credito no disponible en venta directa.", 400);
    }
    const { id } = await params;

    const order = await prisma.saleOrder.findUnique({
      where: { id },
      select: { id: true, branchId: true, status: true, voidedAt: true, isTest: true },
    });

    if (!order) {
      return notFound("Orden no encontrada");
    }

    // Defensa en profundidad: rechaza temprano órdenes anuladas/prueba antes de
    // entrar a la transacción. (La transacción de submitDirectSale revalida.)
    if (order.voidedAt) {
      return fail("ORDER_VOIDED", "La orden fue anulada y no admite cambios ni cobros.", 409);
    }
    if (order.isTest) {
      return fail("ORDER_IS_TEST", "La orden esta marcada como prueba y no admite cambios ni cobros.", 409);
    }
    if (order.status !== SaleOrderStatus.DRAFT) {
      return fail("ORDER_NOT_DRAFT", "La orden no esta en estado editable.", 409);
    }

    // RBAC checks: direct collection is allowed either by explicit direct POS
    // permission or by combined seller + cashier permissions in the branch.
    const canDirectCollect = canInBranch(session, order.branchId, CAPABILITIES.POS_DIRECT_COLLECT);
    const canSellAndCollect = canInBranch(session, order.branchId, CAPABILITIES.POS_SEND_TO_CASHIER)
      && canInBranch(session, order.branchId, CAPABILITIES.PAYMENT_COLLECT_DIRECT);
    if (!canDirectCollect && !canSellAndCollect) {
      requireBranchCapability(session, order.branchId, CAPABILITIES.POS_DIRECT_COLLECT);
    }

    // Workflow guard: direct collection must be enabled for this branch.
    await assertBranchWorkflowAction(order.branchId, WORKFLOW_ACTIONS.DIRECT_SALE);

    const result = await submitDirectSale({
      saleOrderId: order.id,
      actorUserId: session.userId,
      cashSessionId: body.cashSessionId,
      method: body.method ?? "CASH",
      requiresTransport: body.requiresTransport,
      transportAmount: body.transportAmount,
      referenceNumber: body.referenceNumber ?? null,
      tenders: body.tenders,
    });

    return ok(result);
  } catch (error) {
    return toApiErrorResponse(error);
  }
}
