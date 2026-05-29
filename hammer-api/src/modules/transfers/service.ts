import { TransferStatus, Prisma } from "@prisma/client";
import { randomBytes } from "node:crypto";
import { prisma } from "@/lib/prisma";
import { logAuditEvent } from "@/modules/audit/service";
import { createInventoryMovementTx } from "@/modules/inventory/service";

/* ── Helpers ── */
// FIX BUG-011: Use crypto-random bytes instead of Math.random() to prevent collisions
function generateTransferNumber(): string {
  const ts = Date.now().toString(36).toUpperCase();
  const rand = randomBytes(4).toString("hex").toUpperCase();
  return `TR-${ts}-${rand}`;
}

/* ── List ── */
export async function listTransfers(params?: { status?: TransferStatus }) {
  return prisma.transfer.findMany({
    where: params?.status ? { status: params.status } : undefined,
    include: {
      fromBranch: true,
      toBranch: true,
      requestedBy: { select: { id: true, username: true, fullName: true } },
      approvedBy: { select: { id: true, username: true, fullName: true } },
      lines: { include: { product: { select: { id: true, sku: true, name: true, unit: true } } } },
    },
    orderBy: { createdAt: "desc" },
  });
}

/* ── Get by ID ── */
export async function getTransfer(id: string) {
  const t = await prisma.transfer.findUnique({
    where: { id },
    include: {
      fromBranch: true,
      toBranch: true,
      requestedBy: { select: { id: true, username: true, fullName: true } },
      approvedBy: { select: { id: true, username: true, fullName: true } },
      lines: { include: { product: { select: { id: true, sku: true, name: true, unit: true } } } },
    },
  });
  if (!t) throw new Error("NOT_FOUND");
  return t;
}

/* ── Create ── */
type CreateTransferInput = {
  userId: string;
  fromBranchId: string;
  toBranchId: string;
  notes?: string;
  lines: { productId: string; quantity: number }[];
};

export async function createTransfer(input: CreateTransferInput) {
  if (!input.lines.length) throw new Error("INVALID_INPUT: Debe agregar al menos una línea");
  if (!input.fromBranchId) throw new Error("INVALID_INPUT: fromBranchId es requerido");
  if (!input.toBranchId) throw new Error("INVALID_INPUT: toBranchId es requerido");
  if (!input.userId) throw new Error("INVALID_INPUT: userId es requerido");
  if (input.fromBranchId === input.toBranchId) throw new Error("INVALID_INPUT: Sucursal origen y destino no pueden ser iguales");

  // Validate each line
  for (const l of input.lines) {
    if (!l.productId) throw new Error("INVALID_INPUT: productId es requerido en cada línea");
    if (typeof l.quantity !== "number" || l.quantity <= 0) throw new Error("INVALID_INPUT: Cantidad debe ser un número positivo");
  }

  // Get unit costs from current inventory balances
  const balances = await prisma.inventoryBalance.findMany({
    where: {
      branchId: input.fromBranchId,
      productId: { in: input.lines.map((l) => l.productId) },
    },
  });
  const balanceMap = new Map(balances.map((b) => [b.productId, b]));

  const lines = input.lines.map((l) => {
    const bal = balanceMap.get(l.productId);
    const unitCost = bal ? Number(bal.weightedAverageCost) : 0;
    return {
      productId: l.productId,
      quantityRequested: new Prisma.Decimal(l.quantity),
      unitCostSnapshot: new Prisma.Decimal(unitCost),
    };
  });

  const transfer = await prisma.transfer.create({
    data: {
      transferNumber: generateTransferNumber(),
      fromBranchId: input.fromBranchId,
      toBranchId: input.toBranchId,
      requestedByUserId: input.userId,
      notes: input.notes || null,
      status: "DRAFT",
      lines: {
        create: lines.map((l) => ({
          productId: l.productId,
          quantityRequested: l.quantityRequested,
          unitCostSnapshot: l.unitCostSnapshot,
        })),
      },
    },
    include: {
      fromBranch: true,
      toBranch: true,
      lines: { include: { product: { select: { id: true, sku: true, name: true } } } },
    },
  });

  await logAuditEvent({
    actorUserId: input.userId,
    branchId: input.fromBranchId,
    module: "transfers",
    action: "TRANSFER_CREATED",
    entityType: "Transfer",
    entityId: transfer.id,
    metadataJson: {
      transferNumber: transfer.transferNumber,
      fromBranch: input.fromBranchId,
      toBranch: input.toBranchId,
      linesCount: lines.length,
    },
  });

  return transfer;
}

/* ── Approve (moves inventory) ── */
export async function approveTransfer(id: string, userId: string) {
  const transfer = await prisma.transfer.findUnique({
    where: { id },
    include: { lines: { include: { product: true } }, fromBranch: true, toBranch: true },
  });

  if (!transfer) throw new Error("NOT_FOUND");
  if (transfer.status !== "DRAFT") throw new Error("INVALID_INPUT: Solo se pueden aprobar envíos en estado BORRADOR");

  const result = await prisma.$transaction(async (tx) => {
    // Check stock availability INSIDE the transaction to avoid race conditions
    for (const line of transfer.lines) {
      const balance = await tx.inventoryBalance.findUnique({
        where: { branchId_productId: { branchId: transfer.fromBranchId, productId: line.productId } },
      });
      const available = balance ? Number(balance.quantityOnHand) : 0;
      if (available < Number(line.quantityRequested)) {
        throw new Error(`INVALID_INPUT: Stock insuficiente para ${line.product.name}. Disponible: ${available}, Solicitado: ${Number(line.quantityRequested)}`);
      }
    }

    const updated = await tx.transfer.update({
      where: { id },
      data: {
        status: "IN_TRANSIT",
        approvedByUserId: userId,
        approvedAt: new Date(),
        dispatchedAt: new Date(),
      },
    });

    for (const line of transfer.lines) {
      const qty = Number(line.quantityRequested);
      const cost = Number(line.unitCostSnapshot);

      // Subtract from origin
      await createInventoryMovementTx(tx, {
        actorUserId: userId,
        branchId: transfer.fromBranchId,
        productId: line.productId,
        movementType: "TRANSFER_OUT",
        quantity: qty,
        unitCost: cost,
        referenceType: "Transfer",
        referenceId: transfer.id,
        notes: `Envío ${transfer.transferNumber} → ${transfer.toBranch.code}`,
      });

      // Add to destination
      await createInventoryMovementTx(tx, {
        actorUserId: userId,
        branchId: transfer.toBranchId,
        productId: line.productId,
        movementType: "TRANSFER_IN",
        quantity: qty,
        unitCost: cost,
        referenceType: "Transfer",
        referenceId: transfer.id,
        notes: `Envío ${transfer.transferNumber} ← ${transfer.fromBranch.code}`,
      });

      // Update dispatched/received quantities
      await tx.transferLine.update({
        where: { id: line.id },
        data: {
          quantityDispatched: line.quantityRequested,
          quantityReceived: line.quantityRequested,
        },
      });
    }

    // Mark as received immediately (MVP simplification)
    const received = await tx.transfer.update({
      where: { id },
      data: { status: "RECEIVED", receivedAt: new Date() },
    });

    return received;
  });

  await logAuditEvent({
    actorUserId: userId,
    branchId: transfer.fromBranchId,
    module: "transfers",
    action: "TRANSFER_APPROVED",
    entityType: "Transfer",
    entityId: transfer.id,
    metadataJson: {
      transferNumber: transfer.transferNumber,
      fromBranch: transfer.fromBranch.code,
      toBranch: transfer.toBranch.code,
      linesCount: transfer.lines.length,
    },
  });

  return result;
}

/* ── Cancel ── */
export async function cancelTransfer(id: string, userId: string) {
  const t = await prisma.transfer.findUnique({
    where: { id },
    include: {
      fromBranch: { select: { id: true, code: true, name: true } },
      toBranch: { select: { id: true, code: true, name: true } },
      lines: true,
    },
  });
  if (!t) throw new Error("NOT_FOUND");
  if (t.status !== "DRAFT") throw new Error("INVALID_INPUT: Solo se pueden cancelar envíos en estado BORRADOR");

  const result = await prisma.transfer.update({
    where: { id },
    data: { status: "CANCELLED" },
  });

  await logAuditEvent({
    actorUserId: userId,
    branchId: t.fromBranchId,
    module: "transfers",
    action: "TRANSFER_CANCELLED",
    entityType: "Transfer",
    entityId: t.id,
    metadataJson: {
      transferNumber: t.transferNumber,
      branchId: t.fromBranchId,
      fromBranchCode: t.fromBranch.code,
      toBranchCode: t.toBranch.code,
      linesCount: t.lines.length,
      cancelledByUserId: userId,
    },
  });

  return result;
}
