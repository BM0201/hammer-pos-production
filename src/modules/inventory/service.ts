import { InventoryMovementType, Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { logAuditEvent } from "@/modules/audit/service";
import { approvalService } from "@/modules/approvals/service";
import { isInboundMovement, recalculateWeightedAverage, WacValidationError } from "@/modules/inventory/wac";
import { APPROVAL_REQUEST_TYPES } from "@/modules/approvals/constants";

export const INVENTORY_ADJUSTMENT_APPROVAL_THRESHOLD = 25;

export async function listInventoryBalances(params: { branchId: string; productId?: string }) {
  return prisma.inventoryBalance.findMany({
    where: {
      branchId: params.branchId,
      ...(params.productId ? { productId: params.productId } : {}),
    },
    include: { product: true, branch: true },
    orderBy: { product: { name: "asc" } },
  });
}

export async function listInventoryMovements(params: { branchId: string; productId?: string; limit?: number }) {
  return prisma.inventoryMovement.findMany({
    where: {
      branchId: params.branchId,
      ...(params.productId ? { productId: params.productId } : {}),
    },
    include: {
      product: {
        select: { id: true, sku: true, name: true },
      },
      branch: {
        select: { id: true, code: true, name: true },
      },
    },
    orderBy: { createdAt: "desc" },
    take: params.limit ?? 25,
  });
}

type InventoryMovementInput = {
  actorUserId: string;
  branchId: string;
  productId: string;
  movementType: InventoryMovementType;
  quantity: number;
  unitCost: number;
  referenceType: string;
  referenceId: string;
  notes?: string | null;
};

export async function createInventoryMovementTx(
  tx: Prisma.TransactionClient,
  input: InventoryMovementInput,
) {
  const movementQty = new Prisma.Decimal(input.quantity);
  const movementUnitCost = new Prisma.Decimal(input.unitCost);
  const inbound = isInboundMovement(input.movementType);

  // ── WAC pre-validation (fail fast before touching the DB) ─────────
  if (movementQty.lte(new Prisma.Decimal(0))) {
    throw new WacValidationError("INVALID_MOVEMENT_QUANTITY", "Quantity must be positive.");
  }
  if (movementUnitCost.lt(new Prisma.Decimal(0))) {
    throw new WacValidationError("NEGATIVE_UNIT_COST", "Unit cost cannot be negative.");
  }
  if (inbound && movementUnitCost.eq(new Prisma.Decimal(0))) {
    throw new WacValidationError("ZERO_COST_INBOUND", "Inbound movements require a positive unit cost.");
  }

  // Step 1: Ensure the balance row exists (idempotent upsert via Prisma).
  await tx.inventoryBalance.upsert({
    where: {
      branchId_productId: {
        branchId: input.branchId,
        productId: input.productId,
      },
    },
    create: {
      branchId: input.branchId,
      productId: input.productId,
      quantityOnHand: 0,
      weightedAverageCost: 0,
      inventoryValue: 0,
    },
    update: {},
  });

  // Step 2: Lock balance row to guarantee atomic stock/WAC updates under concurrency.
  await tx.$queryRaw`
    SELECT id
    FROM "InventoryBalance"
    WHERE "branchId" = ${input.branchId}
      AND "productId" = ${input.productId}
    FOR UPDATE
  `;

  // Step 3: Read the current balance row after lock acquisition.
  const balance = await tx.inventoryBalance.findUnique({
    where: {
      branchId_productId: {
        branchId: input.branchId,
        productId: input.productId,
      },
    },
  });

  if (!balance) {
    throw new Error("INVENTORY_BALANCE_NOT_FOUND");
  }

  const next = recalculateWeightedAverage({
    currentQty: balance.quantityOnHand,
    currentWac: balance.weightedAverageCost,
    movementQty,
    movementUnitCost,
    inbound,
  });

  const movement = await tx.inventoryMovement.create({
    data: {
      branchId: input.branchId,
      productId: input.productId,
      movementType: input.movementType,
      quantity: movementQty,
      unitCost: movementUnitCost,
      referenceType: input.referenceType,
      referenceId: input.referenceId,
      notes: input.notes,
    },
  });

  const updatedBalance = await tx.inventoryBalance.update({
    where: { id: balance.id },
    data: {
      quantityOnHand: next.newQty,
      weightedAverageCost: next.newWac,
      inventoryValue: next.inventoryValue,
    },
  });

  await tx.auditLog.create({
    data: {
      actorUserId: input.actorUserId,
      branchId: input.branchId,
      module: "inventory",
      action: "INVENTORY_MOVEMENT_CREATE",
      entityType: "InventoryMovement",
      entityId: movement.id,
      metadataJson: {
        movementType: input.movementType,
        quantity: input.quantity,
        unitCost: input.unitCost,
        balanceQty: updatedBalance.quantityOnHand.toString(),
        balanceWac: updatedBalance.weightedAverageCost.toString(),
      },
    },
  });

  return { movement, balance: updatedBalance };
}

export async function createInventoryMovement(input: InventoryMovementInput) {
  return prisma.$transaction((tx) => createInventoryMovementTx(tx, input));
}

export async function requestStockAdjustment(input: {
  actorUserId: string;
  branchId: string;
  productId: string;
  desiredQuantity: number;
  reason: string;
  currentQuantity?: number;
  adjustmentDelta?: number;
}) {
  const result = await approvalService.createRequest({
    branchId: input.branchId,
    requestedByUserId: input.actorUserId,
    referenceType: "STOCK_ADJUSTMENT",
    referenceId: input.productId,
    reason: input.reason,
    type: APPROVAL_REQUEST_TYPES.STOCK_ADJUSTMENT,
    payloadJson: {
      desiredQuantity: input.desiredQuantity,
      currentQuantity: input.currentQuantity,
      adjustmentDelta: input.adjustmentDelta,
    },
  });

  await logAuditEvent({
    actorUserId: input.actorUserId,
    branchId: input.branchId,
    module: "inventory",
    action: "STOCK_ADJUSTMENT_REQUESTED",
    entityType: "ApprovalRequest",
    entityId: result.requestId,
    metadataJson: {
      productId: input.productId,
      desiredQuantity: input.desiredQuantity,
      currentQuantity: input.currentQuantity,
      adjustmentDelta: input.adjustmentDelta,
      reason: input.reason,
      approvalStatus: "REQUESTED",
    },
  });

  return {
    status: "REQUESTED",
    requestId: result.requestId,
    message: "Solicitud enviada.",
    created: result.created,
  } as const;
}
