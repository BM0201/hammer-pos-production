import { TransportServiceStatus } from "@prisma/client";
import { prisma } from "@/lib/prisma";

export async function createTransportService(input: {
  saleOrderId: string;
  branchId: string;
  customerName: string;
  reference?: string | null;
  price: number;
  scheduledPaymentTime?: Date | null;
  notes?: string | null;
  createdByUserId: string;
}) {
  const transport = await prisma.transportService.create({
    data: {
      saleOrderId: input.saleOrderId,
      branchId: input.branchId,
      customerName: input.customerName,
      reference: input.reference ?? null,
      price: input.price,
      scheduledPaymentTime: input.scheduledPaymentTime ?? null,
      notes: input.notes ?? null,
      status: TransportServiceStatus.PENDING,
      createdByUserId: input.createdByUserId,
    },
  });

  await prisma.auditLog.create({
    data: {
      actorUserId: input.createdByUserId,
      branchId: input.branchId,
      module: "transport",
      action: "TRANSPORT_SERVICE_CREATED",
      entityType: "TransportService",
      entityId: transport.id,
      metadataJson: {
        saleOrderId: input.saleOrderId,
        customerName: input.customerName,
        price: input.price,
      },
    },
  });

  return transport;
}

export async function listTransportServices(params: {
  branchIds: string[];
  status?: TransportServiceStatus[];
}) {
  return prisma.transportService.findMany({
    where: {
      branchId: { in: params.branchIds },
      ...(params.status ? { status: { in: params.status } } : {}),
    },
    include: {
      saleOrder: { select: { orderNumber: true, grandTotal: true, status: true } },
    },
    orderBy: { createdAt: "asc" },
    take: 100,
  });
}

export async function updateTransportStatus(input: {
  transportId: string;
  status: TransportServiceStatus;
  actorUserId: string;
}) {
  const transport = await prisma.transportService.update({
    where: { id: input.transportId },
    data: {
      status: input.status,
      ...(input.status === TransportServiceStatus.DELIVERED ? { deliveredAt: new Date() } : {}),
    },
  });

  await prisma.auditLog.create({
    data: {
      actorUserId: input.actorUserId,
      branchId: transport.branchId,
      module: "transport",
      action: "TRANSPORT_STATUS_UPDATED",
      entityType: "TransportService",
      entityId: transport.id,
      metadataJson: {
        newStatus: input.status,
        saleOrderId: transport.saleOrderId,
      },
    },
  });

  return transport;
}

export async function countPendingTransports(branchIds: string[]) {
  return prisma.transportService.count({
    where: {
      branchId: { in: branchIds },
      status: { in: [TransportServiceStatus.PENDING, TransportServiceStatus.IN_TRANSIT] },
    },
  });
}

export async function listPendingTransports(branchIds: string[]) {
  return prisma.transportService.findMany({
    where: {
      branchId: { in: branchIds },
      status: { in: [TransportServiceStatus.PENDING, TransportServiceStatus.IN_TRANSIT] },
    },
    include: {
      saleOrder: { select: { orderNumber: true, grandTotal: true } },
    },
    orderBy: { createdAt: "asc" },
    take: 50,
  });
}
