import { DispatchStatus, Prisma, SaleOrderStatus, InventoryMovementType, PaymentMethod, PaymentStatus, CashSessionStatus } from "@prisma/client";
import { randomBytes } from "node:crypto";
import { prisma } from "@/lib/prisma";
import { logAuditEvent } from "@/modules/audit/service";
import { aggregateOrderTotals, calculateLineSubtotal } from "@/modules/sales/totals";
import { SALE_AUDIT_EVENTS } from "@/modules/sales/audit-events";
import { getBranchModuleConfig } from "@/modules/branch-config/service";
import { consumeSharedStockForSaleTx, createInventoryMovementTx, getSaleStockAvailabilityTx } from "@/modules/inventory/service";
import { ensureTransportServiceForOrderTx, resolveTransportCustomerName } from "@/modules/transport/service";
import { refreshOperationalDaySummaryTx, businessDateFromNow } from "@/modules/operations/service";
import { getEffectiveProductPricing } from "@/modules/catalog/effective-pricing";
import { getMaxDiscountPercentForRole, validateDiscountForRole } from "@/modules/sales/discount-policy";
import { resolvePolicyForProduct } from "@/modules/pricing/category-policy-service";
import { buildCommercialIntelligenceForProduct } from "@/modules/pricing/commercial-intelligence";
import { syncCashSessionSnapshotTx, userCanOperateCashSessionTx } from "@/modules/cash-session/service";

type DirectSaleTenderInput = {
  method: PaymentMethod;
  amount: number;
  receivedAmount?: number | null;
  changeAmount?: number | null;
  referenceNumber?: string | null;
};

// FIX BUG-010: Use crypto-random suffix instead of Date.now() to prevent collisions
function makeOrderNumber(branchCode: string) {
  const ts = Date.now().toString(36).toUpperCase();
  const rand = randomBytes(4).toString("hex").toUpperCase();
  return `SO-${branchCode}-${ts}-${rand}`;
}

export async function listSaleOrders(params: { branchId: string; includeAllBranches: boolean }) {
  return prisma.saleOrder.findMany({
    where: params.includeAllBranches ? {} : { branchId: params.branchId },
    include: { lines: { include: { product: { select: { id: true, name: true, sku: true } } } }, branch: true, createdBy: true },
    orderBy: { createdAt: "desc" },
    take: 100,
  });
}

// Borradores vacíos abandonados por más de este tiempo se eliminan para que no
// se acumulen en la base de datos ni afecten el rendimiento del POS.
const STALE_EMPTY_DRAFT_MS = 24 * 60 * 60 * 1000;

function saleLineCostSnapshot(input: {
  quantity: Prisma.Decimal;
  lineSubtotal: Prisma.Decimal;
  effectiveCost: Prisma.Decimal | null;
  costSource: string;
}) {
  if (input.effectiveCost === null) {
    return {
      costSnapshot: null,
      marginSnapshot: null,
      marginPercentSnapshot: null,
      costSourceSnapshot: input.costSource,
    };
  }
  const totalCost = input.effectiveCost.mul(input.quantity);
  const margin = input.lineSubtotal.sub(totalCost);
  return {
    costSnapshot: input.effectiveCost,
    marginSnapshot: margin,
    marginPercentSnapshot: input.lineSubtotal.gt(0) ? margin.div(input.lineSubtotal).mul(100) : null,
    costSourceSnapshot: input.costSource,
  };
}

/**
 * Elimina (best-effort) los borradores VACÍOS y antiguos de un usuario en una
 * sucursal. Nunca borra borradores con líneas (ventas en progreso). Es
 * tolerante a fallos: si algo sale mal, no interrumpe la apertura del POS.
 */
async function cleanupStaleEmptyDrafts(branchId: string, actorUserId: string) {
  const cutoff = new Date(Date.now() - STALE_EMPTY_DRAFT_MS);
  try {
    await prisma.saleOrder.deleteMany({
      where: {
        branchId,
        createdByUserId: actorUserId,
        status: SaleOrderStatus.DRAFT,
        createdAt: { lt: cutoff },
        lines: { none: {} },
      },
    });
  } catch (error) {
    console.error("[sales][cleanupStaleEmptyDrafts]", error);
  }
}

export async function getOrCreateActiveDraftSaleOrder(input: {
  branchId: string;
  actorUserId: string;
}) {
  const existing = await prisma.saleOrder.findFirst({
    where: {
      branchId: input.branchId,
      createdByUserId: input.actorUserId,
      status: SaleOrderStatus.DRAFT,
    },
    include: {
      lines: {
        include: {
          product: {
            select: { id: true, name: true, sku: true },
          },
        },
      },
      branch: true,
      createdBy: true,
    },
    orderBy: { createdAt: "desc" },
  });

  if (existing) {
    const isEmpty = existing.lines.length === 0;
    const isStale = existing.createdAt.getTime() < Date.now() - STALE_EMPTY_DRAFT_MS;
    // Reutiliza el borrador salvo que esté vacío y abandonado: en ese caso se
    // limpia y se entrega uno nuevo para no arrastrar basura entre días.
    if (!(isEmpty && isStale)) return existing;
  }

  await cleanupStaleEmptyDrafts(input.branchId, input.actorUserId);

  return createDraftSaleOrder({
    branchId: input.branchId,
    actorUserId: input.actorUserId,
  });
}

export async function createDraftSaleOrder(input: {
  branchId: string;
  customerId?: string | null;
  notes?: string | null;
  actorUserId: string;
}) {
  const branch = await prisma.branch.findUniqueOrThrow({ where: { id: input.branchId } });
  const operationalDay = await prisma.operationalDay.findFirst({
    where: { branchId: input.branchId, status: "OPEN" },
    orderBy: { openedAt: "desc" },
  });
  if (!operationalDay) {
    await logAuditEvent({
      actorUserId: input.actorUserId,
      branchId: input.branchId,
      module: "sales",
      action: SALE_AUDIT_EVENTS.ORDER_CREATE_DENIED,
      entityType: "SaleOrder",
      entityId: "draft",
      metadataJson: { reason: "OPERATIONAL_DAY_NOT_OPEN" },
    });
    throw new Error("OPERATIONAL_DAY_NOT_OPEN");
  }
  if (operationalDay.businessDate.getTime() !== businessDateFromNow().getTime()) {
    await logAuditEvent({
      actorUserId: input.actorUserId,
      branchId: input.branchId,
      module: "sales",
      action: SALE_AUDIT_EVENTS.ORDER_CREATE_DENIED,
      entityType: "SaleOrder",
      entityId: "draft",
      metadataJson: { reason: "OPERATIONAL_DAY_STALE", businessDate: operationalDay.businessDate },
    });
    throw new Error("OPERATIONAL_DAY_STALE");
  }

  const order = await prisma.saleOrder.create({
    data: {
      orderNumber: makeOrderNumber(branch.code),
      branchId: input.branchId,
      customerId: input.customerId ?? null,
      createdByUserId: input.actorUserId,
      status: SaleOrderStatus.DRAFT,
      subtotal: new Prisma.Decimal(0),
      discountTotal: new Prisma.Decimal(0),
      taxTotal: new Prisma.Decimal(0),
      grandTotal: new Prisma.Decimal(0),
      notes: input.notes,
    },
    include: {
      lines: {
        include: {
          product: {
            select: { id: true, name: true, sku: true },
          },
        },
      },
      branch: true,
      createdBy: true,
    },
  });

  await logAuditEvent({
    actorUserId: input.actorUserId,
    branchId: input.branchId,
    module: "sales",
    action: SALE_AUDIT_EVENTS.ORDER_CREATED,
    entityType: "SaleOrder",
    entityId: order.id,
  });

  return order;
}

async function recalcOrderTotalsTx(tx: Prisma.TransactionClient, saleOrderId: string) {
  const order = await tx.saleOrder.findUniqueOrThrow({ where: { id: saleOrderId }, select: { transportAmount: true } });
  const lines = await tx.saleOrderLine.findMany({ where: { saleOrderId } });
  const totals = aggregateOrderTotals(
    lines.map((line) => ({ lineSubtotal: line.lineSubtotal, discountAmount: line.discountAmount })),
    order.transportAmount,
  );

  return tx.saleOrder.update({
    where: { id: saleOrderId },
    data: totals,
  });
}

function effectiveDiscountLimitForAudit(input: {
  role?: string | null;
  categoryMaxDiscountPercent?: number | null;
  commercialRecommendedMaxDiscountPercent?: number | null;
}) {
  const limits = [getMaxDiscountPercentForRole(input.role)];
  if (input.categoryMaxDiscountPercent && input.categoryMaxDiscountPercent > 0) limits.push(input.categoryMaxDiscountPercent);
  if (input.commercialRecommendedMaxDiscountPercent !== null && input.commercialRecommendedMaxDiscountPercent !== undefined) limits.push(input.commercialRecommendedMaxDiscountPercent);
  return Math.min(...limits);
}

export async function addSaleOrderLine(input: {
  saleOrderId: string;
  productId: string;
  quantity: number;
  unitPrice?: number;
  discountAmount: number;
  actorUserId: string;
  actorRole?: string;
  overrideReason?: string | null;
}) {
  return prisma.$transaction(async (tx) => {
    const order = await tx.saleOrder.findUniqueOrThrow({ where: { id: input.saleOrderId } });
    if (order.status !== SaleOrderStatus.DRAFT) throw new Error("ORDER_NOT_DRAFT");

    const product = await tx.product.findUniqueOrThrow({ where: { id: input.productId } });
    if (!product.isActive) throw new Error("PRODUCT_INACTIVE");

    const pricing = await getEffectiveProductPricing(tx, { branchId: order.branchId, productId: input.productId });
    const categoryPolicy = await resolvePolicyForProduct({ branchId: order.branchId, productId: input.productId });
    const commercialIntelligence = await buildCommercialIntelligenceForProduct({ branchId: order.branchId, productId: input.productId });
    const priceSource = input.unitPrice === undefined ? pricing.priceSource : "MANUAL";
    const quantity = new Prisma.Decimal(input.quantity);
    const unitPrice = input.unitPrice === undefined ? pricing.effectivePrice : new Prisma.Decimal(input.unitPrice);
    const discountAmount = new Prisma.Decimal(input.discountAmount);
    const discountPerUnit = discountAmount.div(quantity);
    const netUnitPriceAfterDiscount = unitPrice.sub(discountPerUnit);
    const discountPercent = unitPrice.gt(0) ? discountPerUnit.div(unitPrice).mul(100) : new Prisma.Decimal(0);
    const policy = validateDiscountForRole({
      role: input.actorRole,
      discountPercent,
      effectiveCost: pricing.effectiveCost,
      netUnitPriceAfterDiscount,
      overrideReason: input.overrideReason,
      categoryId: categoryPolicy.categoryId,
      categoryName: categoryPolicy.categoryName,
      categoryMaxDiscountPercent: categoryPolicy.categoryPolicy.maxDiscountPercent,
      commercialRecommendedMaxDiscountPercent: commercialIntelligence.recommendedMaxDiscountPercent,
      combinedClass: commercialIntelligence.combinedClass,
      riskLevel: commercialIntelligence.riskLevel,
    });

    if (!policy.allowed) {
      await tx.auditLog.create({
        data: {
          actorUserId: input.actorUserId,
          branchId: order.branchId,
          module: "sales",
          action: SALE_AUDIT_EVENTS.ORDER_LINE_MUTATION_DENIED,
          entityType: "SaleOrder",
          entityId: input.saleOrderId,
          metadataJson: {
            reason: policy.code,
            productId: input.productId,
            effectiveCost: pricing.effectiveCost?.toString() ?? null,
            netUnitPriceAfterDiscount: netUnitPriceAfterDiscount.toString(),
            userRole: input.actorRole ?? null,
            overrideReason: input.overrideReason ?? null,
            priceSource: pricing.priceSource,
            costSource: pricing.costSource,
            discountPercent: discountPercent.toString(),
            roleMaxDiscountPercent: getMaxDiscountPercentForRole(input.actorRole),
            categoryMaxDiscountPercent: categoryPolicy.categoryPolicy.maxDiscountPercent,
            commercialRecommendedMaxDiscountPercent: commercialIntelligence.recommendedMaxDiscountPercent,
            effectiveMaxDiscountPercent: effectiveDiscountLimitForAudit({
              role: input.actorRole,
              categoryMaxDiscountPercent: categoryPolicy.categoryPolicy.maxDiscountPercent,
              commercialRecommendedMaxDiscountPercent: commercialIntelligence.recommendedMaxDiscountPercent,
            }),
            combinedClass: commercialIntelligence.combinedClass,
            riskLevel: commercialIntelligence.riskLevel,
            categoryId: categoryPolicy.categoryId,
            categoryName: categoryPolicy.categoryName,
          },
        },
      });
      const error = new Error(policy.code);
      (error as any).details = {
        effectiveCost: pricing.effectiveCost === null ? null : Number(pricing.effectiveCost),
        netUnitPriceAfterDiscount: Number(netUnitPriceAfterDiscount),
      };
      throw error;
    }

    const lineSubtotal = calculateLineSubtotal(quantity, unitPrice, discountAmount);
    const snapshots = saleLineCostSnapshot({
      quantity,
      lineSubtotal,
      effectiveCost: pricing.effectiveCost,
      costSource: pricing.costSource,
    });

    const line = await tx.saleOrderLine.create({
      data: {
        saleOrderId: input.saleOrderId,
        productId: input.productId,
        quantity,
        unitPrice,
        discountAmount,
        lineSubtotal,
        ...snapshots,
      },
    });

    const orderUpdated = await recalcOrderTotalsTx(tx, input.saleOrderId);

    await tx.auditLog.create({
      data: {
        actorUserId: input.actorUserId,
        branchId: order.branchId,
        module: "sales",
        action: SALE_AUDIT_EVENTS.ORDER_LINE_ADDED,
        entityType: "SaleOrderLine",
        entityId: line.id,
        metadataJson: {
          saleOrderId: input.saleOrderId,
          productId: input.productId,
          priceSource,
          standardSalePrice: pricing.standardSalePrice.toString(),
          branchPrice: pricing.branchPrice?.toString() ?? null,
          effectivePrice: pricing.effectivePrice.toString(),
          effectiveCost: pricing.effectiveCost?.toString() ?? null,
          costSource: pricing.costSource,
          marginSnapshot: snapshots.marginSnapshot?.toString() ?? null,
          marginPercentSnapshot: snapshots.marginPercentSnapshot?.toString() ?? null,
          netUnitPriceAfterDiscount: netUnitPriceAfterDiscount.toString(),
          discountPercent: discountPercent.toString(),
          overrideReason: input.overrideReason ?? null,
          policyWarnings: policy.warnings,
          commercialIntelligence: {
            combinedClass: commercialIntelligence.combinedClass,
            riskLevel: commercialIntelligence.riskLevel,
            recommendedMaxDiscountPercent: commercialIntelligence.recommendedMaxDiscountPercent,
          },
        },
      },
    });

    return { line, order: orderUpdated };
  });
}

export async function updateSaleOrderLine(input: {
  saleOrderId: string;
  lineId: string;
  quantity?: number;
  unitPrice?: number;
  discountAmount?: number;
  discountPercent?: number;
  actorUserId: string;
  actorRole?: string;
  overrideReason?: string | null;
}) {
  return prisma.$transaction(async (tx) => {
    const order = await tx.saleOrder.findUniqueOrThrow({ where: { id: input.saleOrderId } });
    if (order.status !== SaleOrderStatus.DRAFT) throw new Error("ORDER_NOT_DRAFT");

    const existing = await tx.saleOrderLine.findFirst({
      where: { id: input.lineId, saleOrderId: input.saleOrderId },
    });

    if (!existing) {
      await tx.auditLog.create({
        data: {
          actorUserId: input.actorUserId,
          branchId: order.branchId,
          module: "sales",
          action: SALE_AUDIT_EVENTS.ORDER_LINE_MUTATION_DENIED,
          entityType: "SaleOrderLine",
          entityId: input.lineId,
          metadataJson: {
            reason: "LINE_NOT_IN_ORDER",
            saleOrderId: input.saleOrderId,
          },
        },
      });
      throw new Error("SALE_ORDER_LINE_NOT_FOUND");
    }

    const quantity = new Prisma.Decimal(input.quantity ?? existing.quantity);
    const unitPrice = new Prisma.Decimal(input.unitPrice ?? existing.unitPrice);
    const discountAmount = input.discountPercent !== undefined && input.discountAmount === undefined
      ? unitPrice.mul(quantity).mul(input.discountPercent).div(100)
      : new Prisma.Decimal(input.discountAmount ?? existing.discountAmount);
    const pricing = await getEffectiveProductPricing(tx, { branchId: order.branchId, productId: existing.productId });
    const categoryPolicy = await resolvePolicyForProduct({ branchId: order.branchId, productId: existing.productId });
    const commercialIntelligence = await buildCommercialIntelligenceForProduct({ branchId: order.branchId, productId: existing.productId });
    const discountPerUnit = discountAmount.div(quantity);
    const netUnitPriceAfterDiscount = unitPrice.sub(discountPerUnit);
    const discountPercent = unitPrice.gt(0) ? discountPerUnit.div(unitPrice).mul(100) : new Prisma.Decimal(0);
    const policy = validateDiscountForRole({
      role: input.actorRole,
      discountPercent,
      effectiveCost: pricing.effectiveCost,
      netUnitPriceAfterDiscount,
      overrideReason: input.overrideReason,
      categoryId: categoryPolicy.categoryId,
      categoryName: categoryPolicy.categoryName,
      categoryMaxDiscountPercent: categoryPolicy.categoryPolicy.maxDiscountPercent,
      commercialRecommendedMaxDiscountPercent: commercialIntelligence.recommendedMaxDiscountPercent,
      combinedClass: commercialIntelligence.combinedClass,
      riskLevel: commercialIntelligence.riskLevel,
    });
    if (!policy.allowed) {
      await tx.auditLog.create({
        data: {
          actorUserId: input.actorUserId,
          branchId: order.branchId,
          module: "sales",
          action: SALE_AUDIT_EVENTS.ORDER_LINE_MUTATION_DENIED,
          entityType: "SaleOrderLine",
          entityId: input.lineId,
          metadataJson: {
            reason: policy.code,
            effectiveCost: pricing.effectiveCost?.toString() ?? null,
            netUnitPriceAfterDiscount: netUnitPriceAfterDiscount.toString(),
            userRole: input.actorRole ?? null,
            overrideReason: input.overrideReason ?? null,
            priceSource: pricing.priceSource,
            costSource: pricing.costSource,
            discountPercent: discountPercent.toString(),
            roleMaxDiscountPercent: getMaxDiscountPercentForRole(input.actorRole),
            categoryMaxDiscountPercent: categoryPolicy.categoryPolicy.maxDiscountPercent,
            commercialRecommendedMaxDiscountPercent: commercialIntelligence.recommendedMaxDiscountPercent,
            effectiveMaxDiscountPercent: effectiveDiscountLimitForAudit({
              role: input.actorRole,
              categoryMaxDiscountPercent: categoryPolicy.categoryPolicy.maxDiscountPercent,
              commercialRecommendedMaxDiscountPercent: commercialIntelligence.recommendedMaxDiscountPercent,
            }),
            combinedClass: commercialIntelligence.combinedClass,
            riskLevel: commercialIntelligence.riskLevel,
            categoryId: categoryPolicy.categoryId,
            categoryName: categoryPolicy.categoryName,
          },
        },
      });
      const error = new Error(policy.code);
      (error as any).details = {
        effectiveCost: pricing.effectiveCost === null ? null : Number(pricing.effectiveCost),
        netUnitPriceAfterDiscount: Number(netUnitPriceAfterDiscount),
      };
      throw error;
    }

    const lineSubtotal = calculateLineSubtotal(quantity, unitPrice, discountAmount);
    const snapshots = saleLineCostSnapshot({
      quantity,
      lineSubtotal,
      effectiveCost: pricing.effectiveCost,
      costSource: pricing.costSource,
    });

    const updated = await tx.saleOrderLine.update({
      where: { id: existing.id },
      data: { quantity, unitPrice, discountAmount, lineSubtotal, ...snapshots },
    });

    const orderUpdated = await recalcOrderTotalsTx(tx, input.saleOrderId);

    await tx.auditLog.create({
      data: {
        actorUserId: input.actorUserId,
        branchId: order.branchId,
        module: "sales",
        action: SALE_AUDIT_EVENTS.ORDER_LINE_UPDATED,
        entityType: "SaleOrderLine",
        entityId: updated.id,
        metadataJson: {
          saleOrderId: input.saleOrderId,
          previous: {
            quantity: existing.quantity.toString(),
            unitPrice: existing.unitPrice.toString(),
            discountAmount: existing.discountAmount.toString(),
          },
          current: {
            quantity: updated.quantity.toString(),
            unitPrice: updated.unitPrice.toString(),
            discountAmount: updated.discountAmount.toString(),
            costSnapshot: updated.costSnapshot?.toString() ?? null,
            marginSnapshot: updated.marginSnapshot?.toString() ?? null,
            marginPercentSnapshot: updated.marginPercentSnapshot?.toString() ?? null,
            costSourceSnapshot: updated.costSourceSnapshot,
          },
        },
      },
    });

    return { line: updated, order: orderUpdated };
  });
}

export async function updateSaleOrderNotes(input: {
  saleOrderId: string;
  notes: string | null;
  actorUserId: string;
}) {
  const order = await prisma.saleOrder.findUniqueOrThrow({ where: { id: input.saleOrderId } });
  if (order.status !== SaleOrderStatus.DRAFT) throw new Error("ORDER_NOT_DRAFT");
  return prisma.saleOrder.update({
    where: { id: input.saleOrderId },
    data: { notes: input.notes ?? null },
    select: { id: true, notes: true },
  });
}

export async function removeSaleOrderLine(input: { saleOrderId: string; lineId: string; actorUserId: string }) {
  return prisma.$transaction(async (tx) => {
    const order = await tx.saleOrder.findUniqueOrThrow({ where: { id: input.saleOrderId } });
    if (order.status !== SaleOrderStatus.DRAFT) throw new Error("ORDER_NOT_DRAFT");

    const deleted = await tx.saleOrderLine.deleteMany({
      where: { id: input.lineId, saleOrderId: input.saleOrderId },
    });

    if (deleted.count !== 1) {
      await tx.auditLog.create({
        data: {
          actorUserId: input.actorUserId,
          branchId: order.branchId,
          module: "sales",
          action: SALE_AUDIT_EVENTS.ORDER_LINE_MUTATION_DENIED,
          entityType: "SaleOrderLine",
          entityId: input.lineId,
          metadataJson: {
            reason: "LINE_NOT_IN_ORDER",
            saleOrderId: input.saleOrderId,
            deletedCount: deleted.count,
          },
        },
      });
      throw new Error("SALE_ORDER_LINE_NOT_FOUND");
    }

    const orderUpdated = await recalcOrderTotalsTx(tx, input.saleOrderId);

    await tx.auditLog.create({
      data: {
        actorUserId: input.actorUserId,
        branchId: order.branchId,
        module: "sales",
        action: SALE_AUDIT_EVENTS.ORDER_LINE_REMOVED,
        entityType: "SaleOrderLine",
        entityId: input.lineId,
        metadataJson: {
          saleOrderId: input.saleOrderId,
        },
      },
    });

    return orderUpdated;
  });
}

export async function submitSaleOrderToPendingPayment(input: {
  saleOrderId: string;
  actorUserId: string;
  requiresTransport?: boolean;
  transportAmount?: number;
}) {
  return prisma.$transaction(async (tx) => {
    const order = await tx.saleOrder.findUniqueOrThrow({ where: { id: input.saleOrderId } });
    if (order.status !== SaleOrderStatus.DRAFT) {
      await tx.auditLog.create({
        data: {
          actorUserId: input.actorUserId,
          branchId: order.branchId,
          module: "sales",
          action: SALE_AUDIT_EVENTS.ORDER_SUBMIT_DENIED,
          entityType: "SaleOrder",
          entityId: order.id,
          metadataJson: { reason: "INVALID_TRANSITION", currentStatus: order.status },
        },
      });
      throw new Error("INVALID_TRANSITION");
    }

    const lines = await tx.saleOrderLine.findMany({ where: { saleOrderId: input.saleOrderId } });
    if (lines.length === 0) {
      await tx.auditLog.create({
        data: {
          actorUserId: input.actorUserId,
          branchId: order.branchId,
          module: "sales",
          action: SALE_AUDIT_EVENTS.ORDER_SUBMIT_DENIED,
          entityType: "SaleOrder",
          entityId: order.id,
          metadataJson: { reason: "ORDER_EMPTY" },
        },
      });
      throw new Error("ORDER_EMPTY");
    }

    for (const line of lines) {
      const availability = await getSaleStockAvailabilityTx(tx, {
        branchId: order.branchId,
        productId: line.productId,
        quantity: line.quantity,
      });
      if (!availability.ok) {
        await tx.auditLog.create({
          data: {
            actorUserId: input.actorUserId,
            branchId: order.branchId,
            module: "sales",
            action: SALE_AUDIT_EVENTS.ORDER_SUBMIT_DENIED,
            entityType: "SaleOrder",
            entityId: order.id,
            metadataJson: {
              reason: availability.reason ?? "INSUFFICIENT_STOCK",
              productId: line.productId,
              inventoryProductId: availability.inventoryProductId,
              stockMode: availability.stockMode,
              requestedQty: availability.requestedQuantity.toString(),
              requiredBaseQty: availability.requestedBaseQuantity.toString(),
              availableSaleQty: availability.availableSaleQuantity.toString(),
              availableBaseQty: availability.availableBaseQuantity.toString(),
              details: Object.fromEntries(
                Object.entries(availability.details).map(([key, value]) => [
                  key,
                  value instanceof Prisma.Decimal ? value.toString() : value ?? null,
                ]),
              ),
            },
          },
        });
        throw new Error(availability.reason ?? "INSUFFICIENT_STOCK");
      }
    }

    const transportAmt = input.requiresTransport && typeof input.transportAmount === "number" && input.transportAmount > 0
      ? new Prisma.Decimal(input.transportAmount)
      : new Prisma.Decimal(0);
    const totals = aggregateOrderTotals(
      lines.map((line) => ({ lineSubtotal: line.lineSubtotal, discountAmount: line.discountAmount })),
      transportAmt,
    );
    const updated = await tx.saleOrder.update({
      where: { id: input.saleOrderId },
      data: {
        ...totals,
        ...(typeof input.requiresTransport === "boolean" ? { requiresTransport: input.requiresTransport } : {}),
        transportAmount: transportAmt,
        status: SaleOrderStatus.PENDING_PAYMENT,
      },
    });

    await tx.auditLog.create({
      data: {
        actorUserId: input.actorUserId,
        branchId: order.branchId,
        module: "sales",
        action: SALE_AUDIT_EVENTS.ORDER_SUBMITTED_PENDING_PAYMENT,
        entityType: "SaleOrder",
        entityId: order.id,
        metadataJson: typeof input.requiresTransport === "boolean"
          ? { requiresTransport: input.requiresTransport }
          : undefined,
      },
    });

    await tx.auditLog.create({
      data: {
        actorUserId: input.actorUserId,
        branchId: order.branchId,
        module: "sales",
        action: SALE_AUDIT_EVENTS.ORDER_STATUS_CHANGED,
        entityType: "SaleOrder",
        entityId: order.id,
        metadataJson: {
          previousStatus: order.status,
          currentStatus: updated.status,
        },
      },
    });

    return updated;
  });
}

function normalizeDirectSaleTenders(input: {
  amount: number;
  method: PaymentMethod;
  referenceNumber?: string | null;
  tenders?: DirectSaleTenderInput[];
}) {
  const tenders = input.tenders?.length
    ? input.tenders
    : [{ method: input.method, amount: input.amount, referenceNumber: input.referenceNumber ?? null }];
  let total = new Prisma.Decimal(0);
  for (const tender of tenders) {
    const amount = new Prisma.Decimal(tender.amount);
    if (amount.lte(0)) throw new Error("INVALID_TENDER_AMOUNT");
    total = total.add(amount);
    if (tender.method === PaymentMethod.CASH) {
      const received = new Prisma.Decimal(tender.receivedAmount ?? tender.amount);
      const change = new Prisma.Decimal(tender.changeAmount ?? 0);
      if (received.lt(amount)) throw new Error("INVALID_CASH_RECEIVED_AMOUNT");
      if (!received.sub(amount).eq(change)) throw new Error("INVALID_CASH_CHANGE_AMOUNT");
    }
    if ((tender.method === PaymentMethod.CARD || tender.method === PaymentMethod.TRANSFER) && !tender.referenceNumber) {
      throw new Error("PAYMENT_REFERENCE_REQUIRED");
    }
  }

  return {
    tenders,
    total,
    method: tenders.length > 1 ? PaymentMethod.MIXED : tenders[0].method,
    referenceNumber: tenders.length === 1 ? tenders[0].referenceNumber ?? input.referenceNumber ?? null : input.referenceNumber ?? null,
  };
}

/**
 * Direct sale V2-compatible path: the seller submits and collects in one step
 * when branch workflow and cash-session operator rules allow it.
 */
export async function submitDirectSale(input: {
  saleOrderId: string;
  actorUserId: string;
  cashSessionId: string;
  method: PaymentMethod;
  requiresTransport?: boolean;
  transportAmount?: number;
  referenceNumber?: string | null;
  tenders?: DirectSaleTenderInput[];
}) {
  const branchConfig = await getBranchModuleConfig(
    (await prisma.saleOrder.findUniqueOrThrow({ where: { id: input.saleOrderId }, select: { branchId: true } })).branchId,
  );

  if (branchConfig.paymentWorkflowMode === "QUEUE_ONLY" || !branchConfig.allowSellerDirectPayment) {
    throw new Error("DIRECT_PAYMENT_DISABLED");
  }

  return prisma.$transaction(async (tx) => {
    const order = await tx.saleOrder.findUniqueOrThrow({
      where: { id: input.saleOrderId },
      include: { lines: true, payments: true },
    });

    if (order.status !== SaleOrderStatus.DRAFT) throw new Error("ORDER_NOT_DRAFT");
    if (order.lines.length === 0) throw new Error("ORDER_EMPTY");

    const uniqueProductIds = [...new Set(order.lines.map((line) => line.productId))].sort();
    for (const productId of uniqueProductIds) {
      await tx.$queryRaw`
        SELECT id
        FROM "InventoryBalance"
        WHERE "branchId" = ${order.branchId}
          AND "productId" = ${productId}
        FOR UPDATE
      `;
    }

    // Verify stock (locked balances)
    for (const line of order.lines) {
      const availability = await getSaleStockAvailabilityTx(tx, {
        branchId: order.branchId,
        productId: line.productId,
        quantity: line.quantity,
      });
      if (!availability.ok) throw new Error(availability.reason ?? "INSUFFICIENT_STOCK");
    }

    // Calculate totals
    const transportAmt = input.requiresTransport && typeof input.transportAmount === "number" && input.transportAmount > 0
      ? new Prisma.Decimal(input.transportAmount)
      : new Prisma.Decimal(0);
    const totals = aggregateOrderTotals(
      order.lines.map((line) => ({ lineSubtotal: line.lineSubtotal, discountAmount: line.discountAmount })),
      transportAmt,
    );
    const grandTotal = totals.grandTotal;

    // Validate explicit cash session (no fallback to first active box/session)
    const session = await tx.cashSession.findUnique({
      where: { id: input.cashSessionId },
      include: { physicalCashBox: true, operationalDay: true },
    });
    if (!session) throw new Error("INVALID_CASH_SESSION");
    if (session.status === CashSessionStatus.AUTO_CLOSED_PENDING_REVIEW) {
      await tx.auditLog.create({
        data: {
          actorUserId: input.actorUserId,
          branchId: order.branchId,
          module: "sales",
          action: "PAYMENT_BLOCKED_AUTO_CLOSED_SESSION",
          entityType: "CashSession",
          entityId: session.id,
          metadataJson: { saleOrderId: order.id, status: session.status },
        },
      });
      throw new Error("CASH_SESSION_AUTO_CLOSED_PENDING_REVIEW");
    }
    if (session.status !== CashSessionStatus.OPEN || !session.activeSessionKey) {
      await tx.auditLog.create({
        data: {
          actorUserId: input.actorUserId,
          branchId: order.branchId,
          module: "sales",
          action: "PAYMENT_BLOCKED_NO_OPEN_CASH_SESSION",
          entityType: "CashSession",
          entityId: session.id,
          metadataJson: { saleOrderId: order.id, status: session.status, hasActiveSessionKey: Boolean(session.activeSessionKey) },
        },
      });
      throw new Error("CASH_SESSION_NOT_OPEN");
    }
    if (!session.operationalDay || session.operationalDay.status !== "OPEN") {
      await tx.auditLog.create({
        data: {
          actorUserId: input.actorUserId,
          branchId: order.branchId,
          module: "sales",
          action: "PAYMENT_BLOCKED_OPERATIONAL_DAY_CLOSED",
          entityType: "OperationalDay",
          entityId: session.operationalDayId ?? order.branchId,
          metadataJson: { saleOrderId: order.id, operationalDayId: session.operationalDayId, status: session.operationalDay?.status ?? null },
        },
      });
      throw new Error("OPERATIONAL_DAY_NOT_OPEN");
    }
    if (!session.physicalCashBox?.isActive) throw new Error("CASH_BOX_INACTIVE");
    if (session.physicalCashBox.branchId !== order.branchId) throw new Error("CASH_BOX_BRANCH_MISMATCH");
    if (!(await userCanOperateCashSessionTx(tx, {
      cashSessionId: session.id,
      userId: input.actorUserId,
      branchId: order.branchId,
    }))) {
      throw new Error("CASH_SESSION_OPERATOR_REQUIRED");
    }

    // Deduct inventory (same locked balances)
    for (const line of order.lines) {
      await consumeSharedStockForSaleTx(tx, {
        branchId: order.branchId,
        productId: line.productId,
        quantity: Number(line.quantity),
        userId: input.actorUserId,
        saleOrderId: order.id,
        referenceType: "DIRECT_SALE",
        referenceId: order.id,
        notes: `Venta directa orden ${order.orderNumber}`,
      });
    }

    const now = new Date();
    const finalStatus = branchConfig.enableDispatch ? SaleOrderStatus.DISPATCH_PENDING : SaleOrderStatus.DISPATCHED;

    // Update order
    const updatedOrder = await tx.saleOrder.update({
      where: { id: order.id },
      data: {
        ...totals,
        ...(typeof input.requiresTransport === "boolean" ? { requiresTransport: input.requiresTransport } : {}),
        transportAmount: transportAmt,
        status: finalStatus,
      },
    });

    const tenderSummary = normalizeDirectSaleTenders({
      amount: Number(grandTotal),
      method: input.method,
      referenceNumber: input.referenceNumber,
      tenders: input.tenders,
    });
    if (!tenderSummary.total.eq(grandTotal)) throw new Error("INVALID_PAYMENT_AMOUNT");

    // Create payment
    const payment = await tx.payment.create({
      data: {
        saleOrderId: order.id,
        cashSessionId: session.id,
        receivedByUserId: input.actorUserId,
        method: tenderSummary.method,
        status: PaymentStatus.POSTED,
        amount: grandTotal,
        referenceNumber: tenderSummary.referenceNumber,
        paidAt: now,
        createdAt: now,
      },
    });
    await tx.paymentTender.createMany({
      data: tenderSummary.tenders.map((tender) => ({
        paymentId: payment.id,
        method: tender.method,
        amount: new Prisma.Decimal(tender.amount),
        receivedAmount: tender.receivedAmount === null || tender.receivedAmount === undefined ? null : new Prisma.Decimal(tender.receivedAmount),
        changeAmount: tender.changeAmount === null || tender.changeAmount === undefined ? null : new Prisma.Decimal(tender.changeAmount),
        referenceNumber: tender.referenceNumber ?? null,
      })),
    });

    // Auto-dispatch if dispatch module is also disabled
    if (!branchConfig.enableDispatch) {
      await tx.dispatchTicket.create({
        data: {
          saleOrderId: order.id,
          branchId: order.branchId,
          status: DispatchStatus.DISPATCHED,
          preparedByUserId: input.actorUserId,
          dispatchedByUserId: input.actorUserId,
          dispatchedAt: now,
          notes: "Venta directa - despacho automatico",
        },
      });
    }

    // Auto-create transport if requiresTransport=true
    const effectiveRequiresTransport = input.requiresTransport ?? order.requiresTransport;
    if (effectiveRequiresTransport && Number(transportAmt) > 0) {
      const orderWithCustomer = await tx.saleOrder.findUniqueOrThrow({
        where: { id: order.id },
        include: { customer: { select: { displayName: true, legalName: true } } },
      });
      await ensureTransportServiceForOrderTx(tx, {
        saleOrderId: order.id,
        branchId: order.branchId,
        createdByUserId: input.actorUserId,
        customerName: resolveTransportCustomerName(orderWithCustomer.customer),
        price: Number(transportAmt),
        reference: order.orderNumber,
        notes: "Transporte creado automaticamente en venta directa",
      });
    }

    await tx.auditLog.create({
      data: {
        actorUserId: input.actorUserId,
        branchId: order.branchId,
        module: "sales",
        action: "DIRECT_SALE_COMPLETED",
        entityType: "SaleOrder",
        entityId: order.id,
        metadataJson: {
          method: input.method,
          tenders: tenderSummary.tenders,
          amount: grandTotal.toString(),
          autoDispatched: !branchConfig.enableDispatch,
        },
      },
    });
    await refreshOperationalDaySummaryTx(tx, session.operationalDayId);

    return updatedOrder;
  });
}

/* ──────────────────────────────────────────────────────────────────────── */
/* Anulación de facturas / órdenes (Centro de Comando — rol master)          */
/* ──────────────────────────────────────────────────────────────────────── */

/**
 * Estados de orden que pueden anularse desde el Centro de Comando.
 * - DRAFT no se incluye (es un borrador, no una venta confirmada).
 * - CANCELLED y los estados de devolución (RETURN_*) no son anulables.
 */
const CANCELLABLE_SALE_ORDER_STATUSES: SaleOrderStatus[] = [
  SaleOrderStatus.PENDING_PAYMENT,
  SaleOrderStatus.PAID,
  SaleOrderStatus.DISPATCH_PENDING,
  SaleOrderStatus.DISPATCHED,
];

/** Indica si una orden, según su estado, puede anularse. */
export function isSaleOrderCancellable(status: SaleOrderStatus): boolean {
  return CANCELLABLE_SALE_ORDER_STATUSES.includes(status);
}

/** Zona horaria de Nicaragua (UTC-6, sin horario de verano). */
const NICARAGUA_UTC_OFFSET_HOURS = 6;

/**
 * Devuelve los límites [inicio, fin) en UTC del día indicado (o de hoy) en la
 * zona horaria de Managua. Permite filtrar las facturas "del día" correctamente
 * aunque se almacenen en UTC.
 */
function managuaDayRangeUtc(ymd?: string): { start: Date; end: Date } {
  let y: number, m: number, d: number;
  if (ymd && /^\d{4}-\d{2}-\d{2}$/.test(ymd)) {
    const [yy, mm, dd] = ymd.split("-").map((n) => parseInt(n, 10));
    y = yy; m = mm - 1; d = dd;
  } else {
    const nowManagua = new Date(Date.now() - NICARAGUA_UTC_OFFSET_HOURS * 3600 * 1000);
    y = nowManagua.getUTCFullYear();
    m = nowManagua.getUTCMonth();
    d = nowManagua.getUTCDate();
  }
  // 00:00 Managua === 06:00 UTC del mismo día.
  const start = new Date(Date.UTC(y, m, d, NICARAGUA_UTC_OFFSET_HOURS, 0, 0, 0));
  const end = new Date(Date.UTC(y, m, d + 1, NICARAGUA_UTC_OFFSET_HOURS, 0, 0, 0));
  return { start, end };
}

/**
 * Lista las órdenes/facturas para la gestión desde el Centro de Comando.
 * Por defecto devuelve las del día (Managua). Permite filtrar por sucursal y
 * por fecha (YYYY-MM-DD). Marca cuáles pueden anularse.
 */
export async function listSaleOrdersForManagement(params: {
  branchId?: string | null;
  date?: string | null;
  includeAllBranches: boolean;
  status?: string | null;
  search?: string | null;
}) {
  const { start, end } = managuaDayRangeUtc(params.date ?? undefined);
  const where: Prisma.SaleOrderWhereInput = {
    status: params.status
      ? (params.status as SaleOrderStatus)
      : { not: SaleOrderStatus.DRAFT },
    OR: [
      { payments: { some: { status: PaymentStatus.POSTED, paidAt: { gte: start, lt: end } } } },
      { manualInvoiceRegisteredAt: { gte: start, lt: end } },
      { deliveryOrderIssuedAt: { gte: start, lt: end } },
      { updatedAt: { gte: start, lt: end } },
      { createdAt: { gte: start, lt: end } },
    ],
  };
  if (params.branchId) {
    where.branchId = params.branchId;
  }
  if (params.search?.trim()) {
    const s = params.search.trim();
    where.AND = [
      {
        OR: [
          { orderNumber: { contains: s, mode: "insensitive" } },
          { deliveryOrderNumber: { contains: s, mode: "insensitive" } },
          { customer: { displayName: { contains: s, mode: "insensitive" } } },
          { customer: { legalName: { contains: s, mode: "insensitive" } } },
          { createdBy: { fullName: { contains: s, mode: "insensitive" } } },
        ],
      },
    ];
  }

  const orders = await prisma.saleOrder.findMany({
    where,
    select: {
      id: true,
      orderNumber: true,
      status: true,
      grandTotal: true,
      createdAt: true,
      updatedAt: true,
      notes: true,
      requiresTransport: true,
      transportAmount: true,
      deliveryOrderNumber: true,
      deliveryOrderIssuedAt: true,
      documentMode: true,
      requiresManualInvoice: true,
      manualInvoiceSeries: true,
      manualInvoiceNumber: true,
      manualInvoiceStatus: true,
      manualInvoiceRegisteredAt: true,
      manualInvoiceCustomerName: true,
      manualInvoiceCustomerRuc: true,
      branch: { select: { id: true, code: true, name: true } },
      customer: { select: { displayName: true, legalName: true } },
      createdBy: { select: { id: true, username: true, fullName: true } },
      payments: {
        where: { status: PaymentStatus.POSTED },
        select: { paidAt: true, status: true, method: true },
        orderBy: { paidAt: "desc" },
        take: 1,
      },
      _count: { select: { lines: true } },
    },
    orderBy: { updatedAt: "desc" },
    take: 300,
  });

  return orders
    .map((o) => {
      const latestPayment = o.payments[0] ?? null;
      const commercialDate =
        latestPayment?.paidAt ??
        o.manualInvoiceRegisteredAt ??
        o.deliveryOrderIssuedAt ??
        o.updatedAt ??
        o.createdAt;
      return {
        id: o.id,
        orderNumber: o.orderNumber,
        deliveryOrderNumber: o.deliveryOrderNumber,
        deliveryOrderIssuedAt: o.deliveryOrderIssuedAt?.toISOString() ?? null,
        documentMode: o.documentMode,
        requiresTransport: o.requiresTransport,
        transportAmount: Number(o.transportAmount),
        requiresManualInvoice: o.requiresManualInvoice,
        manualInvoiceSeries: o.manualInvoiceSeries,
        manualInvoiceNumber: o.manualInvoiceNumber,
        manualInvoiceStatus: o.manualInvoiceStatus,
        manualInvoiceRegisteredAt: o.manualInvoiceRegisteredAt?.toISOString() ?? null,
        manualInvoiceCustomerName: o.manualInvoiceCustomerName,
        manualInvoiceCustomerRuc: o.manualInvoiceCustomerRuc,
        latestPaymentAt: latestPayment?.paidAt.toISOString() ?? null,
        paymentStatus: latestPayment?.status ?? (o.status === SaleOrderStatus.PENDING_PAYMENT ? "PENDING_PAYMENT" : null),
        paymentMethod: latestPayment?.method ?? null,
        commercialDate: commercialDate.toISOString(),
        status: o.status,
        grandTotal: Number(o.grandTotal),
        createdAt: o.createdAt.toISOString(),
        branch: o.branch,
        customerName: o.customer?.displayName ?? o.customer?.legalName ?? null,
        createdByName: o.createdBy?.fullName ?? o.createdBy?.username ?? null,
        linesCount: o._count.lines,
        cancellable: isSaleOrderCancellable(o.status),
      };
    })
    .sort((a, b) => new Date(b.commercialDate).getTime() - new Date(a.commercialDate).getTime());
}

/**
 * Core transaccional de la anulación de orden. Acepta un TransactionClient
 * para poder ser llamado tanto desde cancelSaleOrder (tx propia) como desde
 * executeSaleCancellation (tx única que engloba todo el flujo de anulación).
 *
 * No abre transacción. El caller es responsable de proveer `tx`.
 */
export async function cancelSaleOrderTx(
  tx: Prisma.TransactionClient,
  input: { orderId: string; actorUserId: string; reason: string },
) {
  const order = await tx.saleOrder.findUnique({
    where: { id: input.orderId },
    include: {
      lines: true,
      payments: true,
      branch: { select: { id: true, code: true, name: true } },
    },
  });
  if (!order) throw new Error("NOT_FOUND");
  if (order.status === SaleOrderStatus.CANCELLED) {
    throw new Error("INVALID_INPUT: La orden ya está anulada.");
  }
  if (!isSaleOrderCancellable(order.status)) {
    throw new Error(`INVALID_INPUT: No se puede anular una orden en estado ${order.status}.`);
  }

  // ── 1) Reversión de inventario ───────────────────────────────────────
  const saleOutMovements = await tx.inventoryMovement.findMany({
    where: { referenceId: order.id, movementType: InventoryMovementType.SALE_OUT },
  });
  const alreadyReversed = await tx.inventoryMovement.count({
    where: {
      referenceId: order.id,
      movementType: InventoryMovementType.RETURN_IN,
      referenceType: "SALE_CANCELLATION",
    },
  });

  const inventoryReversals: { movementId: string; productId: string; quantity: number }[] = [];
  if (alreadyReversed === 0) {
    for (const mv of saleOutMovements) {
      const qty = Number(mv.quantity);
      const cost = Number(mv.unitCost);
      if (qty <= 0) continue;

      if (cost > 0) {
        const res = await createInventoryMovementTx(tx, {
          actorUserId: input.actorUserId,
          branchId: mv.branchId,
          productId: mv.productId,
          movementType: InventoryMovementType.RETURN_IN,
          quantity: qty,
          unitCost: cost,
          referenceType: "SALE_CANCELLATION",
          referenceId: order.id,
          notes: `Reversión por anulación de orden ${order.orderNumber}`,
        });
        inventoryReversals.push({ movementId: res.movement.id, productId: mv.productId, quantity: qty });
      } else {
        // Costo cero: restauramos cantidad sin alterar WAC.
        const createdMv = await tx.inventoryMovement.create({
          data: {
            branchId: mv.branchId,
            productId: mv.productId,
            movementType: InventoryMovementType.RETURN_IN,
            quantity: mv.quantity,
            unitCost: mv.unitCost,
            referenceType: "SALE_CANCELLATION",
            referenceId: order.id,
            notes: `Reversión (costo 0) por anulación de orden ${order.orderNumber}`,
          },
        });
        const bal = await tx.inventoryBalance.findUnique({
          where: { branchId_productId: { branchId: mv.branchId, productId: mv.productId } },
        });
        if (bal) {
          const newQty = bal.quantityOnHand.add(mv.quantity);
          await tx.inventoryBalance.update({
            where: { id: bal.id },
            data: { quantityOnHand: newQty, inventoryValue: newQty.mul(bal.weightedAverageCost) },
          });
        } else {
          await tx.inventoryBalance.create({
            data: {
              branchId: mv.branchId,
              productId: mv.productId,
              quantityOnHand: mv.quantity,
              weightedAverageCost: 0,
              inventoryValue: 0,
            },
          });
        }
        inventoryReversals.push({ movementId: createdMv.id, productId: mv.productId, quantity: qty });
      }
    }
  }

  // ── 2) Anulación de pagos POSTED ─────────────────────────────────────
  const voidedPayments: string[] = [];
  const cashSessionIds = new Set<string>();
  const operationalDayIds = new Set<string>();
  for (const p of order.payments) {
    if (p.status === PaymentStatus.POSTED) {
      await tx.payment.update({ where: { id: p.id }, data: { status: PaymentStatus.VOIDED } });
      voidedPayments.push(p.id);
      cashSessionIds.add(p.cashSessionId);
    }
  }
  for (const cashSessionId of cashSessionIds) {
    await syncCashSessionSnapshotTx(tx, cashSessionId);
  }
  if (order.payments.length > 0) {
    const sessions = await tx.cashSession.findMany({
      where: { id: { in: order.payments.map((p) => p.cashSessionId) } },
      select: { operationalDayId: true },
    });
    for (const s of sessions) if (s.operationalDayId) operationalDayIds.add(s.operationalDayId);
  }

  // ── 3) Cambio de estado a CANCELLED ──────────────────────────────────
  const cancellationNote = `[ANULADA ${new Date().toISOString()}] ${input.reason}`;
  const updatedOrder = await tx.saleOrder.update({
    where: { id: order.id },
    data: {
      status: SaleOrderStatus.CANCELLED,
      notes: order.notes ? `${order.notes}\n${cancellationNote}` : cancellationNote,
    },
  });

  // ── 4) Refrescar resumen del día operativo ───────────────────────────
  for (const dayId of operationalDayIds) {
    await refreshOperationalDaySummaryTx(tx, dayId);
  }

  // ── 5) Auditoría ─────────────────────────────────────────────────────
  await tx.auditLog.create({
    data: {
      actorUserId: input.actorUserId,
      branchId: order.branchId,
      module: "sales",
      action: SALE_AUDIT_EVENTS.ORDER_CANCELLED,
      entityType: "SaleOrder",
      entityId: order.id,
      metadataJson: {
        orderNumber: order.orderNumber,
        branchId: order.branchId,
        branchCode: order.branch.code,
        previousStatus: order.status,
        newStatus: SaleOrderStatus.CANCELLED,
        grandTotal: order.grandTotal.toString(),
        reason: input.reason,
        voidedPayments,
        voidedPaymentsCount: voidedPayments.length,
        inventoryReversalsCount: inventoryReversals.length,
        inventoryReversals,
        cancelledByUserId: input.actorUserId,
      },
    },
  });

  return {
    id: updatedOrder.id,
    orderNumber: updatedOrder.orderNumber,
    status: updatedOrder.status,
    previousStatus: order.status,
    reason: input.reason,
    voidedPaymentsCount: voidedPayments.length,
    inventoryReversalsCount: inventoryReversals.length,
  };
}

/**
 * Anula (CANCELLED) una orden/factura de venta. Operación reservada al rol
 * master/admin (validado en el endpoint). Wrapper público que abre su propia
 * transacción y delega en cancelSaleOrderTx.
 */
export async function cancelSaleOrder(input: {
  orderId: string;
  actorUserId: string;
  reason: string;
}) {
  const reason = input.reason?.trim() ?? "";
  if (reason.length < 3) {
    throw new Error("INVALID_INPUT: Debe indicar un motivo de anulación (mínimo 3 caracteres).");
  }
  return prisma.$transaction(
    (tx) => cancelSaleOrderTx(tx, { ...input, reason }),
    { timeout: 20000 },
  );
}

/**
 * Devuelve el detalle completo de una factura/orden de venta para la vista de
 * auditoría del Centro de Comando: cabecera, cliente, items (con producto/SKU),
 * pagos (con tenders), usuario vendedor, totales e historial de auditoría.
 * Reservado al rol master/admin (validado en el endpoint).
 */
export async function getSaleOrderDetailForManagement(orderId: string) {
  const order = await prisma.saleOrder.findUnique({
    where: { id: orderId },
    include: {
      branch: { select: { id: true, code: true, name: true } },
      customer: {
        select: {
          id: true,
          code: true,
          legalName: true,
          displayName: true,
          taxId: true,
          phone: true,
          email: true,
          address: true,
        },
      },
      createdBy: { select: { id: true, username: true, fullName: true } },
      manualInvoiceRegisteredBy: { select: { id: true, username: true, fullName: true } },
      lines: {
        include: {
          product: { select: { id: true, sku: true, name: true, unit: true } },
        },
        orderBy: { createdAt: "asc" },
      },
      payments: {
        include: {
          receivedBy: { select: { id: true, username: true, fullName: true } },
          tenders: true,
        },
        orderBy: { createdAt: "asc" },
      },
    },
  });

  if (!order) throw new Error("NOT_FOUND");

  // Historial de auditoría asociado a esta orden (anulación, intentos, etc.).
  const auditLogs = await prisma.auditLog.findMany({
    where: { entityType: "SaleOrder", entityId: order.id },
    orderBy: { occurredAt: "desc" },
    take: 50,
    select: {
      id: true,
      occurredAt: true,
      action: true,
      module: true,
      metadataJson: true,
      actor: { select: { id: true, username: true, fullName: true } },
    },
  });

  return {
    id: order.id,
    orderNumber: order.orderNumber,
    status: order.status,
    cancellable: isSaleOrderCancellable(order.status),
    requiresTransport: order.requiresTransport,
    transportAmount: Number(order.transportAmount),
    createdAt: order.createdAt.toISOString(),
    updatedAt: order.updatedAt.toISOString(),
    notes: order.notes ?? null,
    branch: order.branch,
    createdBy: order.createdBy
      ? {
          id: order.createdBy.id,
          name: order.createdBy.fullName ?? order.createdBy.username,
          username: order.createdBy.username,
        }
      : null,
    customer: order.customer
      ? {
          id: order.customer.id,
          code: order.customer.code,
          name: order.customer.displayName ?? order.customer.legalName,
          legalName: order.customer.legalName,
          taxId: order.customer.taxId ?? null,
          phone: order.customer.phone ?? null,
          email: order.customer.email ?? null,
          address: order.customer.address ?? null,
        }
      : null,
    totals: {
      subtotal: Number(order.subtotal),
      discountTotal: Number(order.discountTotal),
      taxTotal: Number(order.taxTotal),
      transportAmount: Number(order.transportAmount),
      grandTotal: Number(order.grandTotal),
    },
    documentMode: order.documentMode,
    requiresManualInvoice: order.requiresManualInvoice,
    manualInvoice: order.requiresManualInvoice
      ? {
          series: order.manualInvoiceSeries ?? null,
          number: order.manualInvoiceNumber ?? null,
          date: order.manualInvoiceDate ? order.manualInvoiceDate.toISOString() : null,
          customerName: order.manualInvoiceCustomerName ?? null,
          customerRuc: order.manualInvoiceCustomerRuc ?? null,
          status: order.manualInvoiceStatus,
          registeredBy: order.manualInvoiceRegisteredBy
            ? order.manualInvoiceRegisteredBy.fullName ?? order.manualInvoiceRegisteredBy.username
            : null,
          registeredAt: order.manualInvoiceRegisteredAt
            ? order.manualInvoiceRegisteredAt.toISOString()
            : null,
          notes: order.manualInvoiceNotes ?? null,
        }
      : null,
    lines: order.lines.map((l) => ({
      id: l.id,
      productId: l.productId,
      productName: l.product?.name ?? "(producto eliminado)",
      sku: l.product?.sku ?? null,
      unit: l.product?.unit ?? null,
      quantity: Number(l.quantity),
      unitPrice: Number(l.unitPrice),
      discountAmount: Number(l.discountAmount),
      lineSubtotal: Number(l.lineSubtotal),
    })),
    payments: order.payments.map((p) => ({
      id: p.id,
      method: p.method,
      status: p.status,
      amount: Number(p.amount),
      currencyCode: p.currencyCode,
      referenceNumber: p.referenceNumber ?? null,
      paidAt: p.paidAt.toISOString(),
      receivedByName: p.receivedBy ? p.receivedBy.fullName ?? p.receivedBy.username : null,
      tenders: p.tenders.map((t) => ({
        id: t.id,
        method: t.method,
        amount: Number(t.amount),
        receivedAmount: t.receivedAmount != null ? Number(t.receivedAmount) : null,
        changeAmount: t.changeAmount != null ? Number(t.changeAmount) : null,
        referenceNumber: t.referenceNumber ?? null,
      })),
    })),
    auditTrail: auditLogs.map((a) => ({
      id: a.id,
      occurredAt: a.occurredAt.toISOString(),
      action: a.action,
      module: a.module,
      actorName: a.actor ? a.actor.fullName ?? a.actor.username : null,
      metadata: a.metadataJson ?? null,
    })),
  };
}
