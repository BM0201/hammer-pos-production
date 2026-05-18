import { PurchaseOrderStatus, Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { logAuditEvent } from "@/modules/audit/service";
import { createInventoryMovementTx } from "@/modules/inventory/service";

/* ── Helpers ── */
function generateOrderNumber(): string {
  const ts = Date.now().toString(36).toUpperCase();
  const rand = Math.random().toString(36).substring(2, 6).toUpperCase();
  return `PO-${ts}-${rand}`;
}

/* ── List ── */
export async function listPurchaseOrders(params?: { status?: PurchaseOrderStatus }) {
  return prisma.purchaseOrder.findMany({
    where: params?.status ? { status: params.status } : undefined,
    include: {
      branch: true,
      createdBy: { select: { id: true, username: true, fullName: true } },
      lines: { include: { product: { select: { id: true, sku: true, name: true, unit: true } } } },
    },
    orderBy: { createdAt: "desc" },
  });
}

/* ── Get by ID ── */
export async function getPurchaseOrder(id: string) {
  const po = await prisma.purchaseOrder.findUnique({
    where: { id },
    include: {
      branch: true,
      createdBy: { select: { id: true, username: true, fullName: true } },
      lines: { include: { product: { select: { id: true, sku: true, name: true, unit: true } } } },
    },
  });
  if (!po) throw new Error("NOT_FOUND");
  return po;
}

/* ── Create ── */
type CreatePOInput = {
  userId: string;
  branchId: string;
  supplier?: string;
  notes?: string;
  lines: { productId: string; quantity: number; unitCost: number }[];
};

export async function createPurchaseOrder(input: CreatePOInput) {
  if (!input.lines.length) throw new Error("INVALID_INPUT: Debe agregar al menos una línea");
  if (!input.branchId) throw new Error("INVALID_INPUT: branchId es requerido");
  if (!input.userId) throw new Error("INVALID_INPUT: userId es requerido");

  // Validate each line
  for (const l of input.lines) {
    if (!l.productId) throw new Error("INVALID_INPUT: productId es requerido en cada línea");
    if (typeof l.quantity !== "number" || l.quantity <= 0) throw new Error("INVALID_INPUT: Cantidad debe ser un número positivo");
    if (typeof l.unitCost !== "number" || l.unitCost < 0) throw new Error("INVALID_INPUT: Costo unitario no puede ser negativo");
  }

  const lines = input.lines.map((l) => ({
    productId: l.productId,
    quantity: new Prisma.Decimal(l.quantity),
    unitCost: new Prisma.Decimal(l.unitCost),
    subtotal: new Prisma.Decimal(l.quantity).mul(new Prisma.Decimal(l.unitCost)),
  }));

  const total = lines.reduce((acc, l) => acc.add(l.subtotal), new Prisma.Decimal(0));

  const po = await prisma.purchaseOrder.create({
    data: {
      orderNumber: generateOrderNumber(),
      supplier: input.supplier || null,
      notes: input.notes || null,
      branchId: input.branchId,
      userId: input.userId,
      total,
      lines: {
        create: lines.map((l) => ({
          productId: l.productId,
          quantity: l.quantity,
          unitCost: l.unitCost,
          subtotal: l.subtotal,
        })),
      },
    },
    include: {
      lines: { include: { product: { select: { id: true, sku: true, name: true } } } },
      branch: true,
    },
  });

  await logAuditEvent({
    actorUserId: input.userId,
    branchId: input.branchId,
    module: "purchase-orders",
    action: "PURCHASE_ORDER_CREATED",
    entityType: "PurchaseOrder",
    entityId: po.id,
    metadataJson: { orderNumber: po.orderNumber, total: total.toString(), linesCount: lines.length },
  });

  return po;
}

/* ── Approve (adds to inventory) ── */
export async function approvePurchaseOrder(id: string, userId: string) {
  const po = await prisma.purchaseOrder.findUnique({
    where: { id },
    include: { lines: { include: { product: true } }, branch: true },
  });

  if (!po) throw new Error("NOT_FOUND");
  if (po.status !== "DRAFT") throw new Error("INVALID_INPUT: Solo se pueden aprobar pedidos en estado BORRADOR");

  // Use a transaction: update status + create inventory movements
  const result = await prisma.$transaction(async (tx) => {
    const updated = await tx.purchaseOrder.update({
      where: { id },
      data: { status: "APPROVED" },
    });

    // Add each line to inventory
    for (const line of po.lines) {
      await createInventoryMovementTx(tx, {
        actorUserId: userId,
        branchId: po.branchId,
        productId: line.productId,
        movementType: "PURCHASE_IN",
        quantity: Number(line.quantity),
        unitCost: Number(line.unitCost),
        referenceType: "PurchaseOrder",
        referenceId: po.id,
        notes: `Pedido de compra ${po.orderNumber}`,
      });
    }

    return updated;
  });

  await logAuditEvent({
    actorUserId: userId,
    branchId: po.branchId,
    module: "purchase-orders",
    action: "PURCHASE_ORDER_APPROVED",
    entityType: "PurchaseOrder",
    entityId: po.id,
    metadataJson: {
      orderNumber: po.orderNumber,
      total: po.total.toString(),
      linesCount: po.lines.length,
      branchCode: po.branch.code,
    },
  });

  return result;
}

/* ── Cancel ── */
export async function cancelPurchaseOrder(id: string, userId: string) {
  const po = await prisma.purchaseOrder.findUnique({
    where: { id },
    include: {
      branch: { select: { id: true, code: true, name: true } },
      lines: true,
    },
  });
  if (!po) throw new Error("NOT_FOUND");
  if (po.status !== "DRAFT") throw new Error("INVALID_INPUT: Solo se pueden cancelar pedidos en estado BORRADOR");

  const result = await prisma.purchaseOrder.update({
    where: { id },
    data: { status: "CANCELLED" },
  });

  await logAuditEvent({
    actorUserId: userId,
    branchId: po.branchId,
    module: "purchase-orders",
    action: "PURCHASE_ORDER_CANCELLED",
    entityType: "PurchaseOrder",
    entityId: po.id,
    metadataJson: {
      orderNumber: po.orderNumber,
      branchId: po.branchId,
      branchCode: po.branch.code,
      supplier: po.supplier,
      total: po.total.toString(),
      linesCount: po.lines.length,
      cancelledByUserId: userId,
    },
  });

  return result;
}
