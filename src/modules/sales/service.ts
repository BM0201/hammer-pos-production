import { DispatchStatus, Prisma, SaleOrderStatus, InventoryMovementType, PaymentMethod, PaymentStatus, CashSessionStatus } from "@prisma/client";
import { randomBytes } from "node:crypto";
import { prisma } from "@/lib/prisma";
import { logAuditEvent } from "@/modules/audit/service";
import { aggregateOrderTotals, calculateLineSubtotal } from "@/modules/sales/totals";
import { SALE_AUDIT_EVENTS } from "@/modules/sales/audit-events";
import { getTodayClosure, recordEmergencySale } from "@/modules/cash-closure/service";
import { getBranchModuleConfig } from "@/modules/branch-config/service";
import { createInventoryMovementTx } from "@/modules/inventory/service";

// FIX BUG-010: Use crypto-random suffix instead of Date.now() to prevent collisions
function makeOrderNumber(branchCode: string) {
  const ts = Date.now().toString(36).toUpperCase();
  const rand = randomBytes(4).toString("hex").toUpperCase();
  return `SO-${branchCode}-${ts}-${rand}`;
}

export async function listSaleOrders(params: { branchId: string; includeAllBranches: boolean }) {
  return prisma.saleOrder.findMany({
    where: params.includeAllBranches ? {} : { branchId: params.branchId },
    include: { lines: { include: { product: { select: { id: true, name: true, sku: true } } } }, branch: true, createdBy: true },
    orderBy: { createdAt: "desc" },
    take: 100,
  });
}

export async function createDraftSaleOrder(input: {
  branchId: string;
  customerId?: string | null;
  notes?: string | null;
  actorUserId: string;
}) {
  // Check cash closure status before allowing new sales
  const { canSell, closure } = await getTodayClosure(input.branchId);
  if (!canSell) {
    throw new Error("BRANCH_CLOSED");
  }

  const branch = await prisma.branch.findUniqueOrThrow({ where: { id: input.branchId } });

  const order = await prisma.saleOrder.create({
    data: {
      orderNumber: makeOrderNumber(branch.code),
      branchId: input.branchId,
      customerId: input.customerId ?? null,
      createdByUserId: input.actorUserId,
      status: SaleOrderStatus.DRAFT,
      subtotal: new Prisma.Decimal(0),
      discountTotal: new Prisma.Decimal(0),
      taxTotal: new Prisma.Decimal(0),
      grandTotal: new Prisma.Decimal(0),
      notes: input.notes,
    },
  });

  await logAuditEvent({
    actorUserId: input.actorUserId,
    branchId: input.branchId,
    module: "sales",
    action: SALE_AUDIT_EVENTS.ORDER_CREATED,
    entityType: "SaleOrder",
    entityId: order.id,
  });

  return order;
}

async function recalcOrderTotalsTx(tx: Prisma.TransactionClient, saleOrderId: string) {
  const order = await tx.saleOrder.findUniqueOrThrow({ where: { id: saleOrderId }, select: { transportAmount: true } });
  const lines = await tx.saleOrderLine.findMany({ where: { saleOrderId } });
  const totals = aggregateOrderTotals(
    lines.map((line) => ({ lineSubtotal: line.lineSubtotal, discountAmount: line.discountAmount })),
    order.transportAmount,
  );

  return tx.saleOrder.update({
    where: { id: saleOrderId },
    data: totals,
  });
}

export async function addSaleOrderLine(input: {
  saleOrderId: string;
  productId: string;
  quantity: number;
  unitPrice?: number;
  discountAmount: number;
  actorUserId: string;
}) {
  return prisma.$transaction(async (tx) => {
    const order = await tx.saleOrder.findUniqueOrThrow({ where: { id: input.saleOrderId } });
    if (order.status !== SaleOrderStatus.DRAFT) throw new Error("ORDER_NOT_DRAFT");

    const product = await tx.product.findUniqueOrThrow({ where: { id: input.productId } });
    if (!product.isActive) throw new Error("PRODUCT_INACTIVE");

    const quantity = new Prisma.Decimal(input.quantity);
    const unitPrice = new Prisma.Decimal(input.unitPrice ?? product.standardSalePrice);
    const discountAmount = new Prisma.Decimal(input.discountAmount);
    const lineSubtotal = calculateLineSubtotal(quantity, unitPrice, discountAmount);

    const line = await tx.saleOrderLine.create({
      data: {
        saleOrderId: input.saleOrderId,
        productId: input.productId,
        quantity,
        unitPrice,
        discountAmount,
        lineSubtotal,
      },
    });

    const orderUpdated = await recalcOrderTotalsTx(tx, input.saleOrderId);

    await tx.auditLog.create({
      data: {
        actorUserId: input.actorUserId,
        branchId: order.branchId,
        module: "sales",
        action: SALE_AUDIT_EVENTS.ORDER_LINE_ADDED,
        entityType: "SaleOrderLine",
        entityId: line.id,
      },
    });

    return { line, order: orderUpdated };
  });
}

export async function updateSaleOrderLine(input: {
  saleOrderId: string;
  lineId: string;
  quantity?: number;
  unitPrice?: number;
  discountAmount?: number;
  actorUserId: string;
}) {
  return prisma.$transaction(async (tx) => {
    const order = await tx.saleOrder.findUniqueOrThrow({ where: { id: input.saleOrderId } });
    if (order.status !== SaleOrderStatus.DRAFT) throw new Error("ORDER_NOT_DRAFT");

    const existing = await tx.saleOrderLine.findUniqueOrThrow({ where: { id: input.lineId } });
    const quantity = new Prisma.Decimal(input.quantity ?? existing.quantity);
    const unitPrice = new Prisma.Decimal(input.unitPrice ?? existing.unitPrice);
    const discountAmount = new Prisma.Decimal(input.discountAmount ?? existing.discountAmount);

    const lineSubtotal = calculateLineSubtotal(quantity, unitPrice, discountAmount);

    const updated = await tx.saleOrderLine.update({
      where: { id: input.lineId },
      data: { quantity, unitPrice, discountAmount, lineSubtotal },
    });

    const orderUpdated = await recalcOrderTotalsTx(tx, input.saleOrderId);

    await tx.auditLog.create({
      data: {
        actorUserId: input.actorUserId,
        branchId: order.branchId,
        module: "sales",
        action: SALE_AUDIT_EVENTS.ORDER_LINE_UPDATED,
        entityType: "SaleOrderLine",
        entityId: updated.id,
        metadataJson: {
          quantity: updated.quantity.toString(),
          unitPrice: updated.unitPrice.toString(),
          discountAmount: updated.discountAmount.toString(),
        },
      },
    });

    return { line: updated, order: orderUpdated };
  });
}

export async function removeSaleOrderLine(input: { saleOrderId: string; lineId: string; actorUserId: string }) {
  return prisma.$transaction(async (tx) => {
    const order = await tx.saleOrder.findUniqueOrThrow({ where: { id: input.saleOrderId } });
    if (order.status !== SaleOrderStatus.DRAFT) throw new Error("ORDER_NOT_DRAFT");

    await tx.saleOrderLine.delete({ where: { id: input.lineId } });
    const orderUpdated = await recalcOrderTotalsTx(tx, input.saleOrderId);

    await tx.auditLog.create({
      data: {
        actorUserId: input.actorUserId,
        branchId: order.branchId,
        module: "sales",
        action: SALE_AUDIT_EVENTS.ORDER_LINE_REMOVED,
        entityType: "SaleOrderLine",
        entityId: input.lineId,
      },
    });

    return orderUpdated;
  });
}

export async function submitSaleOrderToPendingPayment(input: {
  saleOrderId: string;
  actorUserId: string;
  requiresTransport?: boolean;
  transportAmount?: number;
}) {
  return prisma.$transaction(async (tx) => {
    const order = await tx.saleOrder.findUniqueOrThrow({ where: { id: input.saleOrderId } });
    if (order.status !== SaleOrderStatus.DRAFT) {
      await tx.auditLog.create({
        data: {
          actorUserId: input.actorUserId,
          branchId: order.branchId,
          module: "sales",
          action: SALE_AUDIT_EVENTS.ORDER_SUBMIT_DENIED,
          entityType: "SaleOrder",
          entityId: order.id,
          metadataJson: { reason: "INVALID_TRANSITION", currentStatus: order.status },
        },
      });
      throw new Error("INVALID_TRANSITION");
    }

    const lines = await tx.saleOrderLine.findMany({ where: { saleOrderId: input.saleOrderId } });
    if (lines.length === 0) {
      await tx.auditLog.create({
        data: {
          actorUserId: input.actorUserId,
          branchId: order.branchId,
          module: "sales",
          action: SALE_AUDIT_EVENTS.ORDER_SUBMIT_DENIED,
          entityType: "SaleOrder",
          entityId: order.id,
          metadataJson: { reason: "ORDER_EMPTY" },
        },
      });
      throw new Error("ORDER_EMPTY");
    }

    for (const line of lines) {
      const balance = await tx.inventoryBalance.findUnique({ where: { branchId_productId: { branchId: order.branchId, productId: line.productId } } });
      const available = balance?.quantityOnHand ?? new Prisma.Decimal(0);
      if (available.lt(line.quantity)) {
        await tx.auditLog.create({
          data: {
            actorUserId: input.actorUserId,
            branchId: order.branchId,
            module: "sales",
            action: SALE_AUDIT_EVENTS.ORDER_SUBMIT_DENIED,
            entityType: "SaleOrder",
            entityId: order.id,
            metadataJson: { reason: "INSUFFICIENT_STOCK", productId: line.productId },
          },
        });
        throw new Error("INSUFFICIENT_STOCK");
      }
    }

    const transportAmt = input.requiresTransport && typeof input.transportAmount === "number" && input.transportAmount > 0
      ? new Prisma.Decimal(input.transportAmount)
      : new Prisma.Decimal(0);
    const totals = aggregateOrderTotals(
      lines.map((line) => ({ lineSubtotal: line.lineSubtotal, discountAmount: line.discountAmount })),
      transportAmt,
    );
    const updated = await tx.saleOrder.update({
      where: { id: input.saleOrderId },
      data: {
        ...totals,
        ...(typeof input.requiresTransport === "boolean" ? { requiresTransport: input.requiresTransport } : {}),
        transportAmount: transportAmt,
        status: SaleOrderStatus.PENDING_PAYMENT,
      },
    });

    await tx.auditLog.create({
      data: {
        actorUserId: input.actorUserId,
        branchId: order.branchId,
        module: "sales",
        action: SALE_AUDIT_EVENTS.ORDER_SUBMITTED_PENDING_PAYMENT,
        entityType: "SaleOrder",
        entityId: order.id,
        metadataJson: typeof input.requiresTransport === "boolean"
          ? { requiresTransport: input.requiresTransport }
          : undefined,
      },
    });

    return updated;
  });
}

/**
 * Direct sale: when cashier module is disabled, the seller submits + pays in one step.
 * The system auto-processes payment using the branch's cash session and optionally auto-dispatches.
 */
export async function submitDirectSale(input: {
  saleOrderId: string;
  actorUserId: string;
  method: PaymentMethod;
  requiresTransport?: boolean;
  transportAmount?: number;
  referenceNumber?: string | null;
}) {
  const branchConfig = await getBranchModuleConfig(
    (await prisma.saleOrder.findUniqueOrThrow({ where: { id: input.saleOrderId }, select: { branchId: true } })).branchId,
  );

  // If cashier is enabled, this function should not be used
  if (branchConfig.enableCashier) {
    throw new Error("CASHIER_MODULE_ENABLED");
  }

  return prisma.$transaction(async (tx) => {
    const order = await tx.saleOrder.findUniqueOrThrow({
      where: { id: input.saleOrderId },
      include: { lines: true, payments: true },
    });

    if (order.status !== SaleOrderStatus.DRAFT) throw new Error("ORDER_NOT_DRAFT");
    if (order.lines.length === 0) throw new Error("ORDER_EMPTY");

    // Verify stock
    for (const line of order.lines) {
      const balance = await tx.inventoryBalance.findUnique({
        where: { branchId_productId: { branchId: order.branchId, productId: line.productId } },
      });
      const available = balance?.quantityOnHand ?? new Prisma.Decimal(0);
      if (available.lt(line.quantity)) throw new Error("INSUFFICIENT_STOCK");
    }

    // Calculate totals
    const transportAmt = input.requiresTransport && typeof input.transportAmount === "number" && input.transportAmount > 0
      ? new Prisma.Decimal(input.transportAmount)
      : new Prisma.Decimal(0);
    const totals = aggregateOrderTotals(
      order.lines.map((line: any) => ({ lineSubtotal: line.lineSubtotal, discountAmount: line.discountAmount })),
      transportAmt,
    );
    const grandTotal = totals.grandTotal;

    // Find cash session
    const cashBox = await tx.physicalCashBox.findFirst({
      where: { branchId: order.branchId, isActive: true },
      orderBy: { createdAt: "asc" },
    });
    if (!cashBox) throw new Error("NO_ACTIVE_CASH_BOX");

    const session = await tx.cashSession.findFirst({
      where: { physicalCashBoxId: cashBox.id, status: CashSessionStatus.OPEN, activeSessionKey: { not: null } },
      orderBy: { openedAt: "desc" },
    });
    if (!session) throw new Error("NO_ACTIVE_CASH_SESSION");

    // Deduct inventory
    for (const line of order.lines) {
      const balance = await tx.inventoryBalance.findUnique({
        where: { branchId_productId: { branchId: order.branchId, productId: line.productId } },
      });
      const currentWac = balance?.weightedAverageCost ?? new Prisma.Decimal(0);
      await createInventoryMovementTx(tx, {
        actorUserId: input.actorUserId,
        branchId: order.branchId,
        productId: line.productId,
        movementType: InventoryMovementType.SALE_OUT,
        quantity: Number(line.quantity),
        unitCost: Number(currentWac),
        referenceType: "DIRECT_SALE",
        referenceId: order.id,
        notes: `Venta directa orden ${order.orderNumber}`,
      });
    }

    const now = new Date();
    const finalStatus = branchConfig.enableDispatch ? SaleOrderStatus.DISPATCH_PENDING : SaleOrderStatus.DISPATCHED;

    // Update order
    const updatedOrder = await tx.saleOrder.update({
      where: { id: order.id },
      data: {
        ...totals,
        ...(typeof input.requiresTransport === "boolean" ? { requiresTransport: input.requiresTransport } : {}),
        transportAmount: transportAmt,
        status: finalStatus,
      },
    });

    // Create payment
    await tx.payment.create({
      data: {
        saleOrderId: order.id,
        cashSessionId: session.id,
        receivedByUserId: input.actorUserId,
        method: input.method,
        status: PaymentStatus.POSTED,
        amount: grandTotal,
        referenceNumber: input.referenceNumber ?? null,
        paidAt: now,
        createdAt: now,
      },
    });

    // Auto-dispatch if dispatch module is also disabled
    if (!branchConfig.enableDispatch) {
      await tx.dispatchTicket.create({
        data: {
          saleOrderId: order.id,
          branchId: order.branchId,
          status: DispatchStatus.DISPATCHED,
          preparedByUserId: input.actorUserId,
          dispatchedByUserId: input.actorUserId,
          dispatchedAt: now,
          notes: "Venta directa - despacho automatico",
        },
      });
    }

    await tx.auditLog.create({
      data: {
        actorUserId: input.actorUserId,
        branchId: order.branchId,
        module: "sales",
        action: "DIRECT_SALE_COMPLETED",
        entityType: "SaleOrder",
        entityId: order.id,
        metadataJson: {
          method: input.method,
          amount: grandTotal.toString(),
          autoDispatched: !branchConfig.enableDispatch,
        },
      },
    });

    return updatedOrder;
  });
}
