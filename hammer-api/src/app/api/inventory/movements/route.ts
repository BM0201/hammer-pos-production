import { InventoryMovementType } from "@prisma/client";
import { getCurrentSession } from "@/modules/auth/service";
import { assertAuthenticated } from "@/modules/auth/access";
import { createInventoryMovement, listInventoryMovementsPaginated } from "@/modules/inventory/service";
import { createInventoryMovementSchema } from "@/modules/inventory/validators";
import { toHttpErrorResponse } from "@/lib/http";
import { canPostMovement } from "@/modules/inventory/policy";
import { logAuditEvent } from "@/modules/audit/service";
import { hasBranchAccess } from "@/modules/rbac/guards";
import { canInBranch, CAPABILITIES } from "@/modules/rbac/policies";
import { calculateSuggestedPriceForProduct } from "@/modules/pricing/service";
import { requireCsrf } from "@/modules/security/csrf";
import { ok, created, fail } from "@/lib/api/response";

export async function GET(request: Request) {
  try {
    const session = await getCurrentSession();
    assertAuthenticated(session);

    const { searchParams } = new URL(request.url);
    const branchId = searchParams.get("branchId");
    const productId = searchParams.get("productId") ?? undefined;
    const movementType = searchParams.get("movementType") as InventoryMovementType | null;
    const page = Number(searchParams.get("page") ?? 1);
    const limit = Number(searchParams.get("limit") ?? 30);
    const dateFrom = searchParams.get("dateFrom") ?? undefined;
    const dateTo = searchParams.get("dateTo") ?? undefined;
    const search = searchParams.get("search") ?? undefined;

    if (!branchId) {
      return fail("VALIDATION_ERROR", "branchId is required", 400);
    }
    if (movementType && !Object.values(InventoryMovementType).includes(movementType)) {
      return fail("VALIDATION_ERROR", "Invalid movementType", 400);
    }

    if (!hasBranchAccess(session, branchId)) {
      return fail("FORBIDDEN", "Forbidden", 403);
    }

    const data = await listInventoryMovementsPaginated({
      branchId,
      productId,
      movementType: movementType ?? undefined,
      page,
      limit,
      dateFrom,
      dateTo,
      search,
    });
    return ok(data);
  } catch (error) {
    return toHttpErrorResponse(error);
  }
}

export async function POST(request: Request) {
  try {
    const session = await getCurrentSession();

    if (!session) {
      await logAuditEvent({
        module: "inventory",
        action: "INVENTORY_MOVEMENT_DENIED",
        entityType: "InventoryMovement",
        entityId: "unauthenticated",
        metadataJson: { reason: "UNAUTHENTICATED" },
      });
      return fail("UNAUTHENTICATED", "Unauthenticated", 401);
    }

    assertAuthenticated(session);
    await requireCsrf(request, session);

    const parsed = createInventoryMovementSchema.safeParse(await request.json());
    if (!parsed.success) {
      await logAuditEvent({
        actorUserId: session.userId,
        module: "inventory",
        action: "INVENTORY_MOVEMENT_REJECTED",
        entityType: "InventoryMovement",
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
        action: "INVENTORY_MOVEMENT_DENIED",
        entityType: "InventoryMovement",
        entityId: parsed.data.productId,
        metadataJson: { reason: "FORBIDDEN_BRANCH" },
      });
      return fail("FORBIDDEN", "Forbidden", 403);
    }

    if (!canInBranch(session, parsed.data.branchId, CAPABILITIES.INVENTORY_MOVEMENT_POST)) {
      await logAuditEvent({
        actorUserId: session.userId,
        branchId: parsed.data.branchId,
        module: "inventory",
        action: "INVENTORY_MOVEMENT_DENIED",
        entityType: "InventoryMovement",
        entityId: parsed.data.productId,
        metadataJson: { reason: "FORBIDDEN_CAPABILITY", capability: CAPABILITIES.INVENTORY_MOVEMENT_POST },
      });
      return fail("FORBIDDEN", "No tienes permiso para registrar movimientos manuales de inventario en esta sucursal.", 403);
    }

    const movementType = parsed.data.movementType as InventoryMovementType;

    if (movementType === "TIMBER_INTAKE_IN") {
      await logAuditEvent({
        actorUserId: session.userId,
        branchId: parsed.data.branchId,
        module: "inventory",
        action: "INVENTORY_MOVEMENT_REJECTED",
        entityType: "InventoryMovement",
        entityId: parsed.data.productId,
        metadataJson: { reason: "TIMBER_ENDPOINT_BLOCKED" },
      });
      return fail("VALIDATION_ERROR", "TIMBER_INTAKE_IN must use the future timber intake workflow.", 422);
    }

    if (movementType === "SALE_OUT") {
      await logAuditEvent({
        actorUserId: session.userId,
        branchId: parsed.data.branchId,
        module: "inventory",
        action: "INVENTORY_MOVEMENT_REJECTED",
        entityType: "InventoryMovement",
        entityId: parsed.data.productId,
        metadataJson: { reason: "SALE_OUT_REQUIRES_SALES_WORKFLOW" },
      });
      return fail("VALIDATION_ERROR", "SALE_OUT is only allowed through the sales workflow.", 422);
    }

    if (!canPostMovement(session.roleCode, movementType)) {
      await logAuditEvent({
        actorUserId: session.userId,
        branchId: parsed.data.branchId,
        module: "inventory",
        action: "INVENTORY_MOVEMENT_DENIED",
        entityType: "InventoryMovement",
        entityId: parsed.data.productId,
        metadataJson: { role: session.roleCode, movementType },
      });
      return fail("FORBIDDEN", "Role not allowed to post this movement type.", 403);
    }

    const result = await createInventoryMovement({
      actorUserId: session.userId,
      branchId: parsed.data.branchId,
      productId: parsed.data.productId,
      movementType,
      quantity: parsed.data.quantity,
      unitCost: parsed.data.unitCost,
      referenceType: parsed.data.referenceType,
      referenceId: parsed.data.referenceId,
      notes: parsed.data.notes,
    });

    // ── After PURCHASE_IN: calculate suggested price automatically ──
    let suggestedPricing = null;
    if (movementType === "PURCHASE_IN") {
      try {
        const pricing = await calculateSuggestedPriceForProduct({
          branchId: parsed.data.branchId,
          purchaseCostPerUnit: parsed.data.unitCost,
          productId: parsed.data.productId,
          actorUserId: session.userId,
        });
        suggestedPricing = {
          purchaseCost: Number(pricing.purchaseCost),
          operatingExpensePerUnit: Number(pricing.operatingExpensePerUnit),
          totalCostPerUnit: Number(pricing.totalCostPerUnit),
          marginPercent: Number(pricing.marginPercent),
          suggestedPrice: Number(pricing.suggestedPrice),
          totalMonthlyExpenses: Number(pricing.totalMonthlyExpenses),
          estimatedMonthlyUnits: Number(pricing.estimatedMonthlyUnits),
          configExists: pricing.configExists,
        };
      } catch (e) {
        // Non-blocking: pricing calculation failure shouldn't prevent inventory movement
        console.warn("Suggested price calculation failed:", e);
      }
    }

    return created({ result, suggestedPricing });
  } catch (error) {
    // Surface WAC validation errors as 422 with structured details
    if (error instanceof Error && error.name === "WacValidationError") {
      return fail("VALIDATION_ERROR", error.message, 422);
    }
    if (error instanceof Error && error.message === "INSUFFICIENT_STOCK") {
      return fail("CONFLICT", "Insufficient stock for this movement.", 409);
    }
    return toHttpErrorResponse(error);
  }
}
