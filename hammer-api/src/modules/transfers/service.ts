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
import { resolveGlobalCostWriteTarget } from "@/modules/catalog/service";

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

export async function createTransfer(input: CreateTransferInput, db: Prisma.TransactionClient | typeof prisma = prisma) {
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
    const shared = await getSharedInventoryBalance(db, { branchId: input.fromBranchId, productId: line.productId });
    const unitCostSnapshot = shared.balance
      ? (shared.conversion
          ? convertBaseUnitCostToSaleUnitCost({ baseUnitCost: shared.balance.weightedAverageCost, conversionFactor: shared.conversion.conversionFactor })
          : shared.balance.weightedAverageCost)
      : new Prisma.Decimal(0);
    return [line.productId, unitCostSnapshot] as const;
  }));
  const unitCostByProductId = new Map(balanceRows);

  const transfer = await db.transfer.create({
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

/**
 * prompt-seguridad-basica.md Fase 1 — el cuerpo transaccional, separado del
 * wrapper para poder probarlo con un tx fake (mismo patrón que
 * completeBatchTx/reverseBatchTx en production/service.ts). El lock
 * (FOR UPDATE) serializa un doble clic/reintento: el segundo, una vez que
 * obtiene el lock, relee el estado YA actualizado por el primero y lo
 * rechaza antes de tocar nada. El updateMany final es la segunda red de
 * seguridad.
 */
export async function approveTransferTx(tx: Prisma.TransactionClient, id: string, userId: string) {
  await tx.$queryRaw`SELECT id FROM "Transfer" WHERE id = ${id} FOR UPDATE`;

  const transfer = await tx.transfer.findUnique({
    where: { id },
    include: { lines: true, fromBranch: true, toBranch: true },
  });
  if (!transfer) throw new Error("NOT_FOUND");
  if (transfer.status !== "DRAFT") throw new Error("ALREADY_PROCESSED");

  const updateResult = await tx.transfer.updateMany({
    where: { id, status: "DRAFT" },
    data: { status: "APPROVED", approvedByUserId: userId, approvedAt: new Date() },
  });
  if (updateResult.count === 0) throw new Error("ALREADY_PROCESSED");

  await tx.auditLog.create({
    data: {
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
      } as unknown as Prisma.InputJsonValue,
    },
  });

  return tx.transfer.findUniqueOrThrow({ where: { id } });
}

export async function approveTransfer(id: string, userId: string) {
  return prisma.$transaction((tx) => approveTransferTx(tx, id, userId));
}

/**
 * prompt-seguridad-basica.md Fase 1 — antes, transfer se leía FUERA de la
 * transacción: dos despachos concurrentes veían las mismas quantityDispatched
 * "pendientes" y cada uno sacaba stock por esa misma cantidad — doble
 * TRANSFER_OUT. Ahora todo (el pre-chequeo de stock, el movimiento y el
 * update final) vive DESPUÉS del lock, sobre una relectura fresca: el
 * segundo despacho, una vez que obtiene el lock, ve el estado YA
 * actualizado por el primero y se rechaza antes de mover nada.
 */
export async function dispatchTransferTx(
  tx: Prisma.TransactionClient,
  id: string,
  userId: string,
  options: { allowAutoOpen?: boolean } = {},
) {
  await tx.$queryRaw`SELECT id FROM "Transfer" WHERE id = ${id} FOR UPDATE`;

  const transfer = await tx.transfer.findUnique({
    where: { id },
    include: { lines: { include: { product: true } }, fromBranch: true, toBranch: true },
  });
  if (!transfer) throw new Error("NOT_FOUND");
  if (transfer.status !== "APPROVED") throw new Error("ALREADY_PROCESSED");

  {
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
      // Fusión de Inventario v2, Fase 1.4: el traslado de un producto de grupo
      // con paquetes declara composición — PACKAGES si el producto trasladado
      // es la presentación cerrada (por inferencia, sin cambios), LOOSE si es
      // la base. El pre-chequeo de arriba compara contra el stock TOTAL
      // (cajas+sueltas), así que un traslado podía pasarlo y aun así fallar
      // aquí por falta de sueltas específicamente — sin auto-apertura
      // silenciosa: solo se abre si el usuario lo confirmó explícitamente
      // (checkbox en la UI de traslado).
      const shared = await getSharedInventoryBalance(tx, { branchId: transfer.fromBranchId, productId: line.productId });
      const targetsLooseSide = Boolean(shared.conversion?.tracksPackages) && !shared.conversion?.isPackagePresentation;
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
        composition: targetsLooseSide && options.allowAutoOpen ? { kind: "BASE_AUTO" } : undefined,
      });
      await tx.transferLine.update({
        where: { id: line.id },
        data: { quantityDispatched: line.quantityRequested },
      });
    }
  }

  const updateResult = await tx.transfer.updateMany({
    where: { id, status: "APPROVED" },
    data: { status: "IN_TRANSIT", dispatchedAt: new Date() },
  });
  if (updateResult.count === 0) throw new Error("ALREADY_PROCESSED");

  await tx.auditLog.create({
    data: {
      actorUserId: userId,
      branchId: transfer.fromBranchId,
      module: "transfers",
      action: "TRANSFER_DISPATCHED",
      entityType: "Transfer",
      entityId: transfer.id,
      metadataJson: { transferNumber: transfer.transferNumber, previousStatus: transfer.status, newStatus: "IN_TRANSIT" } as unknown as Prisma.InputJsonValue,
    },
  });

  return tx.transfer.findUniqueOrThrow({ where: { id } });
}

export async function dispatchTransfer(id: string, userId: string, options: { allowAutoOpen?: boolean } = {}) {
  return prisma.$transaction((tx) => dispatchTransferTx(tx, id, userId, options));
}

/**
 * prompt-seguridad-basica.md Fase 1 — recepción parcial: el status NO
 * siempre cambia (IN_TRANSIT/PARTIALLY_RECEIVED pueden seguir igual si la
 * recepción es parcial), así que un CAS sobre el status NO alcanza por sí
 * solo para frenar una segunda recepción concurrente. Lo que realmente lo
 * frena es recalcular `items`/`totalReceiveQty`/`pending` DESPUÉS del lock,
 * sobre una relectura fresca: el segundo intento, una vez que obtiene el
 * lock, ve las cantidades YA recibidas por el primero y calcula "pendiente"
 * correctamente (o rechaza si ya no queda nada pendiente, o si la cantidad
 * pedida ya no cabe en lo que falta).
 */
export async function receiveTransferTx(
  tx: Prisma.TransactionClient,
  id: string,
  userId: string,
  input: ReceiveTransferInput = {},
) {
  await tx.$queryRaw`SELECT id FROM "Transfer" WHERE id = ${id} FOR UPDATE`;

  const transfer = await tx.transfer.findUnique({
    where: { id },
    include: { lines: { include: { product: true } }, fromBranch: true, toBranch: true },
  });
  if (!transfer) throw new Error("NOT_FOUND");
  if (!["IN_TRANSIT", "PARTIALLY_RECEIVED"].includes(transfer.status)) {
    throw new Error("INVALID_INPUT: Solo se pueden recibir traslados en transito");
  }
  const statusAtLock = transfer.status;

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

  {
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

      // Fusión de Inventario v2, Fase 1.4: sin composition explícita, se
      // infiere del MISMO line.productId que usó el despacho — PACKAGES si es
      // la presentación cerrada, LOOSE si es la base — así que el destino
      // recibe con la MISMA composición que salió del origen (cajas llegan
      // como cajas) automáticamente, sin necesidad de propagar un flag extra.
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
        const branchCostForLine = shared.conversion
          ? convertBaseUnitCostToSaleUnitCost({ baseUnitCost: movementResult.balance.weightedAverageCost, conversionFactor: shared.conversion.conversionFactor })
          : movementResult.balance.weightedAverageCost;
        // "revisa todo... para evitar bugs" — el número de arriba ya está
        // bien calculado (WAC del canónico convertido a la unidad de
        // line.productId), pero se guardaba SIEMPRE en line.productId. Si
        // line.productId es un miembro DERIVADO, resolveEffectivePricing
        // ignora su branchCost propio — dato fantasma. Mismo redirect que
        // updateProduct (catalog/service.ts) usa para globalCost.
        const costTarget = resolveGlobalCostWriteTarget({
          requestedProductId: line.productId,
          enteredCost: branchCostForLine.toNumber(),
          conversion: shared.conversion,
        });
        const branchCost = new Prisma.Decimal(costTarget.costForTarget);
        await tx.branchProductSetting.upsert({
          where: { branchId_productId: { branchId: transfer.toBranchId, productId: costTarget.targetProductId } },
          create: { branchId: transfer.toBranchId, productId: costTarget.targetProductId, branchCost },
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

  }

  const freshLines = await tx.transferLine.findMany({ where: { transferId: transfer.id } });
  const fullyReceived = freshLines.every((line) => line.quantityReceived.gte(line.quantityDispatched));
  const newStatus = fullyReceived ? "RECEIVED" : "PARTIALLY_RECEIVED";

  const updateResult = await tx.transfer.updateMany({
    where: { id, status: statusAtLock },
    data: { status: newStatus, receivedAt: fullyReceived ? new Date() : transfer.receivedAt },
  });
  if (updateResult.count === 0) throw new Error("ALREADY_PROCESSED");

  await tx.auditLog.create({
    data: {
      actorUserId: userId,
      branchId: transfer.toBranchId,
      module: "transfers",
      action: "TRANSFER_RECEIVED",
      entityType: "Transfer",
      entityId: transfer.id,
      metadataJson: {
        transferNumber: transfer.transferNumber,
        statusAfter: newStatus,
        receivedLines,
        warnings,
      } as unknown as Prisma.InputJsonValue,
    },
  });

  return { ok: true, transferId: transfer.id, statusAfter: newStatus, receivedLines, warnings };
}

export async function receiveTransfer(id: string, userId: string, input: ReceiveTransferInput = {}) {
  return prisma.$transaction((tx) => receiveTransferTx(tx, id, userId, input));
}

/**
 * prompt-seguridad-basica.md Fase 1 — mismo patrón: lock + relectura +
 * transición condicional. El motivo de negocio específico (no cancelar un
 * traslado en tránsito) se conserva tal cual; el genérico "no está en
 * DRAFT/APPROVED" pasa a ALREADY_PROCESSED para ser consistente con el
 * resto de funciones de este módulo — cubre el doble-cancel de forma
 * natural, ya que el segundo intento, tras obtener el lock, ve
 * status=CANCELLED.
 */
export async function cancelTransferTx(tx: Prisma.TransactionClient, id: string, userId: string) {
  await tx.$queryRaw`SELECT id FROM "Transfer" WHERE id = ${id} FOR UPDATE`;

  const transfer = await tx.transfer.findUnique({
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
    throw new Error("ALREADY_PROCESSED");
  }

  const updateResult = await tx.transfer.updateMany({
    where: { id, status: transfer.status },
    data: { status: "CANCELLED" },
  });
  if (updateResult.count === 0) throw new Error("ALREADY_PROCESSED");

  await tx.auditLog.create({
    data: {
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
      } as unknown as Prisma.InputJsonValue,
    },
  });

  return tx.transfer.findUniqueOrThrow({ where: { id } });
}

export async function cancelTransfer(id: string, userId: string) {
  return prisma.$transaction((tx) => cancelTransferTx(tx, id, userId));
}
