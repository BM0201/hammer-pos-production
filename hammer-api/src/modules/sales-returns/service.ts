import {
  ApprovalStatus,
  ApprovalType,
  CashMovementType,
  CashSessionStatus,
  CreditNoteStatus,
  CustomerRiskLevel,
  InventoryCondition,
  InventoryMovementType,
  OperationalDayStatus,
  PaymentStatus,
  Prisma,
  RefundMethod,
  RefundStatus,
  ReturnedItemCondition,
  ReturnInventoryDestination,
  SaleCancellationStatus,
  SaleOrderStatus,
  SaleReturnStatus,
  SaleReturnType,
} from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { syncCashSessionSnapshotTx } from "@/modules/cash-session/service";
import { createInventoryMovementTx } from "@/modules/inventory/service";
import { refreshOperationalDaySummaryTx } from "@/modules/operations/service";
import { cancelSaleOrder } from "@/modules/sales/service";

type Actor = {
  userId: string;
  roleCode?: string | null;
  globalRoles?: string[];
};

type SaleReturnItemInput = {
  saleOrderLineId: string;
  quantity: number;
  condition: ReturnedItemCondition;
  inventoryDestination: ReturnInventoryDestination;
};

type RequestSaleReturnInput = {
  saleOrderId: string;
  reason: string;
  returnType: SaleReturnType;
  items: SaleReturnItemInput[];
};

type ExecuteSaleReturnInput = {
  refundMethod: RefundMethod;
  cashSessionId?: string | null;
};

const RETURNABLE_SALE_STATUSES: SaleOrderStatus[] = [
  SaleOrderStatus.PAID,
  SaleOrderStatus.DISPATCH_PENDING,
  SaleOrderStatus.DISPATCHED,
];

const CANCELLABLE_SALE_STATUSES: SaleOrderStatus[] = [
  SaleOrderStatus.PENDING_PAYMENT,
  SaleOrderStatus.PAID,
  SaleOrderStatus.DISPATCH_PENDING,
  SaleOrderStatus.DISPATCHED,
];

const REJECTABLE_RETURN_STATUSES: SaleReturnStatus[] = [
  SaleReturnStatus.REQUESTED,
  SaleReturnStatus.APPROVED,
];

const REJECTABLE_CANCELLATION_STATUSES: SaleCancellationStatus[] = [
  SaleCancellationStatus.REQUESTED,
  SaleCancellationStatus.APPROVED,
];

function isMasterActor(actor: Actor): boolean {
  return actor.roleCode === "MASTER"
    || actor.roleCode === "OWNER"
    || actor.roleCode === "SYSTEM_ADMIN"
    || Boolean(actor.globalRoles?.some((role) => role === "MASTER" || role === "OWNER" || role === "SYSTEM_ADMIN"));
}

function assertMasterActor(actor: Actor): void {
  if (!isMasterActor(actor)) throw new Error("FORBIDDEN_MASTER_ONLY");
}

function d(value: Prisma.Decimal | number | string | null | undefined): Prisma.Decimal {
  return new Prisma.Decimal(value ?? 0);
}

function n(value: Prisma.Decimal | number | string | null | undefined): number {
  return Number(value ?? 0);
}

function toJsonValue(value: unknown): Prisma.InputJsonValue {
  return JSON.parse(JSON.stringify(value)) as Prisma.InputJsonValue;
}

function returnNumber(branchCode: string): string {
  return `SR-${branchCode}-${Date.now().toString(36).toUpperCase()}`;
}

async function createApprovalRequestTx(tx: Prisma.TransactionClient, input: {
  type: ApprovalType;
  branchId: string;
  referenceType: string;
  referenceId: string;
  reason: string;
  payloadJson: Prisma.InputJsonValue;
  requestedByUserId: string;
}) {
  const existing = await tx.approvalRequest.findFirst({
    where: {
      type: input.type,
      branchId: input.branchId,
      referenceType: input.referenceType,
      referenceId: input.referenceId,
      status: { in: [ApprovalStatus.REQUESTED, ApprovalStatus.UNDER_REVIEW] },
    },
    orderBy: { createdAt: "desc" },
  });
  if (existing) return { requestId: existing.id, created: false };

  const request = await tx.approvalRequest.create({
    data: {
      type: input.type,
      status: ApprovalStatus.REQUESTED,
      branchId: input.branchId,
      referenceType: input.referenceType,
      referenceId: input.referenceId,
      reason: input.reason,
      payloadJson: input.payloadJson,
      requestedByUserId: input.requestedByUserId,
    },
  });

  await tx.auditLog.create({
    data: {
      actorUserId: input.requestedByUserId,
      branchId: input.branchId,
      module: "approvals",
      action: "APPROVAL_REQUEST_CREATED",
      entityType: "ApprovalRequest",
      entityId: request.id,
      metadataJson: toJsonValue({
        type: input.type,
        referenceType: input.referenceType,
        referenceId: input.referenceId,
      }),
    },
  });

  return { requestId: request.id, created: true };
}

export function assertReturnItemDestination(input: {
  condition: ReturnedItemCondition;
  inventoryDestination: ReturnInventoryDestination;
}) {
  if (input.condition === ReturnedItemCondition.GOOD && input.inventoryDestination !== ReturnInventoryDestination.SELLABLE) {
    throw new Error("RETURN_ITEM_GOOD_MUST_GO_TO_SELLABLE");
  }
  if (input.condition === ReturnedItemCondition.DAMAGED && input.inventoryDestination !== ReturnInventoryDestination.DAMAGED) {
    throw new Error("RETURN_ITEM_DAMAGED_MUST_GO_TO_DAMAGED");
  }
  if (input.condition === ReturnedItemCondition.NOT_RETURNED && input.inventoryDestination !== ReturnInventoryDestination.NONE) {
    throw new Error("RETURN_ITEM_NOT_RETURNED_MUST_GO_TO_NONE");
  }
}

export function calculateRefundableAmount(input: {
  quantity: Prisma.Decimal;
  originalQuantity: Prisma.Decimal;
  lineSubtotal: Prisma.Decimal;
}): Prisma.Decimal {
  if (input.originalQuantity.lte(0)) throw new Error("INVALID_ORIGINAL_QUANTITY");
  return input.lineSubtotal.mul(input.quantity).div(input.originalQuantity);
}

function effectiveReturnCost(input: {
  lineCostSnapshot?: Prisma.Decimal | null;
  productAverageCost?: Prisma.Decimal | null;
  productGlobalCost?: Prisma.Decimal | null;
  productLastPurchaseCost?: Prisma.Decimal | null;
  fallbackUnitPrice: Prisma.Decimal;
}): Prisma.Decimal {
  const candidates = [
    input.lineCostSnapshot,
    input.productAverageCost,
    input.productGlobalCost,
    input.productLastPurchaseCost,
    input.fallbackUnitPrice,
  ];
  return candidates.find((value) => value && value.gt(0)) ?? new Prisma.Decimal(0);
}

async function findOpenOperationalDayId(tx: Prisma.TransactionClient, branchId: string) {
  const day = await tx.operationalDay.findFirst({
    where: { branchId, status: OperationalDayStatus.OPEN },
    orderBy: { openedAt: "desc" },
    select: { id: true },
  });
  return day?.id ?? null;
}

async function getPaidOrderForReturn(tx: Prisma.TransactionClient, saleOrderId: string) {
  const order = await tx.saleOrder.findUnique({
    where: { id: saleOrderId },
    include: {
      branch: { select: { id: true, code: true } },
      customer: { select: { id: true } },
      lines: {
        include: {
          product: {
            select: {
              id: true,
              averageCost: true,
              globalCost: true,
              lastPurchaseCost: true,
            },
          },
        },
      },
      payments: { where: { status: PaymentStatus.POSTED }, orderBy: { paidAt: "desc" } },
      transportServices: { select: { id: true, status: true } },
    },
  });
  if (!order) throw new Error("SALE_ORDER_NOT_FOUND");
  if (!RETURNABLE_SALE_STATUSES.includes(order.status)) {
    throw new Error("SALE_ORDER_NOT_RETURNABLE");
  }
  if (order.payments.length === 0) throw new Error("SALE_ORDER_NOT_PAID");
  return order;
}

async function alreadyRequestedOrReturnedByLine(tx: Prisma.TransactionClient, saleOrderId: string) {
  const returns = await tx.saleReturn.findMany({
    where: {
      saleOrderId,
      status: { notIn: [SaleReturnStatus.REJECTED, SaleReturnStatus.CANCELLED] },
    },
    include: { items: true },
  });
  const map = new Map<string, Prisma.Decimal>();
  for (const saleReturn of returns) {
    for (const item of saleReturn.items) {
      const current = map.get(item.saleOrderLineId) ?? new Prisma.Decimal(0);
      map.set(item.saleOrderLineId, current.add(item.quantity));
    }
  }
  return map;
}

export async function requestSaleReturn(input: RequestSaleReturnInput, actor: Actor) {
  return prisma.$transaction(async (tx) => {
    const order = await getPaidOrderForReturn(tx, input.saleOrderId);
    const lineById = new Map(order.lines.map((line) => [line.id, line]));
    const alreadyReturned = await alreadyRequestedOrReturnedByLine(tx, order.id);
    const operationalDayId = await findOpenOperationalDayId(tx, order.branchId);
    const affectsClosedOperationalDay = operationalDayId === null;

    const itemsData = input.items.map((item) => {
      assertReturnItemDestination(item);
      const line = lineById.get(item.saleOrderLineId);
      if (!line) throw new Error("SALE_RETURN_LINE_NOT_IN_ORDER");
      const requestedQty = new Prisma.Decimal(item.quantity);
      const previousQty = alreadyReturned.get(line.id) ?? new Prisma.Decimal(0);
      if (previousQty.add(requestedQty).gt(line.quantity)) throw new Error("SALE_RETURN_QUANTITY_EXCEEDS_SOLD");
      const refundableAmount = calculateRefundableAmount({
        quantity: requestedQty,
        originalQuantity: line.quantity,
        lineSubtotal: line.lineSubtotal,
      });
      return {
        saleOrderLineId: line.id,
        productId: line.productId,
        quantity: requestedQty,
        unitPricePaid: line.unitPrice,
        discountAllocated: line.discountAmount.mul(requestedQty).div(line.quantity),
        refundableAmount,
        condition: item.condition,
        inventoryDestination: item.inventoryDestination,
      };
    });

    const saleReturn = await tx.saleReturn.create({
      data: {
        returnNumber: returnNumber(order.branch.code),
        saleOrderId: order.id,
        branchId: order.branchId,
        customerId: order.customerId,
        operationalDayId,
        requestedByUserId: actor.userId,
        status: SaleReturnStatus.REQUESTED,
        returnType: input.returnType,
        reason: input.reason,
        affectsClosedOperationalDay,
        requiresMasterApproval: true,
        items: { create: itemsData },
      },
      include: { items: true },
    });

    const approval = await createApprovalRequestTx(tx, {
      type: ApprovalType.RETURN,
      branchId: order.branchId,
      referenceType: "SaleReturn",
      referenceId: saleReturn.id,
      reason: input.reason,
      payloadJson: toJsonValue({
        saleOrderId: order.id,
        returnNumber: saleReturn.returnNumber,
        returnType: input.returnType,
        refundableAmount: itemsData.reduce((sum, item) => sum + n(item.refundableAmount), 0),
      }),
      requestedByUserId: actor.userId,
    });
    await tx.saleReturn.update({
      where: { id: saleReturn.id },
      data: { approvalRequestId: approval.requestId },
    });

    await tx.auditLog.create({
      data: {
        actorUserId: actor.userId,
        branchId: order.branchId,
        module: "sales_returns",
        action: "SALE_RETURN_REQUESTED",
        entityType: "SaleReturn",
        entityId: saleReturn.id,
        metadataJson: toJsonValue({ saleOrderId: order.id, approvalRequestId: approval.requestId }),
      },
    });

    return tx.saleReturn.findUniqueOrThrow({ where: { id: saleReturn.id }, include: { items: true } });
  });
}

export async function approveSaleReturn(returnId: string, actor: Actor) {
  assertMasterActor(actor);
  return prisma.$transaction(async (tx) => {
    const existing = await tx.saleReturn.findUniqueOrThrow({ where: { id: returnId } });
    if (existing.status !== SaleReturnStatus.REQUESTED) throw new Error("SALE_RETURN_NOT_REQUESTED");
    const updated = await tx.saleReturn.update({
      where: { id: returnId },
      data: {
        status: SaleReturnStatus.APPROVED,
        approvedByMasterId: actor.userId,
        approvedAt: new Date(),
      },
    });
    if (existing.approvalRequestId) {
      await tx.approvalRequest.update({
        where: { id: existing.approvalRequestId },
        data: {
          status: "APPROVED",
          resolvedByUserId: actor.userId,
          resolvedAt: new Date(),
        },
      });
    }
    await tx.auditLog.create({
      data: {
        actorUserId: actor.userId,
        branchId: updated.branchId,
        module: "sales_returns",
        action: "SALE_RETURN_APPROVED",
        entityType: "SaleReturn",
        entityId: updated.id,
      },
    });
    return updated;
  });
}

export async function rejectSaleReturn(returnId: string, reason: string, actor: Actor) {
  assertMasterActor(actor);
  return prisma.$transaction(async (tx) => {
    const existing = await tx.saleReturn.findUniqueOrThrow({ where: { id: returnId } });
    if (!REJECTABLE_RETURN_STATUSES.includes(existing.status)) {
      throw new Error("SALE_RETURN_NOT_REJECTABLE");
    }
    const updated = await tx.saleReturn.update({
      where: { id: returnId },
      data: { status: SaleReturnStatus.REJECTED },
    });
    if (existing.approvalRequestId) {
      await tx.approvalRequest.update({
        where: { id: existing.approvalRequestId },
        data: {
          status: "REJECTED",
          resolvedByUserId: actor.userId,
          resolvedAt: new Date(),
          resolutionNotes: reason,
        },
      });
    }
    await tx.auditLog.create({
      data: {
        actorUserId: actor.userId,
        branchId: updated.branchId,
        module: "sales_returns",
        action: "SALE_RETURN_REJECTED",
        entityType: "SaleReturn",
        entityId: updated.id,
        metadataJson: { reason },
      },
    });
    return updated;
  });
}

async function addDamagedInventoryTx(tx: Prisma.TransactionClient, input: {
  branchId: string;
  productId: string;
  quantity: Prisma.Decimal;
  unitCost: Prisma.Decimal;
  referenceId: string;
  actorUserId: string;
}) {
  await tx.inventoryConditionBalance.upsert({
    where: {
      branchId_productId_condition: {
        branchId: input.branchId,
        productId: input.productId,
        condition: InventoryCondition.DAMAGED,
      },
    },
    create: {
      branchId: input.branchId,
      productId: input.productId,
      condition: InventoryCondition.DAMAGED,
      quantity: input.quantity,
    },
    update: { quantity: { increment: input.quantity } },
  });
  return tx.inventoryMovement.create({
    data: {
      branchId: input.branchId,
      productId: input.productId,
      movementType: InventoryMovementType.RETURN_IN_DAMAGED,
      quantity: input.quantity,
      unitCost: input.unitCost,
      referenceType: "SALE_RETURN_DAMAGED",
      referenceId: input.referenceId,
      notes: "Producto devuelto a inventario danado visible",
      userId: input.actorUserId,
    },
  });
}

export async function executeSaleReturn(returnId: string, input: ExecuteSaleReturnInput, actor: Actor) {
  return prisma.$transaction(async (tx) => {
    const saleReturn = await tx.saleReturn.findUniqueOrThrow({
      where: { id: returnId },
      include: {
        items: {
          include: {
            saleOrderLine: {
              include: {
                product: { select: { averageCost: true, globalCost: true, lastPurchaseCost: true } },
              },
            },
          },
        },
        saleOrder: { include: { payments: { where: { status: PaymentStatus.POSTED }, orderBy: { paidAt: "desc" } } } },
      },
    });
    if (saleReturn.status !== SaleReturnStatus.APPROVED) throw new Error("SALE_RETURN_NOT_APPROVED");
    if (input.refundMethod === RefundMethod.CASH && !input.cashSessionId) throw new Error("CASH_SESSION_REQUIRED_FOR_CASH_REFUND");

    const totalRefundable = saleReturn.items.reduce((sum, item) => sum.add(item.refundableAmount), new Prisma.Decimal(0));
    const inventoryMovementIds: string[] = [];

    for (const item of saleReturn.items) {
      const cost = effectiveReturnCost({
        lineCostSnapshot: item.saleOrderLine.costSnapshot,
        productAverageCost: item.saleOrderLine.product.averageCost,
        productGlobalCost: item.saleOrderLine.product.globalCost,
        productLastPurchaseCost: item.saleOrderLine.product.lastPurchaseCost,
        fallbackUnitPrice: item.unitPricePaid,
      });
      if (item.inventoryDestination === ReturnInventoryDestination.SELLABLE) {
        const result = await createInventoryMovementTx(tx, {
          actorUserId: actor.userId,
          branchId: saleReturn.branchId,
          productId: item.productId,
          movementType: InventoryMovementType.RETURN_IN,
          quantity: n(item.quantity),
          unitCost: n(cost),
          referenceType: "SALE_RETURN",
          referenceId: saleReturn.id,
          notes: `Devolucion ${saleReturn.returnNumber}`,
        });
        inventoryMovementIds.push(result.movement.id);
      } else if (item.inventoryDestination === ReturnInventoryDestination.DAMAGED) {
        const movement = await addDamagedInventoryTx(tx, {
          actorUserId: actor.userId,
          branchId: saleReturn.branchId,
          productId: item.productId,
          quantity: item.quantity,
          unitCost: cost,
          referenceId: saleReturn.id,
        });
        inventoryMovementIds.push(movement.id);
      }
    }

    let refundId: string | null = null;
    let creditNoteId: string | null = null;
    if (input.refundMethod === RefundMethod.CREDIT_NOTE) {
      if (!saleReturn.customerId) throw new Error("CUSTOMER_REQUIRED_FOR_CREDIT_NOTE");
      const note = await tx.creditNote.create({
        data: {
          customerId: saleReturn.customerId,
          saleOrderId: saleReturn.saleOrderId,
          saleReturnId: saleReturn.id,
          amount: totalRefundable,
          availableAmount: totalRefundable,
          reason: saleReturn.reason,
          status: CreditNoteStatus.AVAILABLE,
          createdByUserId: actor.userId,
          approvedByMasterId: saleReturn.approvedByMasterId,
        },
      });
      creditNoteId = note.id;
    } else {
      if (input.refundMethod === RefundMethod.CASH) {
        const session = await tx.cashSession.findUniqueOrThrow({ where: { id: input.cashSessionId! } });
        if (session.status !== CashSessionStatus.OPEN) throw new Error("CASH_SESSION_NOT_OPEN");
        if (session.operationalDayId) await refreshOperationalDaySummaryTx(tx, session.operationalDayId);
        await tx.cashMovement.create({
          data: {
            cashSessionId: session.id,
            type: CashMovementType.REFUND_OUT,
            amount: totalRefundable,
            reason: `Refund devolucion ${saleReturn.returnNumber}`,
            createdByUserId: actor.userId,
            approvedByUserId: saleReturn.approvedByMasterId,
          },
        });
        await syncCashSessionSnapshotTx(tx, session.id);
      }
      const refund = await tx.refund.create({
        data: {
          saleReturnId: saleReturn.id,
          paymentId: saleReturn.saleOrder.payments[0]?.id ?? null,
          cashSessionId: input.cashSessionId ?? null,
          branchId: saleReturn.branchId,
          customerId: saleReturn.customerId,
          method: input.refundMethod,
          amount: totalRefundable,
          status: RefundStatus.POSTED,
          requiresApproval: true,
          postedByUserId: actor.userId,
          approvedByMasterId: saleReturn.approvedByMasterId,
          postedAt: new Date(),
        },
      });
      refundId = refund.id;
    }

    const updated = await tx.saleReturn.update({
      where: { id: saleReturn.id },
      data: { status: SaleReturnStatus.EXECUTED, executedAt: new Date() },
    });

    if (saleReturn.customerId) {
      await recalculateCustomerCreditScoreTx(tx, saleReturn.customerId);
    }
    if (saleReturn.operationalDayId) {
      const day = await tx.operationalDay.findUnique({ where: { id: saleReturn.operationalDayId } });
      if (day?.approvedAt == null) await refreshOperationalDaySummaryTx(tx, saleReturn.operationalDayId);
    }

    await tx.auditLog.create({
      data: {
        actorUserId: actor.userId,
        branchId: saleReturn.branchId,
        module: "sales_returns",
        action: "SALE_RETURN_EXECUTED",
        entityType: "SaleReturn",
        entityId: saleReturn.id,
        metadataJson: toJsonValue({ refundId, creditNoteId, inventoryMovementIds, refundMethod: input.refundMethod }),
      },
    });

    return { saleReturn: updated, refundId, creditNoteId, inventoryMovementIds };
  }, { timeout: 20000 });
}

export async function requestSaleCancellation(saleOrderId: string, reason: string, actor: Actor) {
  return prisma.$transaction(async (tx) => {
    const order = await tx.saleOrder.findUniqueOrThrow({
      where: { id: saleOrderId },
      include: { transportServices: true, branch: { select: { id: true } } },
    });
    if (!CANCELLABLE_SALE_STATUSES.includes(order.status)) {
      throw new Error("SALE_ORDER_NOT_CANCELLABLE");
    }
    const operationalDayId = await findOpenOperationalDayId(tx, order.branchId);
    const hadTransport = order.requiresTransport || order.transportServices.length > 0 || order.transportAmount.gt(0);
    const transportWasExecuted = order.transportServices.some((transport) => transport.status === "DELIVERED");
    const cancellation = await tx.saleCancellation.create({
      data: {
        saleOrderId: order.id,
        branchId: order.branchId,
        operationalDayId,
        requestedByUserId: actor.userId,
        reason,
        hadTransport,
        transportWasExecuted,
      },
    });
    const approval = await createApprovalRequestTx(tx, {
      type: ApprovalType.OPERATION_OVERRIDE,
      branchId: order.branchId,
      referenceType: "SaleCancellation",
      referenceId: cancellation.id,
      reason,
      payloadJson: toJsonValue({ saleOrderId, hadTransport, transportWasExecuted }),
      requestedByUserId: actor.userId,
    });
    await tx.saleCancellation.update({ where: { id: cancellation.id }, data: { approvalRequestId: approval.requestId } });
    await tx.auditLog.create({
      data: {
        actorUserId: actor.userId,
        branchId: order.branchId,
        module: "sales_cancellations",
        action: "SALE_CANCELLATION_REQUESTED",
        entityType: "SaleCancellation",
        entityId: cancellation.id,
        metadataJson: { saleOrderId, approvalRequestId: approval.requestId, hadTransport, transportWasExecuted },
      },
    });
    return tx.saleCancellation.findUniqueOrThrow({ where: { id: cancellation.id } });
  });
}

export async function approveSaleCancellation(cancellationId: string, actor: Actor) {
  assertMasterActor(actor);
  return prisma.$transaction(async (tx) => {
    const existing = await tx.saleCancellation.findUniqueOrThrow({ where: { id: cancellationId } });
    if (existing.status !== SaleCancellationStatus.REQUESTED) throw new Error("SALE_CANCELLATION_NOT_REQUESTED");
    const updated = await tx.saleCancellation.update({
      where: { id: cancellationId },
      data: { status: SaleCancellationStatus.APPROVED, approvedByMasterId: actor.userId, approvedAt: new Date() },
    });
    if (existing.approvalRequestId) {
      await tx.approvalRequest.update({
        where: { id: existing.approvalRequestId },
        data: { status: "APPROVED", resolvedByUserId: actor.userId, resolvedAt: new Date() },
      });
    }
    await tx.auditLog.create({
      data: {
        actorUserId: actor.userId,
        branchId: updated.branchId,
        module: "sales_cancellations",
        action: "SALE_CANCELLATION_APPROVED",
        entityType: "SaleCancellation",
        entityId: updated.id,
      },
    });
    return updated;
  });
}

export async function rejectSaleCancellation(cancellationId: string, reason: string, actor: Actor) {
  assertMasterActor(actor);
  return prisma.$transaction(async (tx) => {
    const existing = await tx.saleCancellation.findUniqueOrThrow({ where: { id: cancellationId } });
    if (!REJECTABLE_CANCELLATION_STATUSES.includes(existing.status)) {
      throw new Error("SALE_CANCELLATION_NOT_REJECTABLE");
    }
    const updated = await tx.saleCancellation.update({
      where: { id: cancellationId },
      data: { status: SaleCancellationStatus.REJECTED },
    });
    if (existing.approvalRequestId) {
      await tx.approvalRequest.update({
        where: { id: existing.approvalRequestId },
        data: { status: "REJECTED", resolvedByUserId: actor.userId, resolvedAt: new Date(), resolutionNotes: reason },
      });
    }
    await tx.auditLog.create({
      data: {
        actorUserId: actor.userId,
        branchId: updated.branchId,
        module: "sales_cancellations",
        action: "SALE_CANCELLATION_REJECTED",
        entityType: "SaleCancellation",
        entityId: updated.id,
        metadataJson: { reason },
      },
    });
    return updated;
  });
}

export async function executeSaleCancellation(cancellationId: string, actor: Actor) {
  return prisma.$transaction(async (tx) => {
    const cancellation = await tx.saleCancellation.findUniqueOrThrow({ where: { id: cancellationId } });
    if (cancellation.status !== SaleCancellationStatus.APPROVED) throw new Error("SALE_CANCELLATION_NOT_APPROVED");
    const day = cancellation.operationalDayId
      ? await tx.operationalDay.findUnique({ where: { id: cancellation.operationalDayId } })
      : null;
    if (day?.approvedAt) {
      throw new Error("OPERATIONAL_DAY_ALREADY_APPROVED");
    }
  });
  const result = await cancelSaleOrder({
    orderId: (await prisma.saleCancellation.findUniqueOrThrow({ where: { id: cancellationId } })).saleOrderId,
    actorUserId: actor.userId,
    reason: "Anulacion aprobada por Master",
  });
  return prisma.$transaction(async (tx) => {
    const updated = await tx.saleCancellation.update({
      where: { id: cancellationId },
      data: { status: SaleCancellationStatus.EXECUTED, executedAt: new Date() },
    });
    await tx.auditLog.create({
      data: {
        actorUserId: actor.userId,
        branchId: updated.branchId,
        module: "sales_cancellations",
        action: "SALE_CANCELLATION_EXECUTED",
        entityType: "SaleCancellation",
        entityId: updated.id,
        metadataJson: toJsonValue({ cancelSaleOrderResult: result }),
      },
    });
    return { cancellation: updated, result };
  });
}

async function recalculateCustomerCreditScoreTx(tx: Prisma.TransactionClient, customerId: string) {
  const [purchases, returns, creditNotes, manualInvoices] = await Promise.all([
    tx.saleOrder.aggregate({
      where: { customerId, status: { not: SaleOrderStatus.CANCELLED } },
      _sum: { grandTotal: true },
      _count: { _all: true },
    }),
    tx.saleReturn.findMany({
      where: { customerId, status: SaleReturnStatus.EXECUTED },
      include: { items: { select: { refundableAmount: true } } },
    }),
    tx.creditNote.aggregate({
      where: { customerId, status: { not: CreditNoteStatus.VOIDED } },
      _sum: { amount: true },
      _count: { _all: true },
    }),
    tx.saleOrder.count({
      where: { customerId, requiresManualInvoice: true },
    }),
  ]);
  const totalPurchases = d(purchases._sum.grandTotal);
  const totalReturnsAmount = returns.reduce(
    (sum, saleReturn) => saleReturn.items.reduce((itemSum, item) => itemSum.add(item.refundableAmount), sum),
    new Prisma.Decimal(0),
  );
  const totalReturnsCount = returns.length;
  const totalOrders = purchases._count._all;
  const creditNoteAmount = d(creditNotes._sum.amount);
  const returnRate = totalPurchases.gt(0) ? totalReturnsAmount.div(totalPurchases) : new Prisma.Decimal(0);

  let score = 100;
  score -= Math.min(40, totalReturnsCount * 5);
  if (totalPurchases.gt(0)) {
    score -= Math.min(25, Number(totalReturnsAmount.div(totalPurchases).mul(100)));
  }
  if (totalPurchases.gt(0)) {
    score -= Math.min(30, Number(creditNoteAmount.div(totalPurchases).mul(100)));
  }
  if (totalOrders >= 10 && totalReturnsCount === 0) score += 5;
  score = Math.max(0, Math.min(100, Math.round(score)));
  const riskLevel = score < 35
    ? CustomerRiskLevel.BLOCKED
    : score < 55
    ? CustomerRiskLevel.HIGH
    : score < 75
    ? CustomerRiskLevel.MEDIUM
    : CustomerRiskLevel.LOW;

  return tx.customerCreditScore.upsert({
    where: { customerId },
    create: {
      customerId,
      score,
      riskLevel,
      totalPurchases,
      totalReturns: totalReturnsAmount,
      returnRate,
      unpaidBalance: 0,
      latePaymentsCount: 0,
      creditNotesIssued: creditNotes._count._all,
      manualInvoicesCount: manualInvoices,
      lastReviewAt: new Date(),
    },
    update: {
      score,
      riskLevel,
      totalPurchases,
      totalReturns: totalReturnsAmount,
      returnRate,
      unpaidBalance: 0,
      latePaymentsCount: 0,
      creditNotesIssued: creditNotes._count._all,
      manualInvoicesCount: manualInvoices,
      lastReviewAt: new Date(),
    },
  });
}

export async function recalculateCustomerCreditScore(customerId: string) {
  return prisma.$transaction((tx) => recalculateCustomerCreditScoreTx(tx, customerId));
}

export async function listSaleReturns(params: { branchIds?: string[]; status?: SaleReturnStatus }) {
  return prisma.saleReturn.findMany({
    where: {
      ...(params.branchIds?.length ? { branchId: { in: params.branchIds } } : {}),
      ...(params.status ? { status: params.status } : {}),
    },
    include: { items: true, branch: true, customer: true, saleOrder: { select: { id: true, orderNumber: true, grandTotal: true } } },
    orderBy: { createdAt: "desc" },
    take: 100,
  });
}

export async function getSaleReturn(returnId: string) {
  return prisma.saleReturn.findUniqueOrThrow({
    where: { id: returnId },
    include: { items: true, refunds: true, creditNotes: true, branch: true, customer: true, saleOrder: true },
  });
}

export async function listSaleCancellations(params: { branchIds?: string[]; status?: SaleCancellationStatus }) {
  return prisma.saleCancellation.findMany({
    where: {
      ...(params.branchIds?.length ? { branchId: { in: params.branchIds } } : {}),
      ...(params.status ? { status: params.status } : {}),
    },
    include: { branch: true, saleOrder: { select: { id: true, orderNumber: true, grandTotal: true, status: true } } },
    orderBy: { createdAt: "desc" },
    take: 100,
  });
}

export async function getSaleCancellation(cancellationId: string) {
  return prisma.saleCancellation.findUniqueOrThrow({
    where: { id: cancellationId },
    include: { branch: true, saleOrder: true, refunds: true },
  });
}
