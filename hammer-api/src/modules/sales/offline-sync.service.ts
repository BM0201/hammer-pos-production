import { randomBytes } from "crypto";
import { Prisma, SaleOrderStatus } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { consumeSharedStockForSaleTx } from "@/modules/inventory/service";
import { logAuditEvent } from "@/modules/audit/service";
import { getEffectiveProductPricing } from "@/modules/catalog/effective-pricing";
import { getMaxDiscountPercentForRole, validateDiscountForRole } from "@/modules/sales/discount-policy";
import { resolvePolicyForProduct } from "@/modules/pricing/category-policy-service";
import { buildCommercialIntelligenceForProduct } from "@/modules/pricing/commercial-intelligence";
import { aggregateOrderTotals, calculateLineSubtotal } from "@/modules/sales/totals";

// Tolerancia de redondeo del lado del cliente (display) al validar el
// grandTotal que manda el dispositivo offline contra el recalculado en el
// servidor — un centavo, no más.
const OFFLINE_SYNC_TOTAL_TOLERANCE = new Prisma.Decimal("0.01");

export type OfflineSyncLine = {
  productId: string;
  quantity: number;
  unitPrice: number;
  discountAmount: number;
};

export type OfflineSyncInput = {
  offlineId: string;
  branchId: string;
  cashSessionId: string;
  actorUserId: string;
  actorRole?: string;
  overrideReason?: string;
  lines: OfflineSyncLine[];
  grandTotal: number;
  notes?: string;
  createdAt: string; // ISO — when the sale was made offline
};

function makeOrderNumber(branchCode: string) {
  const ts = Date.now().toString(36).toUpperCase();
  const rand = randomBytes(4).toString("hex").toUpperCase();
  return `SO-${branchCode}-${ts}-${rand}`;
}

export async function syncOfflineSale(input: OfflineSyncInput) {
  // ── 1. Validate cash session timing ────────────────────────────────────────
  const session = await prisma.cashSession.findUnique({
    where: { id: input.cashSessionId },
    include: {
      physicalCashBox: { select: { branchId: true, isActive: true } },
      operationalDay: { select: { id: true, lifecycle: true, reviewStatus: true } },
    },
  });
  if (!session) throw new Error("INVALID_CASH_SESSION");
  if (session.physicalCashBox.branchId !== input.branchId) throw new Error("CASH_BOX_BRANCH_MISMATCH");

  const saleTime = new Date(input.createdAt);
  if (isNaN(saleTime.getTime())) throw new Error("INVALID_CREATED_AT");
  if (saleTime < session.openedAt) throw new Error("OFFLINE_SALE_BEFORE_SESSION_OPEN");
  if (session.closedAt && saleTime > session.closedAt) throw new Error("OFFLINE_SALE_AFTER_SESSION_CLOSE");

  // ── 1b. Día operativo original (fuente de verdad, NO el día de hoy) ─────────
  // Regla ERP: una venta offline se asienta al día operativo de SU sesión, no al
  // día actual solo porque se sincronizó hoy. Y nunca se altera un día confirmado.
  const operationalDay = session.operationalDay;
  if (operationalDay?.reviewStatus === "CONFIRMED") {
    // Día ya confirmado/archivado: no mutar el snapshot firmado. Requiere ajuste Master.
    throw new Error("OFFLINE_SALE_DAY_APPROVED");
  }
  const operationalDayId = operationalDay?.id ?? null;
  const lateSyncIntoClosedDay = operationalDay?.lifecycle === "AWAITING_REVIEW";

  // ── 2. Validate products ────────────────────────────────────────────────────
  const productIds = [...new Set(input.lines.map(l => l.productId))];
  const products = await prisma.product.findMany({
    where: { id: { in: productIds } },
    select: { id: true, name: true },
  });
  if (products.length !== productIds.length) throw new Error("INVALID_PRODUCTS");

  // ── 3. Check for duplicate (idempotency por offlineClientId, unique en DB) ──
  const duplicate = await prisma.saleOrder.findUnique({
    where: { offlineClientId: input.offlineId },
    select: { id: true, orderNumber: true },
  });
  if (duplicate) {
    return { orderId: duplicate.id, orderNumber: duplicate.orderNumber, alreadySynced: true };
  }

  // ── 3b. Política de descuento/costo por línea — MISMA validación que una venta
  // online (addSaleOrderLine). El POS offline puede mandar unitPrice/discountAmount
  // libres; sin este chequeo el límite de descuento por rol y el bloqueo de venta
  // bajo costo quedaban completamente evadidos al sincronizar. ────────────────────
  for (const line of input.lines) {
    const pricing = await getEffectiveProductPricing(prisma, { branchId: input.branchId, productId: line.productId });
    const categoryPolicy = await resolvePolicyForProduct({ branchId: input.branchId, productId: line.productId });
    const commercialIntelligence = await buildCommercialIntelligenceForProduct({ branchId: input.branchId, productId: line.productId });

    const quantity = new Prisma.Decimal(line.quantity);
    const unitPrice = new Prisma.Decimal(line.unitPrice);
    const discountAmount = new Prisma.Decimal(line.discountAmount);
    const discountPerUnit = quantity.gt(0) ? discountAmount.div(quantity) : new Prisma.Decimal(0);
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
      await logAuditEvent({
        actorUserId: input.actorUserId,
        branchId: input.branchId,
        module: "sales",
        action: "OFFLINE_SYNC_LINE_DENIED",
        entityType: "Product",
        entityId: line.productId,
        metadataJson: {
          offlineId: input.offlineId,
          reason: policy.code,
          effectiveCost: pricing.effectiveCost?.toString() ?? null,
          netUnitPriceAfterDiscount: netUnitPriceAfterDiscount.toString(),
          userRole: input.actorRole ?? null,
          discountPercent: discountPercent.toString(),
          roleMaxDiscountPercent: getMaxDiscountPercentForRole(input.actorRole),
          combinedClass: commercialIntelligence.combinedClass,
        },
      });
      const error = new Error(policy.code ?? "DISCOUNT_LIMIT_EXCEEDED");
      throw error;
    }
  }

  // ── 3c. Recalcular totales con Decimal (misma función que el flujo online,
  // totals.ts) y validar el grandTotal del cliente contra el recalculado —
  // nunca se confía en el total que manda el dispositivo offline. ────────────
  const linesWithTotals = input.lines.map((line) => {
    const quantity = new Prisma.Decimal(line.quantity);
    const unitPrice = new Prisma.Decimal(line.unitPrice);
    const discountAmount = new Prisma.Decimal(line.discountAmount);
    const lineSubtotal = calculateLineSubtotal(quantity, unitPrice, discountAmount);
    return { ...line, quantity, unitPrice, discountAmount, lineSubtotal };
  });

  // El offline sync no maneja transporte por ahora.
  const totals = aggregateOrderTotals(
    linesWithTotals.map((l) => ({ lineSubtotal: l.lineSubtotal, discountAmount: l.discountAmount })),
    new Prisma.Decimal(0),
  );

  const clientGrandTotal = new Prisma.Decimal(input.grandTotal);
  if (clientGrandTotal.minus(totals.grandTotal).abs().gt(OFFLINE_SYNC_TOTAL_TOLERANCE)) {
    await logAuditEvent({
      actorUserId: input.actorUserId,
      branchId: input.branchId,
      module: "sales",
      action: "OFFLINE_SYNC_TOTAL_MISMATCH",
      entityType: "SaleOrder",
      entityId: input.offlineId,
      metadataJson: {
        offlineId: input.offlineId,
        clientGrandTotal: clientGrandTotal.toString(),
        serverGrandTotal: totals.grandTotal.toString(),
      },
    });
    throw new Error("OFFLINE_SYNC_TOTAL_MISMATCH");
  }

  // ── 4. Fetch branch code for order number ──────────────────────────────────
  const branch = await prisma.branch.findUniqueOrThrow({
    where: { id: input.branchId },
    select: { code: true },
  });

  const now = new Date();

  // ── 5. Transaction: create order + lines + inventory + payment ─────────────
  let result: { orderId: string; orderNumber: string };
  try {
    result = await prisma.$transaction(async (tx) => {
    const order = await tx.saleOrder.create({
      data: {
        orderNumber: makeOrderNumber(branch.code),
        branchId: input.branchId,
        // Día operativo ORIGINAL de la venta, no el de hoy.
        operationalDayId,
        offlineClientId: input.offlineId,
        saleOccurredAt: saleTime,
        syncedAt: now,
        postedAt: now,
        createdByUserId: input.actorUserId,
        status: SaleOrderStatus.DISPATCHED,
        subtotal: totals.subtotal,
        discountTotal: totals.discountTotal,
        taxTotal: totals.taxTotal,
        grandTotal: totals.grandTotal,
        transportAmount: totals.transportAmount,
        notes: input.notes
          ? `[OFFLINE:${input.offlineId}] ${input.notes}`
          : `[OFFLINE:${input.offlineId}]`,
        createdAt: saleTime,
      },
    });

    for (const line of linesWithTotals) {
      await tx.saleOrderLine.create({
        data: {
          saleOrderId: order.id,
          productId: line.productId,
          quantity: line.quantity,
          unitPrice: line.unitPrice,
          discountAmount: line.discountAmount,
          lineSubtotal: line.lineSubtotal,
        },
      });

      // Deduct inventory — best-effort (won't throw on negative stock)
      try {
        await consumeSharedStockForSaleTx(tx, {
          branchId: input.branchId,
          productId: line.productId,
          quantity: line.quantity,
          userId: input.actorUserId,
          saleOrderId: order.id,
          referenceType: "DIRECT_SALE",
          referenceId: order.id,
          notes: `Venta offline sincronizada (${input.offlineId})`,
        });
      } catch {
        // Stock insuficiente en offline sync — registra pero no bloquea
        await tx.auditLog.create({
          data: {
            actorUserId: input.actorUserId,
            branchId: input.branchId,
            module: "sales",
            action: "OFFLINE_SYNC_STOCK_WARNING",
            entityType: "SaleOrderLine",
            entityId: order.id,
            metadataJson: { offlineId: input.offlineId, productId: line.productId, quantity: line.quantity.toString() },
          },
        });
      }
    }

    const payment = await tx.payment.create({
      data: {
        saleOrderId: order.id,
        cashSessionId: input.cashSessionId,
        operationalDayId,
        receivedByUserId: input.actorUserId,
        method: "CASH",
        amount: totals.grandTotal,
        status: "POSTED",
        // paidAt = cuándo ocurrió realmente la venta offline; syncedAt = ahora.
        paidAt: saleTime,
        postedAt: now,
        syncedAt: now,
      },
    });
    await tx.paymentTender.create({
      data: {
        paymentId: payment.id,
        operationalDayId,
        method: "CASH",
        amount: totals.grandTotal,
      },
    });

    // Sincronización tardía sobre un día ya CERRADO (no aprobado): NO se altera el
    // snapshot silenciosamente. Se marca para revisión; el recálculo en aprobación
    // (que recalcula el summary) la incorporará bajo control del Master.
    if (lateSyncIntoClosedDay) {
      await tx.auditLog.create({
        data: {
          actorUserId: input.actorUserId,
          branchId: input.branchId,
          module: "sales",
          action: "LATE_OFFLINE_SYNC_INTO_CLOSED_DAY",
          entityType: "SaleOrder",
          entityId: order.id,
          metadataJson: {
            offlineId: input.offlineId,
            operationalDayId,
            saleOccurredAt: saleTime.toISOString(),
            note: "Venta offline pendiente de revisión: el día ya estaba cerrado.",
          },
        },
      });
    }

    return { orderId: order.id, orderNumber: order.orderNumber };
  });
  } catch (error) {
    // Reintento de sync no debe duplicar: el unique de offlineClientId protege.
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") {
      const existing = await prisma.saleOrder.findUnique({
        where: { offlineClientId: input.offlineId },
        select: { id: true, orderNumber: true },
      });
      if (existing) {
        return { orderId: existing.id, orderNumber: existing.orderNumber, alreadySynced: true };
      }
    }
    throw error;
  }

  await logAuditEvent({
    actorUserId: input.actorUserId,
    branchId: input.branchId,
    module: "sales",
    action: "OFFLINE_SALE_SYNCED",
    entityType: "SaleOrder",
    entityId: result.orderId,
    metadataJson: {
      offlineId: input.offlineId,
      originalCreatedAt: input.createdAt,
      cashSessionId: input.cashSessionId,
      operationalDayId,
      lateSyncIntoClosedDay,
      grandTotal: totals.grandTotal.toString(),
      lineCount: input.lines.length,
    },
  });

  return { ...result, alreadySynced: false };
}
