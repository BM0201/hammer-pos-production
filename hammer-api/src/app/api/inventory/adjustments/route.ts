import { NextResponse } from "next/server";
import { getCurrentSession } from "@/modules/auth/service";
import { assertAuthenticated } from "@/modules/auth/access";
import { createInventoryMovement, listInventoryBalances, requestStockAdjustment, INVENTORY_ADJUSTMENT_APPROVAL_THRESHOLD } from "@/modules/inventory/service";
import { stockAdjustmentSchema } from "@/modules/inventory/validators";
import { toHttpErrorResponse } from "@/lib/http";
import { canRequestStockAdjustment } from "@/modules/inventory/policy";
import { logAuditEvent } from "@/modules/audit/service";
import { hasBranchAccess } from "@/modules/rbac/guards";
import { canInBranch, CAPABILITIES } from "@/modules/rbac/policies";
import { requireCsrf } from "@/modules/security/csrf";
import { ok, created, fail } from "@/lib/api/response";

export async function POST(request: Request) {
  try {
    const session = await getCurrentSession();

    if (!session) {
      await logAuditEvent({
        module: "inventory",
        action: "STOCK_ADJUSTMENT_DENIED",
        entityType: "Product",
        entityId: "unauthenticated",
        metadataJson: { reason: "UNAUTHENTICATED" },
      });
      return fail("UNAUTHENTICATED", "Unauthenticated", 401);
    }

    assertAuthenticated(session);
    await requireCsrf(request, session);

    const parsed = stockAdjustmentSchema.safeParse(await request.json());
    if (!parsed.success) {
      await logAuditEvent({
        actorUserId: session.userId,
        module: "inventory",
        action: "STOCK_ADJUSTMENT_REJECTED",
        entityType: "Product",
        entityId: "payload",
        metadataJson: { reason: "INVALID_PAYLOAD" },
      });
      return fail("VALIDATION_ERROR", "Invalid payload", 400);
    }

    if (!hasBranchAccess(session, parsed.data.branchId)) {
      await logAuditEvent({
        actorUserId: session.userId,
        branchId: parsed.data.branchId,
        module: "inventory",
        action: "STOCK_ADJUSTMENT_DENIED",
        entityType: "Product",
        entityId: parsed.data.productId,
        metadataJson: { reason: "FORBIDDEN_BRANCH" },
      });
      return fail("FORBIDDEN", "Forbidden", 403);
    }

    if (!canInBranch(session, parsed.data.branchId, CAPABILITIES.APPROVAL_REQUEST_CREATE)) {
      return fail("FORBIDDEN", "Forbidden", 403);
    }

    const balances = await listInventoryBalances({ branchId: parsed.data.branchId, productId: parsed.data.productId });
    const currentQuantity = Number(balances[0]?.quantityOnHand ?? 0);
    const delta = parsed.data.desiredQuantity - currentQuantity;
    const absDelta = Math.abs(delta);

    if (absDelta === 0) {
      return ok({ status: "NO_CHANGES", message: "El inventario ya coincide con la cantidad solicitada." });
    }

    if (absDelta <= INVENTORY_ADJUSTMENT_APPROVAL_THRESHOLD && canRequestStockAdjustment(session.roleCode)) {
      const movementType = delta > 0 ? "ADJUSTMENT_IN" : "ADJUSTMENT_OUT";
      const unitCost = Number(balances[0]?.weightedAverageCost ?? 0);
      const data = await createInventoryMovement({
        actorUserId: session.userId,
        branchId: parsed.data.branchId,
        productId: parsed.data.productId,
        movementType,
        quantity: absDelta,
        unitCost,
        referenceType: "ADJUSTMENT_DIRECT",
        referenceId: parsed.data.productId,
        notes: parsed.data.reason,
      });

      return created({ status: "EXECUTED", data });
    }

    const response = await requestStockAdjustment({
      actorUserId: session.userId,
      branchId: parsed.data.branchId,
      productId: parsed.data.productId,
      desiredQuantity: parsed.data.desiredQuantity,
      reason: parsed.data.reason,
      currentQuantity,
      adjustmentDelta: delta,
    });

    return ok(response);
  } catch (error) {
    return toHttpErrorResponse(error);
  }
}
