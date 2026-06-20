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
import { created, fail } from "@/lib/api/response";
import { getEffectiveProductPricing } from "@/modules/catalog/effective-pricing";

function salePolicyError(error: unknown) {
  if (!(error instanceof Error)) return null;
  if (!["BELOW_COST_NOT_ALLOWED", "BELOW_COST_OVERRIDE_REASON_REQUIRED", "DISCOUNT_LIMIT_EXCEEDED"].includes(error.message)) return null;
  const details = (error as any).details;
  return fail(error.message, error.message === "DISCOUNT_LIMIT_EXCEEDED" ? "Este rol no puede aplicar ese descuento." : "El precio neto queda por debajo del costo efectivo del producto.", 409, details);
}

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
      return fail("FORBIDDEN", "Forbidden", 403);
    }

    const parsed = addSaleOrderLineSchema.safeParse(await request.json());
    if (!parsed.success) {
      return fail("VALIDATION_ERROR", "Invalid payload", 400);
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
      return fail("FORBIDDEN", "Forbidden", 403);
    }

    // ── Auto-apply active discounts ──
    let discountAmount = parsed.data.discountAmount ?? 0;
    if (parsed.data.discountPercent !== undefined && discountAmount === 0) {
      const pricing = await getEffectiveProductPricing(prisma, { branchId: order.branchId, productId: parsed.data.productId });
      const unitPrice = parsed.data.unitPrice ?? Number(pricing.effectivePrice);
      discountAmount = unitPrice * parsed.data.quantity * (parsed.data.discountPercent / 100);
    }
    if (discountAmount === 0) {
      try {
        const product = await prisma.product.findUnique({
          where: { id: parsed.data.productId },
          select: { id: true, abcClassification: true, xyzClassification: true, standardSalePrice: true },
        });
        if (product) {
          const activeDiscounts = await getActiveDiscountsForBranch(order.branchId);
          const pricing = await getEffectiveProductPricing(prisma, { branchId: order.branchId, productId: parsed.data.productId });
          const unitPrice = parsed.data.unitPrice ?? Number(pricing.effectivePrice);
          discountAmount = calculateDiscountForProduct(product, unitPrice, activeDiscounts) * parsed.data.quantity;
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
      actorRole: session.roleCode,
      overrideReason: parsed.data.overrideReason,
    });
    return created(data);
  } catch (error) {
    const policyResponse = salePolicyError(error);
    if (policyResponse) return policyResponse;
    return toHttpErrorResponse(error);
  }
}
