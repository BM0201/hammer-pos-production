import { CashSessionStatus, DispatchStatus, InventoryMovementType, PaymentMethod, PaymentStatus, Prisma, SaleOrderStatus } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { createInventoryMovementTx } from "@/modules/inventory/service";
import { PAYMENT_AUDIT_EVENTS } from "@/modules/payments/audit-events";
import { getTodayClosure, recordEmergencySale } from "@/modules/cash-closure/service";
import { getBranchModuleConfig } from "@/modules/branch-config/service";

export async function listPendingPaymentOrders(params: { branchId: string; includeAllBranches: boolean }) {
  return prisma.saleOrder.findMany({
    where: {
      status: SaleOrderStatus.PENDING_PAYMENT,
      ...(params.includeAllBranches ? {} : { branchId: params.branchId }),
    },
    select: {
      id: true,
      orderNumber: true,
      status: true,
      subtotal: true,
      grandTotal: true,
      transportAmount: true,
      requiresTransport: true,
      branchId: true,
      createdAt: true,
      lines: {
        select: {
          id: true,
          productId: true,
          quantity: true,
          unitPrice: true,
          discountAmount: true,
          lineSubtotal: true,
          product: { select: { name: true, sku: true } },
        },
      },
    },
    orderBy: { createdAt: "asc" },
    take: 50,
  });
}

function toNumber(decimalLike: Prisma.Decimal | number | string): number {
  if (decimalLike instanceof Prisma.Decimal) return Number(decimalLike.toString());
  return Number(decimalLike);
}

export async function postSaleOrderPayment(input: {
  saleOrderId: string;
  amount: number;
  method: PaymentMethod;
  actorUserId: string;
  referenceNumber?: string | null;
}) {
  return prisma.$transaction(async (tx) => {
    const order = await tx.saleOrder.findUniqueOrThrow({
      where: { id: input.saleOrderId },
      include: { lines: true, payments: true },
    });

    if (order.status !== SaleOrderStatus.PENDING_PAYMENT) {
      await tx.auditLog.create({
        data: {
          actorUserId: input.actorUserId,
          branchId: order.branchId,
          module: "payments",
          action: PAYMENT_AUDIT_EVENTS.PAYMENT_DENIED,
          entityType: "SaleOrder",
          entityId: order.id,
          metadataJson: { reason: "INVALID_STATUS", currentStatus: order.status },
        },
      });
      throw new Error("PAYMENT_INVALID_STATUS");
    }

    const existingPayment = order.payments.find((payment) => payment.status === PaymentStatus.POSTED);
    if (existingPayment) {
      await tx.auditLog.create({
        data: {
          actorUserId: input.actorUserId,
          branchId: order.branchId,
          module: "payments",
          action: PAYMENT_AUDIT_EVENTS.PAYMENT_DENIED,
          entityType: "SaleOrder",
          entityId: order.id,
          metadataJson: { reason: "PAYMENT_ALREADY_POSTED", paymentId: existingPayment.id },
        },
      });
      throw new Error("PAYMENT_ALREADY_POSTED");
    }

    const orderTotal = new Prisma.Decimal(order.grandTotal);
    const requestedAmount = new Prisma.Decimal(input.amount);
    if (!requestedAmount.eq(orderTotal)) {
      await tx.auditLog.create({
        data: {
          actorUserId: input.actorUserId,
          branchId: order.branchId,
          module: "payments",
          action: PAYMENT_AUDIT_EVENTS.PAYMENT_DENIED,
          entityType: "SaleOrder",
          entityId: order.id,
          metadataJson: {
            reason: "INVALID_PAYMENT_AMOUNT",
            orderTotal: orderTotal.toString(),
            requestedAmount: requestedAmount.toString(),
          },
        },
      });
      throw new Error("INVALID_PAYMENT_AMOUNT");
    }

    const cashBox = await tx.physicalCashBox.findFirst({
      where: { branchId: order.branchId, isActive: true },
      orderBy: { createdAt: "asc" },
    });

    if (!cashBox) {
      await tx.auditLog.create({
        data: {
          actorUserId: input.actorUserId,
          branchId: order.branchId,
          module: "payments",
          action: PAYMENT_AUDIT_EVENTS.PAYMENT_DENIED,
          entityType: "SaleOrder",
          entityId: order.id,
          metadataJson: { reason: "NO_ACTIVE_CASH_BOX" },
        },
      });
      throw new Error("NO_ACTIVE_CASH_BOX");
    }

    const session = await tx.cashSession.findFirst({
      where: {
        physicalCashBoxId: cashBox.id,
        status: CashSessionStatus.OPEN,
        activeSessionKey: { not: null },
      },
      orderBy: { openedAt: "desc" },
    });

    if (!session) {
      await tx.auditLog.create({
        data: {
          actorUserId: input.actorUserId,
          branchId: order.branchId,
          module: "payments",
          action: PAYMENT_AUDIT_EVENTS.PAYMENT_DENIED,
          entityType: "SaleOrder",
          entityId: order.id,
          metadataJson: { reason: "NO_ACTIVE_CASH_SESSION", cashBoxId: cashBox.id },
        },
      });
      throw new Error("NO_ACTIVE_CASH_SESSION");
    }

    const inventoryDeductions: string[] = [];
    try {
      // FIX BUG-006: Re-verify stock atomically within the payment transaction
      // to prevent race conditions where stock is depleted between submission and payment
      for (const line of order.lines) {
        const balance = await tx.inventoryBalance.findUnique({
          where: {
            branchId_productId: {
              branchId: order.branchId,
              productId: line.productId,
            },
          },
        });

        const available = balance?.quantityOnHand ?? new Prisma.Decimal(0);
        if (available.lt(line.quantity)) {
          await tx.auditLog.create({
            data: {
              actorUserId: input.actorUserId,
              branchId: order.branchId,
              module: "payments",
              action: PAYMENT_AUDIT_EVENTS.PAYMENT_DENIED,
              entityType: "SaleOrder",
              entityId: order.id,
              metadataJson: {
                reason: "INSUFFICIENT_STOCK_AT_PAYMENT",
                productId: line.productId,
                available: available.toString(),
                requested: line.quantity.toString(),
              },
            },
          });
          throw new Error("INSUFFICIENT_STOCK_AT_PAYMENT");
        }

        const currentWac = balance?.weightedAverageCost ?? new Prisma.Decimal(0);

        const movementResult = await createInventoryMovementTx(tx, {
          actorUserId: input.actorUserId,
          branchId: order.branchId,
          productId: line.productId,
          movementType: InventoryMovementType.SALE_OUT,
          quantity: toNumber(line.quantity),
          unitCost: toNumber(currentWac),
          referenceType: "SALE_PAYMENT",
          referenceId: order.id,
          notes: `Sale payment deduction for order ${order.orderNumber}`,
        });

        inventoryDeductions.push(movementResult.movement.id);
      }
    } catch (error) {
      await tx.auditLog.create({
        data: {
          actorUserId: input.actorUserId,
          branchId: order.branchId,
          module: "payments",
          action: PAYMENT_AUDIT_EVENTS.PAYMENT_INVENTORY_DEDUCTION_FAILED,
          entityType: "SaleOrder",
          entityId: order.id,
          metadataJson: {
            reason: error instanceof Error ? error.message : "UNKNOWN_ERROR",
          },
        },
      });
      throw error;
    }

    await tx.auditLog.create({
      data: {
        actorUserId: input.actorUserId,
        branchId: order.branchId,
        module: "payments",
        action: PAYMENT_AUDIT_EVENTS.PAYMENT_INVENTORY_DEDUCTION_SUCCESS,
        entityType: "SaleOrder",
        entityId: order.id,
        metadataJson: { movementIds: inventoryDeductions },
      },
    });

    const now = new Date();

    const payment = await tx.payment.create({
      data: {
        saleOrderId: order.id,
        cashSessionId: session.id,
        receivedByUserId: input.actorUserId,
        method: input.method,
        status: PaymentStatus.POSTED,
        amount: requestedAmount,
        referenceNumber: input.referenceNumber ?? null,
        paidAt: now,
        createdAt: now,
      },
    });

    // Adaptive flow: check if dispatch module is enabled for this branch
    const branchConfig = await getBranchModuleConfig(order.branchId);
    const nextStatus = branchConfig.enableDispatch
      ? SaleOrderStatus.DISPATCH_PENDING
      : SaleOrderStatus.DISPATCHED;

    const updatedOrder = await tx.saleOrder.update({
      where: { id: order.id },
      data: { status: nextStatus },
    });

    // If dispatch is disabled, auto-create a dispatch ticket
    if (!branchConfig.enableDispatch) {
      await tx.dispatchTicket.create({
        data: {
          saleOrderId: order.id,
          branchId: order.branchId,
          status: DispatchStatus.DISPATCHED,
          preparedByUserId: input.actorUserId,
          dispatchedByUserId: input.actorUserId,
          dispatchedAt: now,
          notes: "Despacho automatico - modulo desactivado",
        },
      });
    }

    await tx.auditLog.create({
      data: {
        actorUserId: input.actorUserId,
        branchId: order.branchId,
        module: "payments",
        action: PAYMENT_AUDIT_EVENTS.PAYMENT_POSTED,
        entityType: "Payment",
        entityId: payment.id,
        metadataJson: {
          orderId: order.id,
          orderStatus: updatedOrder.status,
          lifecycleTransition: branchConfig.enableDispatch
            ? "PENDING_PAYMENT_TO_DISPATCH_PENDING"
            : "PENDING_PAYMENT_TO_DISPATCHED_AUTO",
          amount: requestedAmount.toString(),
          method: input.method,
          cashSessionId: session.id,
          autoDispatched: !branchConfig.enableDispatch,
        },
      },
    });

    // Track emergency sales after cash closure reopening
    try {
      const { closure } = await getTodayClosure(order.branchId);
      if (closure?.isReopened && !closure.isPermanentlyClosed) {
        await recordEmergencySale(order.branchId, order.id, input.actorUserId);
      }
    } catch {
      // Non-blocking: don't fail payment if emergency sale tracking fails
    }

    return { payment, order: updatedOrder, inventoryMovementIds: inventoryDeductions };
  });
}
