import { DispatchStatus, SaleOrderStatus } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { logAuditEvent } from "@/modules/audit/service";
import { DISPATCH_AUDIT_EVENTS } from "@/modules/dispatch/audit-events";
import { assertOrderNotVoidedOrTest } from "@/modules/sales/helpers/order-guards";

export async function listDispatchPendingOrders(params: { branchId: string; includeAllBranches: boolean }) {
  return prisma.saleOrder.findMany({
    where: {
      status: SaleOrderStatus.DISPATCH_PENDING,
      ...(params.includeAllBranches ? {} : { branchId: params.branchId }),
    },
    include: {
      branch: true,
      dispatchTickets: {
        orderBy: { createdAt: "desc" },
        take: 1,
      },
      transportServices: {
        orderBy: { createdAt: "desc" },
        take: 1,
      },
    },
    orderBy: { createdAt: "asc" },
    take: 100,
  });
}

export async function listDispatchHistory(params: { branchId: string; includeAllBranches: boolean }) {
  return prisma.dispatchTicket.findMany({
    where: {
      status: DispatchStatus.DISPATCHED,
      ...(params.includeAllBranches ? {} : { branchId: params.branchId }),
    },
    include: {
      saleOrder: {
        include: {
          transportServices: {
            orderBy: { createdAt: "desc" },
            take: 1,
          },
        },
      },
      branch: true,
      processedBy: { select: { id: true, username: true, fullName: true } },
    },
    orderBy: { dispatchedAt: "desc" },
    take: 100,
  });
}

export async function markOrderDispatched(input: { orderId: string; actorUserId: string; notes?: string | null }) {
  return prisma.$transaction(async (tx) => {
    const order = await tx.saleOrder.findUniqueOrThrow({
      where: { id: input.orderId },
      include: { dispatchTickets: { where: { status: DispatchStatus.DISPATCHED }, take: 1 } },
    });

    if (order.dispatchTickets.length > 0) {
      throw new Error("DISPATCH_ALREADY_COMPLETED");
    }

    // Una orden anulada o de prueba no debe poder despacharse.
    assertOrderNotVoidedOrTest(order);

    const transition = await tx.saleOrder.updateMany({
      where: {
        id: input.orderId,
        status: SaleOrderStatus.DISPATCH_PENDING,
      },
      data: {
        status: SaleOrderStatus.DISPATCHED,
      },
    });

    if (transition.count !== 1) {
      throw new Error("DISPATCH_INVALID_STATUS");
    }

    const ticket = await tx.dispatchTicket.create({
      data: {
        saleOrderId: order.id,
        branchId: order.branchId,
        status: DispatchStatus.DISPATCHED,
        preparedByUserId: input.actorUserId,
        dispatchedByUserId: input.actorUserId,
        dispatchedAt: new Date(),
        notes: input.notes ?? null,
      },
    });

    const updatedOrder = await tx.saleOrder.findUniqueOrThrow({ where: { id: order.id } });

    await tx.auditLog.create({
      data: {
        actorUserId: input.actorUserId,
        branchId: order.branchId,
        module: "dispatch",
        action: DISPATCH_AUDIT_EVENTS.DISPATCHED,
        entityType: "SaleOrder",
        entityId: order.id,
        metadataJson: {
          dispatchTicketId: ticket.id,
          previousStatus: SaleOrderStatus.DISPATCH_PENDING,
          newStatus: updatedOrder.status,
        },
      },
    });

    return { order: updatedOrder, dispatchTicket: ticket };
  });
}

export async function logDispatchDenied(input: {
  actorUserId?: string;
  branchId?: string;
  entityId: string;
  reason: string;
  metadata?: Record<string, unknown>;
}) {
  await logAuditEvent({
    actorUserId: input.actorUserId,
    branchId: input.branchId,
    module: "dispatch",
    action: DISPATCH_AUDIT_EVENTS.DISPATCH_DENIED,
    entityType: "SaleOrder",
    entityId: input.entityId,
    metadataJson: {
      reason: input.reason,
      ...(input.metadata ?? {}),
    },
  });
}
