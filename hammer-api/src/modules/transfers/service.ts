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

/* ── Approve (DOES NOT move inventory — Phase 6 fix) ── */
export async function approveTransfer(id: string, userId: string) {
  const transfer = await prisma.transfer.findUnique({
    where: { id },
    include: { lines: { include: { product: true } }, fromBranch: true, toBranch: true },
  });

  if (!transfer) throw new Error("NOT_FOUND");
  if (transfer.status !== "DRAFT" && transfer.status !== "REQUESTED") {
    throw new Error("INVALID_INPUT: Solo se pueden aprobar envíos en estado BORRADOR o SOLICITADO");
  }

  const result = await prisma.transfer.update({
    where: { id },
    data: {
      status: "APPROVED",
      approvedByUserId: userId,
      approvedAt: new Date(),
    },
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
      note: "Aprobado sin movimiento de inventario. Inventario se descuenta al despachar.",
    },
  });

  return result;
}

/* ── Dispatch (creates TRANSFER_OUT in origin — Phase 6 fix) ── */
export async function dispatchTransfer(id: string, userId: string) {
  const transfer = await prisma.transfer.findUnique({
    where: { id },
    include: { lines: { include: { product: true } }, fromBranch: true, toBranch: true },
  });

  if (!transfer) throw new Error("NOT_FOUND");
  if (transfer.status !== "APPROVED") throw new Error("INVALID_INPUT: Solo se pueden despachar envíos en estado APROBADO");

  const result = await prisma.$transaction(async (tx) => {
    // Lock and check stock availability
    for (const line of transfer.lines) {
      await tx.$queryRaw`
        SELECT id FROM "InventoryBalance"
        WHERE "branchId" = ${transfer.fromBranchId}
          AND "productId" = ${line.productId}
        FOR UPDATE
      `;
      const balance = await tx.inventoryBalance.findUnique({
        where: { branchId_productId: { branchId: transfer.fromBranchId, productId: line.productId } },
      });
      const available = balance ? Number(balance.quantityOnHand) : 0;
      if (available < Number(line.quantityRequested)) {
        throw new Error(`INVALID_INPUT: Stock insuficiente para ${line.product.name}. Disponible: ${available}, Solicitado: ${Number(line.quantityRequested)}`);
      }
    }

    // Create TRANSFER_OUT movements (origin only)
    for (const line of transfer.lines) {
      const qty = Number(line.quantityRequested);
      const cost = Number(line.unitCostSnapshot);

      await createInventoryMovementTx(tx, {
        actorUserId: userId,
        branchId: transfer.fromBranchId,
        productId: line.productId,
        movementType: "TRANSFER_OUT",
        quantity: qty,
        unitCost: cost,
        referenceType: "Transfer",
        referenceId: transfer.id,
        notes: `Despacho ${transfer.transferNumber} → ${transfer.toBranch.code}`,
      });

      // Update dispatched quantity
      await tx.transferLine.update({
        where: { id: line.id },
        data: { quantityDispatched: line.quantityRequested },
      });
    }

    const updated = await tx.transfer.update({
      where: { id },
      data: {
        status: "IN_TRANSIT",
        dispatchedByUserId: userId,
        dispatchedAt: new Date(),
      },
    });

    return updated;
  });

  await logAuditEvent({
    actorUserId: userId,
    branchId: transfer.fromBranchId,
    module: "transfers",
    action: "TRANSFER_DISPATCHED",
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

/* ── Receive (creates TRANSFER_IN in destination — Phase 6 fix) ── */
export async function receiveTransfer(id: string, userId: string) {
  const transfer = await prisma.transfer.findUnique({
    where: { id },
    include: { lines: { include: { product: true } }, fromBranch: true, toBranch: true },
  });

  if (!transfer) throw new Error("NOT_FOUND");
  if (transfer.status !== "IN_TRANSIT" && transfer.status !== "PARTIALLY_RECEIVED") {
    throw new Error("INVALID_INPUT: Solo se pueden recibir envíos en estado EN TRÁNSITO o PARCIALMENTE RECIBIDO");
  }

  const result = await prisma.$transaction(async (tx) => {
    let allFullyReceived = true;

    for (const line of transfer.lines) {
      const pendingQty = Number(line.quantityDispatched) - Number(line.quantityReceived);
      if (pendingQty <= 0) continue; // Already fully received

      const cost = Number(line.unitCostSnapshot);

      await createInventoryMovementTx(tx, {
        actorUserId: userId,
        branchId: transfer.toBranchId,
        productId: line.productId,
        movementType: "TRANSFER_IN",
        quantity: pendingQty,
        unitCost: cost,
        referenceType: "Transfer",
        referenceId: transfer.id,
        notes: `Recepción ${transfer.transferNumber} ← ${transfer.fromBranch.code}`,
      });

      await tx.transferLine.update({
        where: { id: line.id },
        data: { quantityReceived: line.quantityDispatched },
      });
    }

    // Re-read lines to check if all fully received
    const updatedLines = await tx.transferLine.findMany({ where: { transferId: id } });
    for (const line of updatedLines) {
      if (Number(line.quantityReceived) < Number(line.quantityDispatched)) {
        allFullyReceived = false;
        break;
      }
    }

    const finalStatus = allFullyReceived ? "RECEIVED" : "PARTIALLY_RECEIVED";
    const updated = await tx.transfer.update({
      where: { id },
      data: {
        status: finalStatus as TransferStatus,
        ...(allFullyReceived ? { receivedByUserId: userId, receivedAt: new Date() } : {}),
      },
    });

    return updated;
  });

  await logAuditEvent({
    actorUserId: userId,
    branchId: transfer.toBranchId,
    module: "transfers",
    action: "TRANSFER_RECEIVED",
    entityType: "Transfer",
    entityId: transfer.id,
    metadataJson: {
      transferNumber: transfer.transferNumber,
      fromBranch: transfer.fromBranch.code,
      toBranch: transfer.toBranch.code,
      linesCount: transfer.lines.length,
      finalStatus: result.status,
    },
  });

  return result;
}

/* ── Cancel (allowed for DRAFT, REQUESTED, or APPROVED — Phase 6 fix) ── */
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
  if (t.status === "IN_TRANSIT" || t.status === "RECEIVED" || t.status === "PARTIALLY_RECEIVED") {
    throw new Error("INVALID_INPUT: No se puede cancelar un envío en tránsito o ya recibido");
  }
  if (t.status === "CANCELLED") throw new Error("INVALID_INPUT: El envío ya está cancelado");
  if (t.status !== "DRAFT" && t.status !== "REQUESTED" && t.status !== "APPROVED") {
    throw new Error("INVALID_INPUT: Solo se pueden cancelar envíos en estado BORRADOR, SOLICITADO o APROBADO");
  }

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
