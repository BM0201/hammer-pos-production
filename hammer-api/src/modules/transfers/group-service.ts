import { Prisma, PrismaClient } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { createTransfer, approveTransferTx, cancelTransferTx } from "@/modules/transfers/service";
import { computeInventoryLockProductIds } from "@/modules/sales/service";
import { logAuditEvent } from "@/modules/audit/service";

type DbClient = PrismaClient | Prisma.TransactionClient;

/**
 * Parte B.3 (prompt-completo-pendientes-2026-10.md) — "de una bodega a
 * varias": un origen, varios destinos, la misma matriz. A diferencia de
 * PurchaseOrderGroup, acá SÍ hay algo que puede fallar por falta de stock
 * REAL (el origen no tiene infinito) — se valida la SUMA de todos los
 * destinos contra el stock bloqueado del origen ANTES de crear nada.
 */

async function nextTransferGroupCodeTx(tx: Prisma.TransactionClient): Promise<{ code: string; sequence: number }> {
  const last = await tx.transferGroup.findFirst({ orderBy: { sequence: "desc" }, select: { sequence: true } });
  const sequence = (last?.sequence ?? 0) + 1;
  return { code: `TG-${String(sequence).padStart(6, "0")}`, sequence };
}

export type CreateTransferGroupLineInput = {
  productId: string;
  quantity: number;
  /** branchId (destino) → cantidad distinta; 0 = ese destino no lleva esta línea. */
  overrides?: Record<string, number>;
};

export type CreateTransferGroupInput = {
  clientRequestId: string;
  actorUserId: string;
  fromBranchId: string;
  toBranchIds: string[];
  notes?: string | null;
  lines: CreateTransferGroupLineInput[];
};

export type CreateTransferGroupResult = {
  group: { id: string; code: string };
  transfers: Array<{ id: string; transferNumber: string; toBranchId: string; linesCount: number }>;
  skipped: Array<{ branchId: string; reason: string }>;
};

function quantityForDestination(line: CreateTransferGroupLineInput, branchId: string): number {
  return line.overrides && branchId in line.overrides ? line.overrides[branchId] : line.quantity;
}

function validateInput(input: CreateTransferGroupInput) {
  if (input.toBranchIds.length < 2) throw new Error("VALIDATION_ERROR: Un traslado a varias sucursales necesita al menos 2 destinos — con uno, usa el flujo normal.");
  if (new Set(input.toBranchIds).size !== input.toBranchIds.length) throw new Error("VALIDATION_ERROR: Hay destinos repetidos.");
  if (input.toBranchIds.includes(input.fromBranchId)) throw new Error("VALIDATION_ERROR: El origen no puede ser también un destino.");
  if (input.lines.length === 0) throw new Error("VALIDATION_ERROR: Agrega al menos un producto.");
  const seenProducts = new Set<string>();
  for (const line of input.lines) {
    if (seenProducts.has(line.productId)) throw new Error(`VALIDATION_ERROR: El producto ${line.productId} está repetido.`);
    seenProducts.add(line.productId);
    if (!(line.quantity > 0)) throw new Error("VALIDATION_ERROR: La cantidad para todos los destinos debe ser mayor a 0.");
    for (const [branchId, qty] of Object.entries(line.overrides ?? {})) {
      if (!input.toBranchIds.includes(branchId)) throw new Error(`VALIDATION_ERROR: El destino ${branchId} del override no está en la lista de destinos elegidos.`);
      if (qty < 0) throw new Error("VALIDATION_ERROR: Una cantidad distinta por destino no puede ser negativa.");
    }
  }
}

export async function createTransferGroup(input: CreateTransferGroupInput, db: PrismaClient = prisma): Promise<CreateTransferGroupResult> {
  validateInput(input);

  const existing = await db.transferGroup.findUnique({
    where: { clientRequestId: input.clientRequestId },
    include: { transfers: { select: { id: true, transferNumber: true, toBranchId: true, lines: { select: { id: true } } } } },
  });
  if (existing) {
    return {
      group: { id: existing.id, code: existing.code },
      transfers: existing.transfers.map((t) => ({ id: t.id, transferNumber: t.transferNumber, toBranchId: t.toBranchId, linesCount: t.lines.length })),
      skipped: [],
    };
  }

  try {
    const result = await db.$transaction(async (tx) => {
      // Suma por producto de TODOS los destinos — el total real que el
      // origen necesita cubrir, no línea por línea sucursal por sucursal.
      const requiredByProduct = new Map<string, number>();
      for (const line of input.lines) {
        let total = 0;
        for (const branchId of input.toBranchIds) total += quantityForDestination(line, branchId);
        if (total > 0) requiredByProduct.set(line.productId, total);
      }
      if (requiredByProduct.size === 0) throw new Error("VALIDATION_ERROR: Ningún destino quedó con productos — revisa las cantidades.");

      // Lock batched en el MISMO orden determinista que el checkout (evita deadlocks con ventas concurrentes del origen).
      const productIds = computeInventoryLockProductIds([...requiredByProduct.keys()]);
      await tx.$queryRaw`
        SELECT id FROM "InventoryBalance"
        WHERE "branchId" = ${input.fromBranchId} AND "productId" = ANY(ARRAY[${Prisma.join(productIds)}])
        ORDER BY "productId" FOR UPDATE
      `;
      const balances = await tx.inventoryBalance.findMany({
        where: { branchId: input.fromBranchId, productId: { in: productIds } },
        select: { productId: true, quantityOnHand: true },
      });
      const stockByProduct = new Map(balances.map((b) => [b.productId, Number(b.quantityOnHand)]));
      const products = await tx.product.findMany({ where: { id: { in: productIds } }, select: { id: true, sku: true, name: true } });
      const productBySkuId = new Map(products.map((p) => [p.id, p]));

      const shortages: string[] = [];
      for (const [productId, required] of requiredByProduct) {
        const available = stockByProduct.get(productId) ?? 0;
        if (required > available) {
          const label = productBySkuId.get(productId)?.name ?? productId;
          shortages.push(`${label}: pedís ${required} entre ${input.toBranchIds.length} sucursales, hay ${available} en origen.`);
        }
      }
      if (shortages.length > 0) throw new Error(`CONFLICT: Stock insuficiente en el origen — ${shortages.join(" · ")}`);

      const { code, sequence } = await nextTransferGroupCodeTx(tx);
      const group = await tx.transferGroup.create({
        data: { code, sequence, clientRequestId: input.clientRequestId, fromBranchId: input.fromBranchId, notes: input.notes ?? null, createdByUserId: input.actorUserId },
      });

      const transfers: CreateTransferGroupResult["transfers"] = [];
      const skipped: CreateTransferGroupResult["skipped"] = [];

      for (const toBranchId of input.toBranchIds) {
        const destLines = input.lines
          .map((line) => ({ productId: line.productId, quantity: quantityForDestination(line, toBranchId) }))
          .filter((line) => line.quantity > 0);

        if (destLines.length === 0) {
          skipped.push({ branchId: toBranchId, reason: "Sin productos para este destino (todas las cantidades quedaron en 0)." });
          continue;
        }

        const transfer = await createTransfer({ userId: input.actorUserId, fromBranchId: input.fromBranchId, toBranchId, groupId: group.id, lines: destLines }, tx);
        transfers.push({ id: transfer.id, transferNumber: transfer.transferNumber, toBranchId, linesCount: transfer.lines.length });
      }

      if (transfers.length === 0) throw new Error("VALIDATION_ERROR: Ningún destino quedó con productos — revisa las cantidades.");

      return { group: { id: group.id, code: group.code }, transfers, skipped };
    });

    await logAuditEvent({
      actorUserId: input.actorUserId,
      branchId: input.fromBranchId,
      module: "transfers",
      action: "TRANSFER_GROUP_CREATED",
      entityType: "TransferGroup",
      entityId: result.group.id,
      metadataJson: { code: result.group.code, transferIds: result.transfers.map((t) => t.id), skippedBranchIds: result.skipped.map((s) => s.branchId) },
    });
    return result;
  } catch (error) {
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") {
      const race = await db.transferGroup.findUnique({
        where: { clientRequestId: input.clientRequestId },
        include: { transfers: { select: { id: true, transferNumber: true, toBranchId: true, lines: { select: { id: true } } } } },
      });
      if (race) {
        return {
          group: { id: race.id, code: race.code },
          transfers: race.transfers.map((t) => ({ id: t.id, transferNumber: t.transferNumber, toBranchId: t.toBranchId, linesCount: t.lines.length })),
          skipped: [],
        };
      }
    }
    throw error;
  }
}

export async function getTransferGroup(id: string, db: DbClient = prisma) {
  const group = await db.transferGroup.findUnique({
    where: { id },
    include: {
      fromBranch: { select: { id: true, code: true, name: true } },
      transfers: {
        include: {
          toBranch: { select: { id: true, code: true, name: true } },
          lines: { include: { product: { select: { id: true, sku: true, name: true } } } },
        },
      },
    },
  });
  if (!group) throw new Error("NOT_FOUND: Grupo de traslado no encontrado.");
  return group;
}

export async function listTransferGroups(input: { limit: number; cursor?: string }, db: DbClient = prisma) {
  const groups = await db.transferGroup.findMany({
    orderBy: { createdAt: "desc" },
    take: input.limit + 1,
    ...(input.cursor ? { cursor: { id: input.cursor }, skip: 1 } : {}),
    include: {
      fromBranch: { select: { id: true, code: true, name: true } },
      transfers: { select: { id: true, status: true, toBranch: { select: { code: true } } } },
    },
  });
  const hasMore = groups.length > input.limit;
  const page = hasMore ? groups.slice(0, input.limit) : groups;
  return { groups: page, nextCursor: hasMore ? page.at(-1)?.id ?? null : null };
}

export async function approveTransferGroup(groupId: string, actorUserId: string, db: PrismaClient = prisma) {
  const group = await db.transferGroup.findUnique({ where: { id: groupId }, include: { transfers: { select: { id: true, transferNumber: true, status: true, toBranch: { select: { code: true } } } } } });
  if (!group) throw new Error("NOT_FOUND: Grupo de traslado no encontrado.");

  const approved: string[] = [];
  const failed: Array<{ transferId: string; transferNumber: string; branchCode: string; reason: string }> = [];
  for (const transfer of group.transfers) {
    try {
      await db.$transaction((tx) => approveTransferTx(tx, transfer.id, actorUserId));
      approved.push(transfer.id);
    } catch (error) {
      failed.push({ transferId: transfer.id, transferNumber: transfer.transferNumber, branchCode: transfer.toBranch.code, reason: error instanceof Error ? error.message : String(error) });
    }
  }
  return { approved, failed };
}

export async function cancelTransferGroup(groupId: string, actorUserId: string, db: PrismaClient = prisma) {
  const group = await db.transferGroup.findUnique({ where: { id: groupId }, include: { transfers: { select: { id: true, transferNumber: true, status: true, toBranch: { select: { code: true } } } } } });
  if (!group) throw new Error("NOT_FOUND: Grupo de traslado no encontrado.");

  const cancelled: string[] = [];
  const failed: Array<{ transferId: string; transferNumber: string; branchCode: string; reason: string }> = [];
  for (const transfer of group.transfers) {
    if (!["DRAFT", "APPROVED"].includes(transfer.status)) continue;
    try {
      await db.$transaction((tx) => cancelTransferTx(tx, transfer.id, actorUserId));
      cancelled.push(transfer.id);
    } catch (error) {
      failed.push({ transferId: transfer.id, transferNumber: transfer.transferNumber, branchCode: transfer.toBranch.code, reason: error instanceof Error ? error.message : String(error) });
    }
  }
  return { cancelled, failed };
}
