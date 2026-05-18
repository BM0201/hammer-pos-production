import {
  CashSessionStatus,
  DispatchStatus,
  InventoryMovementType,
  PaymentMethod,
  PaymentStatus,
  Prisma,
  RoleCode,
  SaleOrderStatus,
} from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { createInventoryMovementTx } from "@/modules/inventory/service";
import { PAYMENT_AUDIT_EVENTS } from "@/modules/payments/audit-events";
import { getTodayClosure, recordEmergencySale } from "@/modules/cash-closure/service";
import { getBranchModuleConfig } from "@/modules/branch-config/service";
import { ensureTransportServiceForOrderTx, resolveTransportCustomerName } from "@/modules/transport/service";

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

async function validateCashSessionForOrderTx(tx: Prisma.TransactionClient, params: {
  cashSessionId: string;
  branchId: string;
  actorUserId: string;
  saleOrderId: string;
}) {
  const actor = await tx.user.findUnique({
    where: { id: params.actorUserId },
    select: {
      globalRole: true,
      userBranchRoles: {
        where: { branchId: params.branchId, isActive: true },
        select: { id: true },
      },
    },
  });

  const isGlobalAllowed = actor?.globalRole === RoleCode.MASTER
    || actor?.globalRole === RoleCode.SYSTEM_ADMIN
    || actor?.globalRole === RoleCode.OWNER;

  if (!actor || (!isGlobalAllowed && actor.userBranchRoles.length === 0)) {
    await tx.auditLog.create({
      data: {
        actorUserId: params.actorUserId,
        branchId: params.branchId,
        module: "payments",
        action: PAYMENT_AUDIT_EVENTS.PAYMENT_DENIED,
        entityType: "SaleOrder",
        entityId: params.saleOrderId,
        metadataJson: { reason: "FORBIDDEN_BRANCH" },
      },
    });
    throw new Error("FORBIDDEN_BRANCH");
  }

  await tx.$queryRaw`
    SELECT id
    FROM "CashSession"
    WHERE id = ${params.cashSessionId}
    FOR UPDATE
  `;

  const session = await tx.cashSession.findUnique({
    where: { id: params.cashSessionId },
    include: { physicalCashBox: true },
  });

  if (!session) {
    await tx.auditLog.create({
      data: {
        actorUserId: params.actorUserId,
        branchId: params.branchId,
        module: "payments",
        action: PAYMENT_AUDIT_EVENTS.PAYMENT_DENIED,
        entityType: "SaleOrder",
        entityId: params.saleOrderId,
        metadataJson: { reason: "INVALID_CASH_SESSION", cashSessionId: params.cashSessionId },
      },
    });
    throw new Error("INVALID_CASH_SESSION");
  }

  if (session.status !== CashSessionStatus.OPEN || !session.activeSessionKey) {
    await tx.auditLog.create({
      data: {
        actorUserId: params.actorUserId,
        branchId: params.branchId,
        module: "payments",
        action: PAYMENT_AUDIT_EVENTS.PAYMENT_DENIED,
        entityType: "SaleOrder",
        entityId: params.saleOrderId,
        metadataJson: {
          reason: "CASH_SESSION_NOT_OPEN",
          cashSessionId: session.id,
          status: session.status,
          hasActiveSessionKey: Boolean(session.activeSessionKey),
        },
      },
    });
    throw new Error("CASH_SESSION_NOT_OPEN");
  }

  if (!session.physicalCashBox?.isActive) {
    await tx.auditLog.create({
      data: {
        actorUserId: params.actorUserId,
        branchId: params.branchId,
        module: "payments",
        action: PAYMENT_AUDIT_EVENTS.PAYMENT_DENIED,
        entityType: "SaleOrder",
        entityId: params.saleOrderId,
        metadataJson: {
          reason: "CASH_BOX_INACTIVE",
          cashSessionId: session.id,
          physicalCashBoxId: session.physicalCashBoxId,
        },
      },
    });
    throw new Error("CASH_BOX_INACTIVE");
  }

  if (session.physicalCashBox.branchId !== params.branchId) {
    await tx.auditLog.create({
      data: {
        actorUserId: params.actorUserId,
        branchId: params.branchId,
        module: "payments",
        action: PAYMENT_AUDIT_EVENTS.PAYMENT_DENIED,
        entityType: "SaleOrder",
        entityId: params.saleOrderId,
        metadataJson: {
          reason: "CASH_BOX_BRANCH_MISMATCH",
          cashSessionId: session.id,
          cashBoxBranchId: session.physicalCashBox.branchId,
        },
      },
    });
    throw new Error("CASH_BOX_BRANCH_MISMATCH");
  }

  return session;
}

export async function postSaleOrderPayment(input: {
  saleOrderId: string;
  cashSessionId: string;
  amount: number;
  method: PaymentMethod;
  actorUserId: string;
  referenceNumber?: string | null;
}) {
  try {
    return await prisma.$transaction(async (tx) => {
      await tx.$queryRaw`
        SELECT id
        FROM "SaleOrder"
        WHERE id = ${input.saleOrderId}
        FOR UPDATE
      `;

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
            metadataJson: { reason: "PAYMENT_INVALID_STATUS", currentStatus: order.status },
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

      const session = await validateCashSessionForOrderTx(tx, {
        cashSessionId: input.cashSessionId,
        branchId: order.branchId,
        actorUserId: input.actorUserId,
        saleOrderId: order.id,
      });

      const uniqueProductIds = [...new Set(order.lines.map((line) => line.productId))].sort();

      for (const productId of uniqueProductIds) {
        await tx.$queryRaw`
          SELECT id
          FROM "InventoryBalance"
          WHERE "branchId" = ${order.branchId}
            AND "productId" = ${productId}
          FOR UPDATE
        `;
      }

      const balances = await tx.inventoryBalance.findMany({
        where: { branchId: order.branchId, productId: { in: uniqueProductIds } },
      });
      const balanceByProductId = new Map(balances.map((balance) => [balance.productId, balance]));

      for (const line of order.lines) {
        const balance = balanceByProductId.get(line.productId);
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
      }

      const inventoryDeductions: string[] = [];
      try {
        for (const line of order.lines) {
          const balance = balanceByProductId.get(line.productId);
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

      let payment;
      try {
        payment = await tx.payment.create({
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
      } catch (error) {
        if (
          error instanceof Prisma.PrismaClientKnownRequestError
          && error.code === "P2002"
        ) {
          await tx.auditLog.create({
            data: {
              actorUserId: input.actorUserId,
              branchId: order.branchId,
              module: "payments",
              action: PAYMENT_AUDIT_EVENTS.PAYMENT_DENIED,
              entityType: "SaleOrder",
              entityId: order.id,
              metadataJson: { reason: "PAYMENT_ALREADY_POSTED", source: "DB_CONSTRAINT" },
            },
          });
          throw new Error("PAYMENT_ALREADY_POSTED");
        }
        throw error;
      }

      const branchConfig = await getBranchModuleConfig(order.branchId);
      const nextStatus = branchConfig.enableDispatch
        ? SaleOrderStatus.DISPATCH_PENDING
        : SaleOrderStatus.DISPATCHED;

      const updatedOrder = await tx.saleOrder.update({
        where: { id: order.id },
        data: { status: nextStatus },
      });

      await tx.auditLog.create({
        data: {
          actorUserId: input.actorUserId,
          branchId: order.branchId,
          module: "payments",
          action: PAYMENT_AUDIT_EVENTS.ORDER_STATUS_CHANGED,
          entityType: "SaleOrder",
          entityId: order.id,
          metadataJson: {
            previousStatus: order.status,
            currentStatus: updatedOrder.status,
          },
        },
      });

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

      // Auto-create transport if requiresTransport=true
      if (order.requiresTransport && Number(order.transportAmount) > 0) {
        const orderWithCustomer = await tx.saleOrder.findUniqueOrThrow({
          where: { id: order.id },
          include: { customer: { select: { displayName: true, legalName: true } } },
        });
        await ensureTransportServiceForOrderTx(tx, {
          saleOrderId: order.id,
          branchId: order.branchId,
          createdByUserId: input.actorUserId,
          customerName: resolveTransportCustomerName(orderWithCustomer.customer),
          price: Number(order.transportAmount),
          reference: order.orderNumber,
          notes: "Transporte creado automaticamente al registrar pago",
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

      try {
        const { closure } = await getTodayClosure(order.branchId);
        if (closure?.isReopened && !closure.isPermanentlyClosed) {
          await recordEmergencySale(order.branchId, order.id, input.actorUserId);
        }
      } catch {
        // Non-blocking
      }

      return { payment, order: updatedOrder, inventoryMovementIds: inventoryDeductions };
    });
  } catch (error) {
    if (
      error instanceof Prisma.PrismaClientKnownRequestError
      && error.code === "P2002"
    ) {
      throw new Error("PAYMENT_ALREADY_POSTED");
    }
    throw error;
  }
}
