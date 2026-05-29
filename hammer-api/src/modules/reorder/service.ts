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
      leadTimeDays: input.leadTimeDays ?? 0,
      isActive: input.isActive ?? true,
      updatedByUserId: userId,
    },
    include: {
      product: { select: { id: true, sku: true, name: true } },
      branch: { select: { id: true, code: true, name: true } },
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

export async function dismissAlert(alertId: string, userId: string) {
  const alert = await prisma.reorderAlert.findUnique({ where: { id: alertId } });
  if (!alert) throw new Error("NOT_FOUND");
  if (alert.status !== "OPEN") throw new Error("INVALID_INPUT: Solo se pueden descartar alertas abiertas");

  const updated = await prisma.reorderAlert.update({
    where: { id: alertId },
    data: {
      status: "DISMISSED",
      resolvedAt: new Date(),
      resolvedByUserId: userId,
    },
  });

  await logAuditEvent({
    actorUserId: userId,
    branchId: alert.branchId,
    module: "reorder",
    action: "ALERT_DISMISSED",
    entityType: "ReorderAlert",
    entityId: alertId,
    metadataJson: { productId: alert.productId, alertType: alert.alertType },
  });

  return updated;
}

/* ════════════════════════════════════════════════════════════════
 *  EVALUATE — Main scanning algorithm
 * ════════════════════════════════════════════════════════════════ */

type EvaluationResult = {
  alertsCreated: number;
  batchesCreated: number;
  skippedDuplicates: number;
};

export async function evaluateReorderNeeds(params?: { branchId?: string }): Promise<EvaluationResult> {
  // 1. Get all active policies (filtered by branch if specified)
  const policies = await prisma.stockReorderPolicy.findMany({
    where: {
      isActive: true,
      ...(params?.branchId ? { branchId: params.branchId } : {}),
    },
    include: {
      product: { select: { id: true, sku: true, name: true } },
      branch: { select: { id: true, code: true, name: true } },
    },
  });

  if (policies.length === 0) return { alertsCreated: 0, batchesCreated: 0, skippedDuplicates: 0 };

  // 2. Batch-load inventory balances for all (branch, product) pairs
  const balancePairs = policies.map((p) => ({ branchId: p.branchId, productId: p.productId }));
  const allBranchIds = [...new Set(policies.map((p) => p.branchId))];
  const allProductIds = [...new Set(policies.map((p) => p.productId))];

  const balances = await prisma.inventoryBalance.findMany({
    where: {
      productId: { in: allProductIds },
      branchId: { in: allBranchIds },
    },
  });
  const balanceMap = new Map(
    balances.map((b) => [`${b.branchId}:${b.productId}`, b]),
  );

  // 3. Load ALL balances for these products across ALL branches (for surplus detection)
  const allBalancesForProducts = await prisma.inventoryBalance.findMany({
    where: { productId: { in: allProductIds } },
    include: { branch: { select: { id: true, code: true, name: true, isActive: true } } },
  });

  // 4. Load existing OPEN alerts to avoid duplicates
  const existingOpenAlerts = await prisma.reorderAlert.findMany({
    where: {
      status: "OPEN",
      productId: { in: allProductIds },
      branchId: { in: allBranchIds },
    },
    select: { branchId: true, productId: true },
  });
  const openAlertSet = new Set(
    existingOpenAlerts.map((a) => `${a.branchId}:${a.productId}`),
  );

  // 5. Load all policies for surplus check (need targetQuantity per branch per product)
  const allPolicies = await prisma.stockReorderPolicy.findMany({
    where: { isActive: true, productId: { in: allProductIds } },
    select: { branchId: true, productId: true, targetQuantity: true },
  });
  const policyMap = new Map(
    allPolicies.map((p) => [`${p.branchId}:${p.productId}`, p]),
  );

  // 6. Evaluate each policy
  type AlertData = {
    branchId: string;
    branchCode: string;
    productId: string;
    productName: string;
    currentQuantity: Prisma.Decimal;
    reorderPoint: Prisma.Decimal;
    targetQuantity: Prisma.Decimal;
    suggestedQuantity: Prisma.Decimal;
    alertType: ReorderAlertType;
    nearestSourceBranchId: string | null;
    nearestSourceStock: Prisma.Decimal | null;
    preferredSupplier: string | null;
    reason: string;
    wac: Prisma.Decimal;
  };

  const alertsToCreate: AlertData[] = [];
  let skippedDuplicates = 0;

  for (const policy of policies) {
    const key = `${policy.branchId}:${policy.productId}`;

    // Skip if OPEN alert already exists
    if (openAlertSet.has(key)) {
      skippedDuplicates++;
      continue;
    }

    const balance = balanceMap.get(key);
    const currentQty = balance?.quantityOnHand ?? new Prisma.Decimal(0);
    const wac = balance?.weightedAverageCost ?? new Prisma.Decimal(0);

    // Skip if stock is above reorder point
    if (currentQty.gt(policy.reorderPoint)) continue;

    // Calculate suggested quantity
    const target = policy.targetQuantity.add(policy.safetyStock);
    const suggested = Prisma.Decimal.max(target.sub(currentQty), new Prisma.Decimal(0));
    if (suggested.lte(new Prisma.Decimal(0))) continue;

    // Search other branches for surplus
    const productBalancesOtherBranches = allBalancesForProducts.filter(
      (b) => b.productId === policy.productId && b.branchId !== policy.branchId && b.branch.isActive,
    );

    let nearestSourceBranchId: string | null = null;
    let nearestSourceStock: Prisma.Decimal | null = null;
    let alertType: ReorderAlertType = "PURCHASE";

    // Find branch with most surplus
    const surplusBranches = productBalancesOtherBranches
      .map((b) => {
        const otherPolicy = policyMap.get(`${b.branchId}:${b.productId}`);
        const otherTarget = otherPolicy?.targetQuantity ?? new Prisma.Decimal(0);
        const surplus = b.quantityOnHand.sub(otherTarget);
        return { branchId: b.branchId, branchCode: b.branch.code, stock: b.quantityOnHand, surplus };
      })
      .filter((b) => b.surplus.gt(new Prisma.Decimal(0)))
      .sort((a, b) => (b.surplus.gt(a.surplus) ? 1 : -1));

    if (surplusBranches.length > 0) {
      const best = surplusBranches[0];
      nearestSourceBranchId = best.branchId;
      nearestSourceStock = best.stock;

      if (best.surplus.gte(suggested)) {
        alertType = "TRANSFER";
      } else {
        alertType = "BOTH";
      }
    }

    // Build reason text
    let reason: string;
    const currentNum = currentQty.toFixed(0);
    const reorderNum = policy.reorderPoint.toFixed(0);
    const prodName = policy.product.name;

    if (alertType === "TRANSFER" && nearestSourceBranchId) {
      const srcCode = surplusBranches[0].branchCode;
      const srcStock = nearestSourceStock!.toFixed(0);
      reason = `${prodName}: stock (${currentNum}) bajo punto de reorden (${reorderNum}). ${srcCode} tiene ${srcStock} uds. disponibles para transferir.`;
    } else if (alertType === "BOTH" && nearestSourceBranchId) {
      const srcCode = surplusBranches[0].branchCode;
      const srcStock = nearestSourceStock!.toFixed(0);
      reason = `${prodName}: stock (${currentNum}) bajo punto de reorden (${reorderNum}). ${srcCode} tiene ${srcStock} uds. (parcial). Se requiere compra adicional.`;
    } else {
      reason = `${prodName}: stock (${currentNum}) bajo punto de reorden (${reorderNum}). No hay stock disponible en otras sucursales.`;
    }

    alertsToCreate.push({
      branchId: policy.branchId,
      branchCode: policy.branch.code,
      productId: policy.productId,
      productName: policy.product.name,
      currentQuantity: currentQty,
      reorderPoint: policy.reorderPoint,
      targetQuantity: policy.targetQuantity,
      suggestedQuantity: suggested,
      alertType,
      nearestSourceBranchId,
      nearestSourceStock,
      preferredSupplier: policy.preferredSupplier,
      reason,
      wac,
    });
  }

  if (alertsToCreate.length === 0) {
    return { alertsCreated: 0, batchesCreated: 0, skippedDuplicates };
  }

  // 7. Create alerts and group into batches inside a transaction
  let batchesCreated = 0;

  await prisma.$transaction(async (tx) => {
    // Create all alerts
    const createdAlerts: { id: string; data: AlertData }[] = [];
    for (const ad of alertsToCreate) {
      const alert = await tx.reorderAlert.create({
        data: {
          branchId: ad.branchId,
          productId: ad.productId,
          currentQuantity: ad.currentQuantity,
          reorderPoint: ad.reorderPoint,
          targetQuantity: ad.targetQuantity,
          suggestedQuantity: ad.suggestedQuantity,
          alertType: ad.alertType,
          nearestSourceBranchId: ad.nearestSourceBranchId,
          nearestSourceStock: ad.nearestSourceStock,
          preferredSupplier: ad.preferredSupplier,
          reason: ad.reason,
        },
      });
      createdAlerts.push({ id: alert.id, data: ad });
    }

    // Group PURCHASE alerts by (branchId, preferredSupplier)
    const purchaseGroups = new Map<string, typeof createdAlerts>();
    // Group TRANSFER alerts by (branchId, nearestSourceBranchId)
    const transferGroups = new Map<string, typeof createdAlerts>();

    for (const ca of createdAlerts) {
      if (ca.data.alertType === "PURCHASE" || ca.data.alertType === "BOTH") {
        const key = `${ca.data.branchId}:${ca.data.preferredSupplier ?? "__none__"}`;
        if (!purchaseGroups.has(key)) purchaseGroups.set(key, []);
        purchaseGroups.get(key)!.push(ca);
      }
      if (ca.data.alertType === "TRANSFER" || ca.data.alertType === "BOTH") {
        if (ca.data.nearestSourceBranchId) {
          const key = `${ca.data.branchId}:${ca.data.nearestSourceBranchId}`;
          if (!transferGroups.has(key)) transferGroups.set(key, []);
          transferGroups.get(key)!.push(ca);
        }
      }
    }

    // Create PURCHASE batches
    for (const [, alerts] of purchaseGroups) {
      const first = alerts[0].data;
      let totalCost = new Prisma.Decimal(0);
      for (const a of alerts) {
        totalCost = totalCost.add(a.data.suggestedQuantity.mul(a.data.wac));
      }

      await tx.reorderSuggestionBatch.create({
        data: {
          branchId: first.branchId,
          supplier: first.preferredSupplier,
          suggestionType: "PURCHASE",
          totalEstimatedCost: totalCost,
          lines: {
            create: alerts.map((a) => ({
              alertId: a.id,
              productId: a.data.productId,
              currentQuantity: a.data.currentQuantity,
              suggestedQuantity: a.data.suggestedQuantity,
              unitCostSnapshot: a.data.wac,
            })),
          },
        },
      });
      batchesCreated++;
    }

    // Create TRANSFER batches
    for (const [, alerts] of transferGroups) {
      const first = alerts[0].data;
      let totalCost = new Prisma.Decimal(0);
      for (const a of alerts) {
        totalCost = totalCost.add(a.data.suggestedQuantity.mul(a.data.wac));
      }

      await tx.reorderSuggestionBatch.create({
        data: {
          branchId: first.branchId,
          sourceBranchId: first.nearestSourceBranchId!,
          suggestionType: "TRANSFER",
          totalEstimatedCost: totalCost,
          lines: {
            create: alerts.map((a) => ({
              alertId: a.id,
              productId: a.data.productId,
              currentQuantity: a.data.currentQuantity,
              suggestedQuantity: a.data.suggestedQuantity,
              unitCostSnapshot: a.data.wac,
              sourceBranchId: a.data.nearestSourceBranchId,
            })),
          },
        },
      });
      batchesCreated++;
    }
  });

  // Audit (outside tx — never blocks main flow)
  try {
    await logAuditEvent({
      module: "reorder",
      action: "REORDER_EVALUATION_RUN",
      entityType: "ReorderEvaluation",
      entityId: new Date().toISOString(),
      metadataJson: {
        alertsCreated: alertsToCreate.length,
        batchesCreated,
        skippedDuplicates,
        branchId: params?.branchId ?? "all",
      },
    });
  } catch {
    // Audit failures never block main flow
  }

  return {
    alertsCreated: alertsToCreate.length,
    batchesCreated,
    skippedDuplicates,
  };
}

/* ════════════════════════════════════════════════════════════════
 *  CONVERT — Alert → PurchaseOrder or Transfer
 * ════════════════════════════════════════════════════════════════ */

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

  // Create PO via existing service
  const po = await createPurchaseOrder({
    userId,
    branchId: alert.branchId,
    supplier: alert.preferredSupplier ?? undefined,
    notes: `[Reposición] ${alert.reason}`,
    lines: [{
      productId: alert.productId,
      quantity: Number(alert.suggestedQuantity),
      unitCost,
    }],
  });

  // Update alert status
  const updatedAlert = await prisma.reorderAlert.update({
    where: { id: alertId },
    data: {
      status: "CONVERTED_TO_PURCHASE_ORDER",
      linkedPurchaseOrderId: po.id,
      resolvedAt: new Date(),
      resolvedByUserId: userId,
    },
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

  // Create Transfer via existing service
  const transfer = await createTransfer({
    userId,
    fromBranchId: alert.nearestSourceBranchId,
    toBranchId: alert.branchId,
    notes: `[Reposición] ${alert.reason}`,
    lines: [{
      productId: alert.productId,
      quantity: finalQty,
    }],
  });

  // Update alert status
  const updatedAlert = await prisma.reorderAlert.update({
    where: { id: alertId },
    data: {
      status: "CONVERTED_TO_TRANSFER",
      linkedTransferId: transfer.id,
      resolvedAt: new Date(),
      resolvedByUserId: userId,
    },
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
 *  BATCH CONVERT — Convert entire suggestion batch
 * ════════════════════════════════════════════════════════════════ */

export async function convertBatchToPurchaseOrder(batchId: string, userId: string) {
  const batch = await prisma.reorderSuggestionBatch.findUnique({
    where: { id: batchId },
    include: {
      lines: {
        include: {
          product: { select: { id: true, sku: true, name: true } },
        },
      },
      branch: { select: { id: true, code: true, name: true } },
    },
  });

  if (!batch) throw new Error("NOT_FOUND");
  if (batch.status !== "DRAFT") throw new Error("INVALID_INPUT: Solo se pueden convertir lotes en estado borrador");
  if (batch.suggestionType !== "PURCHASE") throw new Error("INVALID_INPUT: Este lote no es de tipo compra");
  if (batch.lines.length === 0) throw new Error("INVALID_INPUT: El lote no tiene líneas");

  // Get WAC for each product
  const productIds = batch.lines.map((l) => l.productId);
  const balances = await prisma.inventoryBalance.findMany({
    where: { branchId: batch.branchId, productId: { in: productIds } },
  });
  const wacMap = new Map(balances.map((b) => [b.productId, Number(b.weightedAverageCost)]));

  const po = await createPurchaseOrder({
    userId,
    branchId: batch.branchId,
    supplier: batch.supplier ?? undefined,
    notes: `[Reposición - Lote] Pedido generado desde lote de sugerencias`,
    lines: batch.lines.map((l) => ({
      productId: l.productId,
      quantity: Number(l.suggestedQuantity),
      unitCost: wacMap.get(l.productId) ?? (l.unitCostSnapshot ? Number(l.unitCostSnapshot) : 0),
    })),
  });

  // Update batch and linked alerts
  await prisma.$transaction(async (tx) => {
    await tx.reorderSuggestionBatch.update({
      where: { id: batchId },
      data: {
        status: "CONVERTED",
        linkedPurchaseOrderId: po.id,
        reviewedByUserId: userId,
        reviewedAt: new Date(),
      },
    });

    // Resolve linked alerts
    const alertIds = batch.lines.map((l) => l.alertId).filter((id): id is string => id !== null);
    if (alertIds.length > 0) {
      await tx.reorderAlert.updateMany({
        where: { id: { in: alertIds }, status: "OPEN" },
        data: {
          status: "CONVERTED_TO_PURCHASE_ORDER",
          linkedPurchaseOrderId: po.id,
          resolvedAt: new Date(),
          resolvedByUserId: userId,
        },
      });
    }
  });

  await logAuditEvent({
    actorUserId: userId,
    branchId: batch.branchId,
    module: "reorder",
    action: "BATCH_CONVERTED_TO_PO",
    entityType: "ReorderSuggestionBatch",
    entityId: batchId,
    metadataJson: {
      purchaseOrderId: po.id,
      orderNumber: po.orderNumber,
      linesCount: batch.lines.length,
    },
  });

  return { batch, purchaseOrder: po };
}

export async function convertBatchToTransfer(batchId: string, userId: string) {
  const batch = await prisma.reorderSuggestionBatch.findUnique({
    where: { id: batchId },
    include: {
      lines: {
        include: {
          product: { select: { id: true, sku: true, name: true } },
        },
      },
      branch: { select: { id: true, code: true, name: true } },
      sourceBranch: { select: { id: true, code: true, name: true } },
    },
  });

  if (!batch) throw new Error("NOT_FOUND");
  if (batch.status !== "DRAFT") throw new Error("INVALID_INPUT: Solo se pueden convertir lotes en estado borrador");
  if (batch.suggestionType !== "TRANSFER") throw new Error("INVALID_INPUT: Este lote no es de tipo transferencia");
  if (!batch.sourceBranchId) throw new Error("INVALID_INPUT: Lote sin sucursal origen");
  if (batch.lines.length === 0) throw new Error("INVALID_INPUT: El lote no tiene líneas");

  const transfer = await createTransfer({
    userId,
    fromBranchId: batch.sourceBranchId,
    toBranchId: batch.branchId,
    notes: `[Reposición - Lote] Transferencia generada desde lote de sugerencias`,
    lines: batch.lines.map((l) => ({
      productId: l.productId,
      quantity: Number(l.suggestedQuantity),
    })),
  });

  await prisma.$transaction(async (tx) => {
    await tx.reorderSuggestionBatch.update({
      where: { id: batchId },
      data: {
        status: "CONVERTED",
        linkedTransferId: transfer.id,
        reviewedByUserId: userId,
        reviewedAt: new Date(),
      },
    });

    const alertIds = batch.lines.map((l) => l.alertId).filter((id): id is string => id !== null);
    if (alertIds.length > 0) {
      await tx.reorderAlert.updateMany({
        where: { id: { in: alertIds }, status: "OPEN" },
        data: {
          status: "CONVERTED_TO_TRANSFER",
          linkedTransferId: transfer.id,
          resolvedAt: new Date(),
          resolvedByUserId: userId,
        },
      });
    }
  });

  await logAuditEvent({
    actorUserId: userId,
    branchId: batch.branchId,
    module: "reorder",
    action: "BATCH_CONVERTED_TO_TRANSFER",
    entityType: "ReorderSuggestionBatch",
    entityId: batchId,
    metadataJson: {
      transferId: transfer.id,
      transferNumber: transfer.transferNumber,
      fromBranchId: batch.sourceBranchId,
      linesCount: batch.lines.length,
    },
  });

  return { batch, transfer };
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
