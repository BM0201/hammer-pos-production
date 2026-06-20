import { Prisma, TransportServiceStatus, type SaleOrder, type Customer } from "@prisma/client";
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
  const saleOrder = await prisma.saleOrder.findUniqueOrThrow({
    where: { id: input.saleOrderId },
    select: { id: true, branchId: true },
  });

  if (saleOrder.branchId !== input.branchId) {
    throw new Error("FORBIDDEN_BRANCH");
  }

  const transport = await prisma.transportService.create({
    data: {
      saleOrderId: input.saleOrderId,
      branchId: input.branchId,
      customerName: input.customerName,
      reference: input.reference ?? null,
      price: new Prisma.Decimal(input.price),
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
  branchIds?: string[];
  status?: TransportServiceStatus[];
}) {
  return prisma.transportService.findMany({
    where: {
      ...(params.branchIds && params.branchIds.length > 0 ? { branchId: { in: params.branchIds } } : {}),
      ...(params.status ? { status: { in: params.status } } : {}),
    },
    include: {
      saleOrder: { select: { orderNumber: true, grandTotal: true, status: true } },
    },
    orderBy: { createdAt: "asc" },
    take: 100,
  });
}

export async function getTransportServiceById(transportId: string) {
  return prisma.transportService.findUniqueOrThrow({
    where: { id: transportId },
    select: { id: true, branchId: true, saleOrderId: true, status: true },
  });
}

export async function updateTransportStatus(input: {
  transportId: string;
  status: TransportServiceStatus;
  actorUserId: string;
}) {
  const existing = await prisma.transportService.findUniqueOrThrow({
    where: { id: input.transportId },
    select: { id: true, status: true, branchId: true, saleOrderId: true },
  });

  const previousStatus = existing.status;

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
        previousStatus,
        newStatus: input.status,
        saleOrderId: transport.saleOrderId,
      },
    },
  });

  return transport;
}

/**
 * Idempotent transport creation within a transaction.
 * If a TransportService already exists for the order, returns it without duplicating.
 * If requiresTransport=false, does nothing.
 * If requiresTransport=true and transportAmount <= 0, throws error.
 */
export async function ensureTransportServiceForOrderTx(
  tx: Prisma.TransactionClient,
  input: {
    saleOrderId: string;
    branchId: string;
    createdByUserId: string;
    customerName: string;
    price: number;
    reference?: string | null;
    notes?: string | null;
  },
): Promise<{ created: boolean; transport: { id: string; saleOrderId: string; status: TransportServiceStatus } | null }> {
  // Check if already exists (idempotent)
  const existing = await tx.transportService.findFirst({
    where: { saleOrderId: input.saleOrderId },
    select: { id: true, saleOrderId: true, status: true },
  });

  if (existing) {
    return { created: false, transport: existing };
  }

  if (input.price <= 0) {
    throw new Error("TRANSPORT_REQUIRED_BUT_MISSING");
  }

  const transport = await tx.transportService.create({
    data: {
      saleOrderId: input.saleOrderId,
      branchId: input.branchId,
      customerName: input.customerName,
      reference: input.reference ?? null,
      price: new Prisma.Decimal(input.price),
      status: TransportServiceStatus.PENDING,
      notes: input.notes ?? null,
      createdByUserId: input.createdByUserId,
    },
  });

  await tx.auditLog.create({
    data: {
      actorUserId: input.createdByUserId,
      branchId: input.branchId,
      module: "transport",
      action: "TRANSPORT_SERVICE_AUTO_CREATED",
      entityType: "TransportService",
      entityId: transport.id,
      metadataJson: {
        saleOrderId: input.saleOrderId,
        customerName: input.customerName,
        price: input.price,
        source: "automatic",
      },
    },
  });

  return { created: true, transport: { id: transport.id, saleOrderId: transport.saleOrderId, status: transport.status } };
}

/**
 * Resolve the customer name for transport creation.
 */
export function resolveTransportCustomerName(customer: { displayName?: string | null; legalName?: string | null } | null): string {
  if (customer) {
    return customer.displayName || customer.legalName || "Cliente sin registrar";
  }
  return "Cliente sin registrar";
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
