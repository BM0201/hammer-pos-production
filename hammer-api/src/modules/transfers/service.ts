import { Prisma, TransferStatus } from "@prisma/client";
import { randomBytes } from "node:crypto";
import { prisma } from "@/lib/prisma";
import { logAuditEvent } from "@/modules/audit/service";
import { createInventoryMovementTx } from "@/modules/inventory/service";
import {
  convertBaseUnitCostToSaleUnitCost,
  convertSaleQtyToBaseQty,
  getSharedInventoryBalance,
} from "@/modules/inventory/unit-conversion";

function generateTransferNumber(): string {
  const ts = Date.now().toString(36).toUpperCase();
  const rand = randomBytes(4).toString("hex").toUpperCase();
  return `TR-${ts}-${rand}`;
}

type CreateTransferInput = {
  userId: string;
  fromBranchId: string;
  toBranchId: string;
  notes?: string;
  lines: { productId: string; quantity: number }[];
};

type ReceiveTransferInput = {
  items?: {
    productId: string;
    transferLineId?: string;
    quantityReceived: number;
    allocatedTransferFreightPerUnit?: number;
    notes?: string;
  }[];
  transferFreightAmount?: number;
  updateBranchCost?: boolean;
  notes?: string;
};
type ReceiveTransferItem = NonNullable<ReceiveTransferInput["items"]>[number];

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

export async function getTransfer(id: string) {
  const transfer = await prisma.transfer.findUnique({
    where: { id },
    include: {
      fromBranch: true,
      toBranch: true,
      requestedBy: { select: { id: true, username: true, fullName: true } },
      approvedBy: { select: { id: true, username: true, fullName: true } },
      lines: { include: { product: { select: { id: true, sku: true, name: true, unit: true } } } },
    },
  });
  if (!transfer) throw new Error("NOT_FOUND");
  return transfer;
}

export async function createTransfer(input: CreateTransferInput) {
  if (!input.lines.length) throw new Error("INVALID_INPUT: Debe agregar al menos una linea");
  if (!input.fromBranchId) throw new Error("INVALID_INPUT: fromBranchId es requerido");
  if (!input.toBranchId) throw new Error("INVALID_INPUT: toBranchId es requerido");
  if (!input.userId) throw new Error("INVALID_INPUT: userId es requerido");
  if (input.fromBranchId === input.toBranchId) throw new Error("INVALID_INPUT: Sucursal origen y destino no pueden ser iguales");

  for (const line of input.lines) {
    if (!line.productId) throw new Error("INVALID_INPUT: productId es requerido en cada linea");
    if (typeof line.quantity !== "number" || line.quantity <= 0) throw new Error("INVALID_INPUT: Cantidad debe ser positiva");
  }

  const balanceRows = await Promise.all(input.lines.map(async (line) => {
    const shared = await getSharedInventoryBalance(prisma, { branchId: input.fromBranchId, productId: line.productId });
    const unitCostSnapshot = shared.balance
      ? (shared.conversion
          ? convertBaseUnitCostToSaleUnitCost({ baseUnitCost: shared.balance.weightedAverageCost, conversionFactor: shared.conversion.conversionFactor })
          : shared.balance.weightedAverageCost)
      : new Prisma.Decimal(0);
    return [line.productId, unitCostSnapshot] as const;
  }));
  const unitCostByProductId = new Map(balanceRows);

  const transfer = await prisma.transfer.create({
    data: {
      transferNumber: generateTransferNumber(),
      fromBranchId: input.fromBranchId,
      toBranchId: input.toBranchId,
      requestedByUserId: input.userId,
      notes: input.notes || null,
      status: "DRAFT",
      lines: {
        create: input.lines.map((line) => ({
          productId: line.productId,
          quantityRequested: new Prisma.Decimal(line.quantity),
          unitCostSnapshot: unitCostByProductId.get(line.productId) ?? new Prisma.Decimal(0),
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
      linesCount: transfer.lines.length,
    },
  });

  return transfer;
}

export async function approveTransfer(id: string, userId: string) {
  const transfer = await prisma.transfer.findUnique({
    where: { id },
    include: { lines: true, fromBranch: true, toBranch: true },
  });
  if (!transfer) throw new Error("NOT_FOUND");
  if (transfer.status !== "DRAFT") throw new Error("INVALID_INPUT: Solo se pueden aprobar traslados en DRAFT");

  const result = await prisma.transfer.update({
    where: { id },
    data: { status: "APPROVED", approvedByUserId: userId, approvedAt: new Date() },
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
      previousStatus: transfer.status,
      newStatus: "APPROVED",
      linesCount: transfer.lines.length,
      fromBranch: transfer.fromBranch.code,
      toBranch: transfer.toBranch.code,
    },
  });

  return result;
}

export async function dispatchTransfer(id: string, userId: string) {
  const transfer = await prisma.transfer.findUnique({
    where: { id },
    include: { lines: { include: { product: true } }, fromBranch: true, toBranch: true },
  });
  if (!transfer) throw new Error("NOT_FOUND");
  if (transfer.status !== "APPROVED") throw new Error("INVALID_INPUT: Solo se pueden despachar traslados aprobados");

  const result = await prisma.$transaction(async (tx) => {
    for (const line of transfer.lines) {
      const pendingDispatch = Number(line.quantityRequested) - Number(line.quantityDispatched);
      if (pendingDispatch <= 0) continue;
      const shared = await getSharedInventoryBalance(tx, { branchId: transfer.fromBranchId, productId: line.productId });
      const available = shared.balance?.quantityOnHand ?? new Prisma.Decimal(0);
      const required = shared.conversion
        ? convertSaleQtyToBaseQty({ quantity: pendingDispatch, conversionFactor: shared.conversion.conversionFactor })
        : new Prisma.Decimal(pendingDispatch);
      if (available.lt(required)) {
        throw new Error(`INVALID_INPUT: Stock insuficiente para ${line.product.name}. Disponible: ${available.toString()} ${shared.conversion?.baseUnit ?? ""}, Solicitado: ${required.toString()} ${shared.conversion?.baseUnit ?? ""}`);
      }
      if (Number(line.unitCostSnapshot) <= 0) {
        throw new Error(`INVALID_INPUT: ${line.product.name} no tiene costo de origen para traslado`);
      }
    }

    for (const line of transfer.lines) {
      const qty = Number(line.quantityRequested) - Number(line.quantityDispatched);
      if (qty <= 0) continue;
      await createInventoryMovementTx(tx, {
        actorUserId: userId,
        branchId: transfer.fromBranchId,
        productId: line.productId,
        movementType: "TRANSFER_OUT",
        quantity: qty,
        unitCost: Number(line.unitCostSnapshot),
        referenceType: "Transfer",
        referenceId: transfer.id,
        notes: `Despacho ${transfer.transferNumber} -> ${transfer.toBranch.code}`,
      });
      await tx.transferLine.update({
        where: { id: line.id },
        data: { quantityDispatched: line.quantityRequested },
      });
    }

    return tx.transfer.update({
      where: { id },
      data: { status: "IN_TRANSIT", dispatchedAt: new Date() },
    });
  });

  await logAuditEvent({
    actorUserId: userId,
    branchId: transfer.fromBranchId,
    module: "transfers",
    action: "TRANSFER_DISPATCHED",
    entityType: "Transfer",
    entityId: transfer.id,
    metadataJson: { transferNumber: transfer.transferNumber, previousStatus: transfer.status, newStatus: "IN_TRANSIT" },
  });

  return result;
}

export async function receiveTransfer(id: string, userId: string, input: ReceiveTransferInput = {}) {
  const transfer = await prisma.transfer.findUnique({
    where: { id },
    include: { lines: { include: { product: true } }, fromBranch: true, toBranch: true },
  });
  if (!transfer) throw new Error("NOT_FOUND");
  if (!["IN_TRANSIT", "PARTIALLY_RECEIVED"].includes(transfer.status)) {
    throw new Error("INVALID_INPUT: Solo se pueden recibir traslados en transito");
  }

  const defaultItems: ReceiveTransferItem[] = transfer.lines
    .map((line) => ({
      productId: line.productId,
      transferLineId: line.id,
      quantityReceived: Number(line.quantityDispatched) - Number(line.quantityReceived),
    }))
    .filter((item) => item.quantityReceived > 0);
  const items: ReceiveTransferItem[] = input.items?.length ? input.items : defaultItems;
  if (items.length === 0) throw new Error("INVALID_INPUT: No hay cantidades pendientes por recibir");
  const totalReceiveQty = items.reduce((sum, item) => sum + Math.max(0, Number(item.quantityReceived)), 0);
  const freightPerUnit = totalReceiveQty > 0 ? Math.max(0, Number(input.transferFreightAmount ?? 0)) / totalReceiveQty : 0;
  const receivedLines: Array<Record<string, unknown>> = [];
  const warnings: string[] = [];

  const result = await prisma.$transaction(async (tx) => {
    for (const item of items) {
      const line = transfer.lines.find((candidate) => candidate.productId === item.productId || candidate.id === item.transferLineId);
      if (!line) throw new Error(`INVALID_INPUT: Producto ${item.productId} no pertenece al traslado`);
      const qty = Number(item.quantityReceived);
      if (!Number.isFinite(qty) || qty <= 0) throw new Error("INVALID_INPUT: quantityReceived debe ser mayor que 0");
      const pending = Number(line.quantityDispatched) - Number(line.quantityReceived);
      if (pending <= 0) throw new Error(`INVALID_INPUT: ${line.product.name} no tiene cantidad pendiente por recibir`);
      if (qty > pending) throw new Error(`INVALID_INPUT: No se puede recibir mas de lo despachado para ${line.product.name}. Pendiente: ${pending}`);

      const shared = await getSharedInventoryBalance(tx, { branchId: transfer.toBranchId, productId: line.productId });
      const previousBalance = shared.balance;
      const previousStock = Number(previousBalance?.quantityOnHand ?? 0);
      const previousWac = previousBalance
        ? Number(shared.conversion
          ? convertBaseUnitCostToSaleUnitCost({ baseUnitCost: previousBalance.weightedAverageCost, conversionFactor: shared.conversion.conversionFactor })
          : previousBalance.weightedAverageCost)
        : null;
      const finalUnitCost = Math.round((Number(line.unitCostSnapshot) + (item.allocatedTransferFreightPerUnit ?? freightPerUnit)) * 10000) / 10000;
      if (finalUnitCost <= 0) throw new Error(`INVALID_INPUT: ${line.product.name} no tiene costo final valido para recepcion`);

      const movementResult = await createInventoryMovementTx(tx, {
        actorUserId: userId,
        branchId: transfer.toBranchId,
        productId: line.productId,
        movementType: "TRANSFER_IN",
        quantity: qty,
        unitCost: finalUnitCost,
        referenceType: "Transfer",
        referenceId: transfer.id,
        notes: item.notes ?? input.notes ?? `Recepcion ${transfer.transferNumber} <- ${transfer.fromBranch.code}`,
      });

      await tx.transferLine.update({
        where: { id: line.id },
        data: { quantityReceived: line.quantityReceived.add(qty) },
      });

      if (input.updateBranchCost) {
        const branchCost = shared.conversion
          ? convertBaseUnitCostToSaleUnitCost({ baseUnitCost: movementResult.balance.weightedAverageCost, conversionFactor: shared.conversion.conversionFactor })
          : movementResult.balance.weightedAverageCost;
        await tx.branchProductSetting.upsert({
          where: { branchId_productId: { branchId: transfer.toBranchId, productId: line.productId } },
          create: { branchId: transfer.toBranchId, productId: line.productId, branchCost },
          update: { branchCost },
        });
      }

      receivedLines.push({
        productId: line.productId,
        inventoryProductId: shared.inventoryProductId,
        quantityReceived: qty,
        finalUnitCost,
        previousStock,
        newStock: Number(movementResult.balance.quantityOnHand),
        previousWeightedAverageCost: previousWac,
        newWeightedAverageCost: Number(movementResult.balance.weightedAverageCost),
        warnings: [],
      });
    }

    const freshLines = await tx.transferLine.findMany({ where: { transferId: transfer.id } });
    const fullyReceived = freshLines.every((line) => line.quantityReceived.gte(line.quantityDispatched));
    return tx.transfer.update({
      where: { id },
      data: { status: fullyReceived ? "RECEIVED" : "PARTIALLY_RECEIVED", receivedAt: fullyReceived ? new Date() : transfer.receivedAt },
    });
  });

  await logAuditEvent({
    actorUserId: userId,
    branchId: transfer.toBranchId,
    module: "transfers",
    action: "TRANSFER_RECEIVED",
    entityType: "Transfer",
    entityId: transfer.id,
    metadataJson: { transferNumber: transfer.transferNumber, statusAfter: result.status, receivedLines, warnings },
  });

  return { ok: true, transferId: transfer.id, statusAfter: result.status, receivedLines, warnings };
}

export async function cancelTransfer(id: string, userId: string) {
  const transfer = await prisma.transfer.findUnique({
    where: { id },
    include: {
      fromBranch: { select: { id: true, code: true, name: true } },
      toBranch: { select: { id: true, code: true, name: true } },
      lines: true,
    },
  });
  if (!transfer) throw new Error("NOT_FOUND");
  if (transfer.status === "IN_TRANSIT" || transfer.status === "PARTIALLY_RECEIVED") {
    throw new Error("INVALID_INPUT: No se puede cancelar un traslado en transito; requiere flujo de retorno");
  }
  if (!["DRAFT", "APPROVED"].includes(transfer.status)) {
    throw new Error("INVALID_INPUT: Solo se pueden cancelar traslados en borrador o aprobados");
  }

  const result = await prisma.transfer.update({
    where: { id },
    data: { status: "CANCELLED" },
  });

  await logAuditEvent({
    actorUserId: userId,
    branchId: transfer.fromBranchId,
    module: "transfers",
    action: "TRANSFER_CANCELLED",
    entityType: "Transfer",
    entityId: transfer.id,
    metadataJson: {
      transferNumber: transfer.transferNumber,
      branchId: transfer.fromBranchId,
      fromBranchCode: transfer.fromBranch.code,
      toBranchCode: transfer.toBranch.code,
      linesCount: transfer.lines.length,
      cancelledByUserId: userId,
      previousStatus: transfer.status,
      newStatus: "CANCELLED",
    },
  });

  return result;
}
