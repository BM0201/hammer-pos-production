import { NextResponse } from "next/server";
import { InventoryMovementType } from "@prisma/client";
import { getCurrentSession } from "@/modules/auth/service";
import { assertAuthenticated } from "@/modules/auth/access";
import { createInventoryMovement, listInventoryMovements } from "@/modules/inventory/service";
import { createInventoryMovementSchema } from "@/modules/inventory/validators";
import { toHttpErrorResponse } from "@/lib/http";
import { canPostMovement } from "@/modules/inventory/policy";
import { logAuditEvent } from "@/modules/audit/service";
import { hasBranchAccess } from "@/modules/rbac/guards";
import { canInBranch, CAPABILITIES } from "@/modules/rbac/policies";
import { calculateSuggestedPriceForProduct } from "@/modules/pricing/service";

export async function GET(request: Request) {
  try {
    const session = await getCurrentSession();
    assertAuthenticated(session);

    const { searchParams } = new URL(request.url);
    const branchId = searchParams.get("branchId");
    const productId = searchParams.get("productId") ?? undefined;

    if (!branchId) {
      return NextResponse.json({ message: "branchId is required" }, { status: 400 });
    }

    if (!hasBranchAccess(session, branchId)) {
      return NextResponse.json({ message: "Forbidden" }, { status: 403 });
    }

    const data = await listInventoryMovements({ branchId, productId, limit: 30 });
    return NextResponse.json({ data });
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
      return NextResponse.json({ message: "Unauthenticated" }, { status: 401 });
    }

    assertAuthenticated(session);

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
      return NextResponse.json({ message: "Invalid payload", issues: parsed.error.issues }, { status: 400 });
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
      return NextResponse.json({ message: "Forbidden" }, { status: 403 });
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
      return NextResponse.json({ message: "No tienes permiso para registrar movimientos manuales de inventario en esta sucursal." }, { status: 403 });
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
      return NextResponse.json({ message: "TIMBER_INTAKE_IN must use the future timber intake workflow." }, { status: 422 });
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
      return NextResponse.json({ message: "SALE_OUT is only allowed through the sales workflow." }, { status: 422 });
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
      return NextResponse.json({ message: "Role not allowed to post this movement type." }, { status: 403 });
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

    return NextResponse.json({ data: result, suggestedPricing }, { status: 201 });
  } catch (error) {
    // Surface WAC validation errors as 422 with structured details
    if (error instanceof Error && error.name === "WacValidationError") {
      return NextResponse.json(
        { message: error.message, code: (error as { code?: string }).code },
        { status: 422 },
      );
    }
    if (error instanceof Error && error.message === "INSUFFICIENT_STOCK") {
      return NextResponse.json({ message: "Insufficient stock for this movement." }, { status: 409 });
    }
    return toHttpErrorResponse(error);
  }
}
