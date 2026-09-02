/**
 * Reorder Engine — Smart inventory replenishment service.
 *
 * Detects low-stock products per branch using configurable policies,
 * suggests purchases or inter-branch transfers, and converts alerts
 * into PurchaseOrder / Transfer records via existing services.
 */
import { Prisma, ReorderAlertStatus, ReorderAlertType } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { logAuditEvent } from "@/modules/audit/service";
import { createPurchaseOrder } from "@/modules/purchase-orders/service";
import { createTransfer } from "@/modules/transfers/service";
import type { UpsertPolicyInput } from "@/modules/reorder/validators";

/* ════════════════════════════════════════════════════════════════
 *  POLICIES — CRUD for StockReorderPolicy
 * ════════════════════════════════════════════════════════════════ */

export async function listReorderPolicies(params: {
  branchId?: string;
  productId?: string;
  isActive?: boolean;
}) {
  return prisma.stockReorderPolicy.findMany({
    where: {
      ...(params.branchId ? { branchId: params.branchId } : {}),
      ...(params.productId ? { productId: params.productId } : {}),
      ...(params.isActive !== undefined ? { isActive: params.isActive } : {}),
    },
    include: {
      product: { select: { id: true, sku: true, name: true, unit: true } },
      branch: { select: { id: true, code: true, name: true } },
      preferredSupplierRef: { select: { id: true, name: true } },
    },
    orderBy: [{ branch: { code: "asc" } }, { product: { name: "asc" } }],
  });
}

export async function upsertReorderPolicy(input: UpsertPolicyInput, userId: string) {
  if (input.targetQuantity <= input.reorderPoint) {
    throw new Error("INVALID_INPUT: targetQuantity debe ser mayor que reorderPoint");
  }

  const policy = await prisma.stockReorderPolicy.upsert({
    where: {
      branchId_productId: {
        branchId: input.branchId,
        productId: input.productId,
      },
    },
    create: {
      branchId: input.branchId,
      productId: input.productId,
      minQuantity: new Prisma.Decimal(input.minQuantity ?? 0),
      reorderPoint: new Prisma.Decimal(input.reorderPoint),
      targetQuantity: new Prisma.Decimal(input.targetQuantity),
      safetyStock: new Prisma.Decimal(input.safetyStock ?? 0),
      preferredSupplier: input.preferredSupplier ?? null,
      preferredSupplierId: input.preferredSupplierId ?? null,
      leadTimeDays: input.leadTimeDays ?? 0,
      isActive: input.isActive ?? true,
      updatedByUserId: userId,
    },
    update: {
      minQuantity: new Prisma.Decimal(input.minQuantity ?? 0),
      reorderPoint: new Prisma.Decimal(input.reorderPoint),
      targetQuantity: new Prisma.Decimal(input.targetQuantity),
      safetyStock: new Prisma.Decimal(input.safetyStock ?? 0),
      preferredSupplier: input.preferredSupplier ?? null,
      preferredSupplierId: input.preferredSupplierId ?? null,
      leadTimeDays: input.leadTimeDays ?? 0,
      isActive: input.isActive ?? true,
      updatedByUserId: userId,
    },
    include: {
      product: { select: { id: true, sku: true, name: true } },
      branch: { select: { id: true, code: true, name: true } },
      preferredSupplierRef: { select: { id: true, name: true } },
    },
  });

  await logAuditEvent({
    actorUserId: userId,
    branchId: input.branchId,
    module: "reorder",
    action: "POLICY_UPSERTED",
    entityType: "StockReorderPolicy",
    entityId: policy.id,
    metadataJson: {
      productId: input.productId,
      reorderPoint: input.reorderPoint,
      targetQuantity: input.targetQuantity,
    },
  });

  return policy;
}

export async function bulkUpsertReorderPolicies(inputs: UpsertPolicyInput[], userId: string) {
  let count = 0;
  await prisma.$transaction(async (tx) => {
    for (const input of inputs) {
      if (input.targetQuantity <= input.reorderPoint) continue;
      await tx.stockReorderPolicy.upsert({
        where: {
          branchId_productId: { branchId: input.branchId, productId: input.productId },
        },
        create: {
          branchId: input.branchId,
          productId: input.productId,
          minQuantity: new Prisma.Decimal(input.minQuantity ?? 0),
          reorderPoint: new Prisma.Decimal(input.reorderPoint),
          targetQuantity: new Prisma.Decimal(input.targetQuantity),
          safetyStock: new Prisma.Decimal(input.safetyStock ?? 0),
          preferredSupplier: input.preferredSupplier ?? null,
          preferredSupplierId: input.preferredSupplierId ?? null,
          leadTimeDays: input.leadTimeDays ?? 0,
          isActive: input.isActive ?? true,
          updatedByUserId: userId,
        },
        update: {
          minQuantity: new Prisma.Decimal(input.minQuantity ?? 0),
          reorderPoint: new Prisma.Decimal(input.reorderPoint),
          targetQuantity: new Prisma.Decimal(input.targetQuantity),
          safetyStock: new Prisma.Decimal(input.safetyStock ?? 0),
          preferredSupplier: input.preferredSupplier ?? null,
          preferredSupplierId: input.preferredSupplierId ?? null,
          leadTimeDays: input.leadTimeDays ?? 0,
          isActive: input.isActive ?? true,
          updatedByUserId: userId,
        },
      });
      count++;
    }
  });

  await logAuditEvent({
    actorUserId: userId,
    module: "reorder",
    action: "POLICIES_BULK_UPSERTED",
    entityType: "StockReorderPolicy",
    entityId: "bulk",
    metadataJson: { count },
  });

  return count;
}

/* ════════════════════════════════════════════════════════════════
 *  ALERTS — List, count, dismiss
 * ════════════════════════════════════════════════════════════════ */

export async function listReorderAlerts(filters: {
  branchId?: string;
  status?: string;
  alertType?: string;
  productId?: string;
  limit?: number;
  offset?: number;
}) {
  const where: Prisma.ReorderAlertWhereInput = {};
  if (filters.branchId) where.branchId = filters.branchId;
  if (filters.status) where.status = filters.status as ReorderAlertStatus;
  if (filters.alertType) where.alertType = filters.alertType as ReorderAlertType;
  if (filters.productId) where.productId = filters.productId;

  return prisma.reorderAlert.findMany({
    where,
    include: {
      product: { select: { id: true, sku: true, name: true, unit: true } },
      branch: { select: { id: true, code: true, name: true } },
      sourceBranch: { select: { id: true, code: true, name: true } },
    },
    orderBy: { createdAt: "desc" },
    take: filters.limit ?? 100,
    skip: filters.offset ?? 0,
  });
}

export async function getReorderAlertCounts() {
  const [totalOpen, byBranch] = await Promise.all([
    prisma.reorderAlert.count({ where: { status: "OPEN" } }),
    prisma.reorderAlert.groupBy({
      by: ["branchId"],
      where: { status: "OPEN" },
      _count: { _all: true },
    }),
  ]);

  // Resolve branch names
  const branchIds = byBranch.map((g) => g.branchId);
  const branches = branchIds.length > 0
    ? await prisma.branch.findMany({
        where: { id: { in: branchIds } },
        select: { id: true, code: true, name: true },
      })
    : [];
  const branchMap = new Map(branches.map((b) => [b.id, b]));

  return {
    totalOpen,
    byBranch: byBranch.map((g) => ({
      branchId: g.branchId,
      branchCode: branchMap.get(g.branchId)?.code ?? "",
      branchName: branchMap.get(g.branchId)?.name ?? "",
      openAlerts: g._count._all,
    })),
  };
}


/* ════════════════════════════════════════════════════════════════
 *  CONVERT — Alert → PurchaseOrder or Transfer
 * ════════════════════════════════════════════════════════════════ */

/**
 * @deprecated Migrado a Reposición v2 — convertir un Plan (`replenishment-draft-service.ts`)
 * agrupa por proveedor real y usa el último costo de compra sin IVA. Ya no se invoca
 * desde ninguna ruta (el endpoint responde 410). Se conserva únicamente porque
 * `brain/actions/execute-decision.ts` aún puede resolver decisiones históricas
 * persistidas antes de la migración sin lanzar un error no controlado.
 */
export async function convertAlertToPurchaseOrder(alertId: string, userId: string) {
  const alert = await prisma.reorderAlert.findUnique({
    where: { id: alertId },
    include: {
      product: { select: { id: true, sku: true, name: true } },
      branch: { select: { id: true, code: true, name: true } },
    },
  });

  if (!alert) throw new Error("NOT_FOUND");
  if (alert.status === "CONVERTED_TO_PURCHASE_ORDER" && alert.linkedPurchaseOrderId) {
    const purchaseOrder = await prisma.purchaseOrder.findUniqueOrThrow({ where: { id: alert.linkedPurchaseOrderId } });
    return { alert, purchaseOrder };
  }
  if (alert.status !== "OPEN") throw new Error("INVALID_INPUT: Solo se pueden convertir alertas abiertas");

  // Get current WAC for cost estimate
  const balance = await prisma.inventoryBalance.findUnique({
    where: { branchId_productId: { branchId: alert.branchId, productId: alert.productId } },
  });
  const unitCost = balance ? Number(balance.weightedAverageCost) : 0;

  // Auditoría 2026-07-22 (ALTO Transversal): crear el PO y marcar la alerta
  // como convertida iban sueltos, sin transacción — si el proceso fallaba
  // entre ambos pasos, la alerta seguía OPEN con un PO ya creado, y un
  // reintento (Brain puede reprocesar decisiones atascadas) creaba un
  // SEGUNDO PO duplicado para la misma necesidad. Una sola transacción, con
  // updateMany guardado por status (Opción A) para además blindar contra una
  // conversión concurrente del mismo alertId.
  const { po, updatedAlert } = await prisma.$transaction(async (tx) => {
    const createdPo = await createPurchaseOrder({
      userId,
      branchId: alert.branchId,
      supplier: alert.preferredSupplier ?? undefined,
      notes: `[Reposición] ${alert.reason}`,
      lines: [{
        productId: alert.productId,
        quantity: Number(alert.suggestedQuantity),
        unitCost,
      }],
    }, tx);

    const transition = await tx.reorderAlert.updateMany({
      where: { id: alertId, status: "OPEN" },
      data: {
        status: "CONVERTED_TO_PURCHASE_ORDER",
        linkedPurchaseOrderId: createdPo.id,
        resolvedAt: new Date(),
        resolvedByUserId: userId,
      },
    });
    if (transition.count === 0) {
      throw new Error("ALERT_ALREADY_CONVERTED");
    }

    const alertAfter = await tx.reorderAlert.findUniqueOrThrow({ where: { id: alertId } });
    return { po: createdPo, updatedAlert: alertAfter };
  });

  await logAuditEvent({
    actorUserId: userId,
    branchId: alert.branchId,
    module: "reorder",
    action: "ALERT_CONVERTED_TO_PO",
    entityType: "ReorderAlert",
    entityId: alertId,
    metadataJson: {
      purchaseOrderId: po.id,
      orderNumber: po.orderNumber,
      productId: alert.productId,
      quantity: Number(alert.suggestedQuantity),
    },
  });

  return { alert: updatedAlert, purchaseOrder: po };
}

/**
 * @deprecated Migrado a Reposición v2 — ver nota en `convertAlertToPurchaseOrder`.
 */
export async function convertAlertToTransfer(alertId: string, userId: string) {
  const alert = await prisma.reorderAlert.findUnique({
    where: { id: alertId },
    include: {
      product: { select: { id: true, sku: true, name: true } },
      branch: { select: { id: true, code: true, name: true } },
      sourceBranch: { select: { id: true, code: true, name: true } },
    },
  });

  if (!alert) throw new Error("NOT_FOUND");
  if (alert.status === "CONVERTED_TO_TRANSFER" && alert.linkedTransferId) {
    const transfer = await prisma.transfer.findUniqueOrThrow({ where: { id: alert.linkedTransferId } });
    return { alert, transfer };
  }
  if (alert.status !== "OPEN") throw new Error("INVALID_INPUT: Solo se pueden convertir alertas abiertas");
  if (!alert.nearestSourceBranchId) throw new Error("INVALID_INPUT: Esta alerta no tiene sucursal origen para transferencia");

  // Verify source still has stock
  const sourceBalance = await prisma.inventoryBalance.findUnique({
    where: {
      branchId_productId: {
        branchId: alert.nearestSourceBranchId,
        productId: alert.productId,
      },
    },
  });

  const availableStock = sourceBalance ? Number(sourceBalance.quantityOnHand) : 0;
  const requestedQty = Number(alert.suggestedQuantity);

  // Adjust quantity if source no longer has enough
  const finalQty = Math.min(requestedQty, availableStock);
  if (finalQty <= 0) {
    throw new Error("INVALID_INPUT: La sucursal origen ya no tiene stock disponible para transferir");
  }

  // Auditoría 2026-07-22 (ALTO Transversal): ver nota en
  // convertAlertToPurchaseOrder — mismo fix, misma razón.
  const { transfer, updatedAlert } = await prisma.$transaction(async (tx) => {
    const createdTransfer = await createTransfer({
      userId,
      fromBranchId: alert.nearestSourceBranchId!,
      toBranchId: alert.branchId,
      notes: `[Reposición] ${alert.reason}`,
      lines: [{
        productId: alert.productId,
        quantity: finalQty,
      }],
    }, tx);

    const transition = await tx.reorderAlert.updateMany({
      where: { id: alertId, status: "OPEN" },
      data: {
        status: "CONVERTED_TO_TRANSFER",
        linkedTransferId: createdTransfer.id,
        resolvedAt: new Date(),
        resolvedByUserId: userId,
      },
    });
    if (transition.count === 0) {
      throw new Error("ALERT_ALREADY_CONVERTED");
    }

    const alertAfter = await tx.reorderAlert.findUniqueOrThrow({ where: { id: alertId } });
    return { transfer: createdTransfer, updatedAlert: alertAfter };
  });

  await logAuditEvent({
    actorUserId: userId,
    branchId: alert.branchId,
    module: "reorder",
    action: "ALERT_CONVERTED_TO_TRANSFER",
    entityType: "ReorderAlert",
    entityId: alertId,
    metadataJson: {
      transferId: transfer.id,
      transferNumber: transfer.transferNumber,
      fromBranchId: alert.nearestSourceBranchId,
      productId: alert.productId,
      requestedQty,
      finalQty,
    },
  });

  return { alert: updatedAlert, transfer };
}


/* ════════════════════════════════════════════════════════════════
 *  BATCHES — List
 * ════════════════════════════════════════════════════════════════ */

export async function listSuggestionBatches(filters: {
  branchId?: string;
  status?: string;
  suggestionType?: string;
}) {
  return prisma.reorderSuggestionBatch.findMany({
    where: {
      ...(filters.branchId ? { branchId: filters.branchId } : {}),
      ...(filters.status ? { status: filters.status as any } : {}),
      ...(filters.suggestionType ? { suggestionType: filters.suggestionType as any } : {}),
    },
    include: {
      branch: { select: { id: true, code: true, name: true } },
      sourceBranch: { select: { id: true, code: true, name: true } },
      lines: {
        include: {
          product: { select: { id: true, sku: true, name: true, unit: true } },
        },
      },
    },
    orderBy: { createdAt: "desc" },
    take: 100,
  });
}
