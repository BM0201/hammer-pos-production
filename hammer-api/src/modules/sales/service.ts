import { DispatchStatus, Prisma, SaleOrderStatus, InventoryMovementType, PaymentMethod, PaymentStatus, CashSessionStatus } from "@prisma/client";
import { randomBytes } from "node:crypto";
import { prisma } from "@/lib/prisma";
import { logAuditEvent } from "@/modules/audit/service";
import { aggregateOrderTotals, calculateLineSubtotal } from "@/modules/sales/totals";
import { SALE_AUDIT_EVENTS } from "@/modules/sales/audit-events";
import { getBranchModuleConfig } from "@/modules/branch-config/service";
import { createInventoryMovementTx } from "@/modules/inventory/service";
import { ensureTransportServiceForOrderTx, resolveTransportCustomerName } from "@/modules/transport/service";
import { refreshOperationalDaySummaryTx } from "@/modules/operations/service";
import { getEffectiveProductPricing } from "@/modules/catalog/effective-pricing";
import { getMaxDiscountPercentForRole, validateDiscountForRole } from "@/modules/sales/discount-policy";
import { resolvePolicyForProduct } from "@/modules/pricing/category-policy-service";
import { buildCommercialIntelligenceForProduct } from "@/modules/pricing/commercial-intelligence";
import { convertSaleQtyToBaseQty, getSharedInventoryBalance } from "@/modules/inventory/unit-conversion";

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

    const line = await tx.saleOrderLine.create({
      data: {
        saleOrderId: input.saleOrderId,
        productId: input.productId,
        quantity,
        unitPrice,
        discountAmount,
        lineSubtotal,
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
    const discountAmount = new Prisma.Decimal(input.discountAmount ?? existing.discountAmount);
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

    const updated = await tx.saleOrderLine.update({
      where: { id: existing.id },
      data: { quantity, unitPrice, discountAmount, lineSubtotal },
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
          },
        },
      },
    });

    return { line: updated, order: orderUpdated };
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
      const shared = await getSharedInventoryBalance(tx, { branchId: order.branchId, productId: line.productId });
      const available = shared.balance?.quantityOnHand ?? new Prisma.Decimal(0);
      const required = shared.conversion
        ? convertSaleQtyToBaseQty({ quantity: line.quantity, conversionFactor: shared.conversion.conversionFactor })
        : line.quantity;
      if (available.lt(required)) {
        await tx.auditLog.create({
          data: {
            actorUserId: input.actorUserId,
            branchId: order.branchId,
            module: "sales",
            action: SALE_AUDIT_EVENTS.ORDER_SUBMIT_DENIED,
            entityType: "SaleOrder",
            entityId: order.id,
            metadataJson: { reason: "INSUFFICIENT_STOCK", productId: line.productId, inventoryProductId: shared.inventoryProductId, requiredBaseQty: required.toString(), availableBaseQty: available.toString() },
          },
        });
        throw new Error("INSUFFICIENT_STOCK");
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

/**
 * Direct sale: when cashier module is disabled, the seller submits + pays in one step.
 * The system auto-processes payment using the branch's cash session and optionally auto-dispatches.
 */
export async function submitDirectSale(input: {
  saleOrderId: string;
  actorUserId: string;
  cashSessionId: string;
  method: PaymentMethod;
  requiresTransport?: boolean;
  transportAmount?: number;
  referenceNumber?: string | null;
}) {
  const branchConfig = await getBranchModuleConfig(
    (await prisma.saleOrder.findUniqueOrThrow({ where: { id: input.saleOrderId }, select: { branchId: true } })).branchId,
  );

  // If cashier is enabled, this function should not be used
  if (branchConfig.enableCashier) {
    throw new Error("CASHIER_MODULE_ENABLED");
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
      const shared = await getSharedInventoryBalance(tx, { branchId: order.branchId, productId: line.productId });
      const available = shared.balance?.quantityOnHand ?? new Prisma.Decimal(0);
      const required = shared.conversion
        ? convertSaleQtyToBaseQty({ quantity: line.quantity, conversionFactor: shared.conversion.conversionFactor })
        : line.quantity;
      if (available.lt(required)) throw new Error("INSUFFICIENT_STOCK");
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

    // Deduct inventory (same locked balances)
    for (const line of order.lines) {
      const shared = await getSharedInventoryBalance(tx, { branchId: order.branchId, productId: line.productId });
      const currentWac = shared.balance?.weightedAverageCost ?? new Prisma.Decimal(0);
      await createInventoryMovementTx(tx, {
        actorUserId: input.actorUserId,
        branchId: order.branchId,
        productId: line.productId,
        movementType: InventoryMovementType.SALE_OUT,
        quantity: Number(line.quantity),
        unitCost: Number(currentWac),
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

    // Create payment
    await tx.payment.create({
      data: {
        saleOrderId: order.id,
        cashSessionId: session.id,
        receivedByUserId: input.actorUserId,
        method: input.method,
        status: PaymentStatus.POSTED,
        amount: grandTotal,
        referenceNumber: input.referenceNumber ?? null,
        paidAt: now,
        createdAt: now,
      },
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
          amount: grandTotal.toString(),
          autoDispatched: !branchConfig.enableDispatch,
        },
      },
    });
    await refreshOperationalDaySummaryTx(tx, session.operationalDayId);

    return updatedOrder;
  });
}
