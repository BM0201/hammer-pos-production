import { NextResponse } from "next/server";
import { getCurrentSession } from "@/modules/auth/service";
import { assertAuthenticated } from "@/modules/auth/access";
import { addSaleOrderLine } from "@/modules/sales/service";
import { addSaleOrderLineSchema } from "@/modules/sales/validators";
import { toHttpErrorResponse } from "@/lib/http";
import { prisma } from "@/lib/prisma";
import { isMaster } from "@/modules/rbac/guards";
import { logAuditEvent } from "@/modules/audit/service";
import { SALE_AUDIT_EVENTS } from "@/modules/sales/audit-events";
import { canInAnyAssignedBranch, canInBranch, CAPABILITIES } from "@/modules/rbac/policies";
import { getActiveDiscountsForBranch, calculateDiscountForProduct } from "@/modules/discounts/service";
import { requireCsrf } from "@/modules/security/csrf";

export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  try {
    const session = await getCurrentSession();
    assertAuthenticated(session);
    await requireCsrf(request, session);

    const { id } = await context.params;
    const order = await prisma.saleOrder.findUniqueOrThrow({ where: { id } });

    if (!canInAnyAssignedBranch(session, CAPABILITIES.SALES_DRAFT_MANAGE)) {
      await logAuditEvent({
        actorUserId: session.userId,
        branchId: order.branchId,
        module: "sales",
        action: SALE_AUDIT_EVENTS.ORDER_LINE_MUTATION_DENIED,
        entityType: "SaleOrder",
        entityId: id,
        metadataJson: { reason: "FORBIDDEN_ROLE", role: session.roleCode },
      });
      return NextResponse.json({ message: "Forbidden" }, { status: 403 });
    }

    const parsed = addSaleOrderLineSchema.safeParse(await request.json());
    if (!parsed.success) {
      return NextResponse.json({ message: "Invalid payload", issues: parsed.error.issues }, { status: 400 });
    }

    if (!isMaster(session) && !canInBranch(session, order.branchId, CAPABILITIES.SALES_DRAFT_MANAGE)) {
      await logAuditEvent({
        actorUserId: session.userId,
        branchId: order.branchId,
        module: "sales",
        action: SALE_AUDIT_EVENTS.ORDER_LINE_MUTATION_DENIED,
        entityType: "SaleOrder",
        entityId: id,
        metadataJson: { reason: "FORBIDDEN_BRANCH" },
      });
      return NextResponse.json({ message: "Forbidden" }, { status: 403 });
    }

    // ── Auto-apply active discounts ──
    let discountAmount = parsed.data.discountAmount ?? 0;
    if (discountAmount === 0) {
      try {
        const product = await prisma.product.findUnique({
          where: { id: parsed.data.productId },
          select: { id: true, abcClassification: true, xyzClassification: true, standardSalePrice: true },
        });
        if (product) {
          const activeDiscounts = await getActiveDiscountsForBranch(order.branchId);
          const unitPrice = parsed.data.unitPrice ?? Number(product.standardSalePrice);
          discountAmount = calculateDiscountForProduct(product, unitPrice, activeDiscounts);
        }
      } catch {
        // If discount calculation fails, proceed without discount
      }
    }

    const data = await addSaleOrderLine({
      ...parsed.data,
      discountAmount,
      saleOrderId: id,
      actorUserId: session.userId,
    });
    return NextResponse.json({ data }, { status: 201 });
  } catch (error) {
    return toHttpErrorResponse(error);
  }
}
