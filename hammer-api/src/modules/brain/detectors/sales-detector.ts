import type { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { riskScoreFor } from "@/modules/brain/scoring";
import type { BrainDecisionDraft, BrainDetectorContext } from "@/modules/brain/types";

function n(value: Prisma.Decimal | number | null | undefined) {
  return Number(value ?? 0);
}

function within(a: number, b: number) {
  return Math.abs(a - b) < 0.01;
}

export async function detectSalesDecisions(ctx: BrainDetectorContext): Promise<BrainDecisionDraft[]> {
  const decisions: BrainDecisionDraft[] = [];
  const midPoint = new Date(ctx.now.getTime() - Math.floor(ctx.days / 2) * 24 * 60 * 60 * 1000);
  const saleOrderScope = ctx.saleOrderId ? { id: ctx.saleOrderId } : {};

  const [orders, lines] = await Promise.all([
    prisma.saleOrder.findMany({
      where: {
        ...saleOrderScope,
        ...(ctx.branchId ? { branchId: ctx.branchId } : {}),
        ...(ctx.saleOrderId ? {} : {
          OR: [
            { payments: { some: { paidAt: { gte: ctx.dateFrom, lt: ctx.dateTo } } } },
            { manualInvoiceRegisteredAt: { gte: ctx.dateFrom, lt: ctx.dateTo } },
            { updatedAt: { gte: ctx.dateFrom, lt: ctx.dateTo } },
          ],
        }),
      },
      include: {
        branch: { select: { id: true, code: true, name: true } },
        lines: true,
        payments: { include: { tenders: true } },
      },
      take: ctx.limits.maxEntities,
      orderBy: { updatedAt: "desc" },
    }),
    prisma.saleOrderLine.findMany({
      where: {
        ...(ctx.productId ? { productId: ctx.productId } : {}),
        saleOrder: {
          ...saleOrderScope,
          ...(ctx.branchId ? { branchId: ctx.branchId } : {}),
          ...(ctx.saleOrderId ? {} : { payments: { some: { paidAt: { gte: ctx.dateFrom, lt: ctx.dateTo } } } }),
        },
      },
      include: {
        product: { select: { id: true, sku: true, name: true } },
        saleOrder: {
          select: {
            branchId: true,
            payments: { where: { status: "POSTED" }, select: { paidAt: true }, orderBy: { paidAt: "asc" }, take: 1 },
          },
        },
      },
      take: Math.min(ctx.limits.maxEntities * 3, 3000),
    }),
  ]);

  const auditLogs = orders.length
    ? await prisma.auditLog.findMany({
        where: {
          entityType: "SaleOrder",
          entityId: { in: orders.map((order) => order.id) },
          action: { in: ["SALE_ORDER_CANCELLED", "SALE_ORDER_VOIDED", "SALE_ORDER_CANCELLED_BY_MASTER"] },
        },
        select: { entityId: true, action: true, occurredAt: true },
        take: ctx.limits.maxEntities,
      })
    : [];
  const cancelledAuditByOrder = new Map(auditLogs.map((log) => [log.entityId, log]));

  for (const order of orders) {
    const computedSubtotal = order.lines.reduce((sum, line) => sum + n(line.lineSubtotal), 0);
    const computedGrandTotal = computedSubtotal + n(order.taxTotal) + n(order.transportAmount);
    const postedPayments = order.payments.filter((payment) => payment.status === "POSTED");
    const voidedPayments = order.payments.filter((payment) => payment.status === "VOIDED");
    const postedPaymentTotal = postedPayments.reduce((sum, payment) => sum + n(payment.amount), 0);
    const auditCancellation = cancelledAuditByOrder.get(order.id);
    const activeStatus = !["DRAFT", "CANCELLED", "RETURNED", "RETURN_REJECTED"].includes(order.status);

    if (!within(n(order.subtotal), computedSubtotal) || !within(n(order.grandTotal), computedGrandTotal)) {
      const repairable = order.status === "DRAFT" || order.status === "PENDING_PAYMENT";
      decisions.push({
        category: "SALES",
        severity: repairable ? "HIGH" : "CRITICAL",
        title: `Totales inconsistentes en orden ${order.orderNumber}`,
        description: `Las lineas calculan C$${computedGrandTotal.toFixed(2)}, pero la orden guarda C$${n(order.grandTotal).toFixed(2)}.`,
        recommendation: repairable
          ? "Recalcular totales desde lineas antes de enviar a caja o cobrar."
          : "Bloquear factura/impresion/cierre y enviar a revision tecnica Master; no reparar silenciosamente ventas cerradas.",
        branchId: order.branchId,
        confidenceScore: 99,
        impactAmount: Math.abs(computedGrandTotal - n(order.grandTotal)),
        riskScore: riskScoreFor(repairable ? "HIGH" : "CRITICAL", 99),
        proposedActionType: repairable ? "REPAIR_DRAFT_ORDER_TOTALS" : "BLOCK_ORDER_FOR_REVIEW",
        proposedActionJson: {
          type: repairable ? "REPAIR_DRAFT_ORDER_TOTALS" : "BLOCK_ORDER_FOR_REVIEW",
          dryRunSupported: true,
          requiresApproval: !repairable,
          target: { entityType: "SaleOrder", entityId: order.id },
          expectedEffect: repairable ? "Reescribir subtotal/grandTotal desde SaleOrderLine." : "Mantener orden bloqueada hasta revision tecnica.",
          saleOrderId: order.id,
        },
        evidenceJson: {
          detector: "SALES_INTEGRITY_DETECTOR",
          rootCause: "El total persistido no coincide con la suma tecnica de SaleOrderLine.",
          diagnosis: "Mismatch de cabecera contra lineas.",
          orderNumber: order.orderNumber,
          orderStatus: order.status,
          storedSubtotal: n(order.subtotal),
          storedGrandTotal: n(order.grandTotal),
          computedSubtotal,
          computedGrandTotal,
          postedPaymentTotal,
          blocksOperationalDayClose: !repairable,
          actionPlan: repairable ? "REPAIR_DRAFT_ORDER_TOTALS" : "BLOCK_ORDER_FOR_REVIEW",
        },
        sourceJson: { detector: "sales-detector", mode: ctx.mode, scope: ctx.scope, problemCode: "ORDER_TOTAL_MISMATCH" },
        fingerprintParts: ["brain", "SALES_INTEGRITY_DETECTOR", order.branchId, ctx.businessDate ?? "range", "SaleOrder", order.id, "ORDER_TOTAL_MISMATCH"],
      });
    }

    if (postedPayments.length > 0 && !within(postedPaymentTotal, n(order.grandTotal))) {
      decisions.push({
        category: "SALES",
        severity: "CRITICAL",
        title: `Pago no coincide con total de orden ${order.orderNumber}`,
        description: `Pagos POSTED suman C$${postedPaymentTotal.toFixed(2)} contra total guardado C$${n(order.grandTotal).toFixed(2)}.`,
        recommendation: "Bloquear cierre y factura manual hasta revisar pagos, tenders y total de orden.",
        branchId: order.branchId,
        confidenceScore: 98,
        impactAmount: Math.abs(postedPaymentTotal - n(order.grandTotal)),
        riskScore: riskScoreFor("CRITICAL", 98),
        proposedActionType: "BLOCK_ORDER_FOR_REVIEW",
        proposedActionJson: { type: "BLOCK_ORDER_FOR_REVIEW", dryRunSupported: true, requiresApproval: true, target: { entityType: "SaleOrder", entityId: order.id }, expectedEffect: "Evitar documentos/cierre con pago descuadrado.", saleOrderId: order.id },
        evidenceJson: {
          detector: "SALES_INTEGRITY_DETECTOR",
          rootCause: "Payment POSTED no cuadra contra SaleOrder.grandTotal.",
          diagnosis: "Mismatch de pago contra cabecera.",
          orderNumber: order.orderNumber,
          postedPaymentTotal,
          storedGrandTotal: n(order.grandTotal),
          postedPaymentIds: postedPayments.map((payment) => payment.id),
          blocksOperationalDayClose: true,
        },
        sourceJson: { detector: "sales-detector", mode: ctx.mode, scope: ctx.scope, problemCode: "PAYMENT_TOTAL_MISMATCH" },
        fingerprintParts: ["brain", "SALES_INTEGRITY_DETECTOR", order.branchId, ctx.businessDate ?? "range", "SaleOrder", order.id, "PAYMENT_TOTAL_MISMATCH"],
      });
    }

    if (postedPayments.some((payment) => payment.tenders.length === 0)) {
      decisions.push({
        category: "SALES",
        severity: "HIGH",
        title: `Pago sin desglose de tender en orden ${order.orderNumber}`,
        description: "Hay Payment POSTED sin PaymentTender, lo que impide recalcular caja con precision.",
        recommendation: "Revisar metodo de pago y reconstruir tenders antes de cerrar caja.",
        branchId: order.branchId,
        confidenceScore: 95,
        riskScore: riskScoreFor("HIGH", 95),
        proposedActionType: "BLOCK_ORDER_FOR_REVIEW",
        proposedActionJson: { type: "BLOCK_ORDER_FOR_REVIEW", dryRunSupported: true, requiresApproval: true, target: { entityType: "SaleOrder", entityId: order.id }, expectedEffect: "Forzar revision de desglose de pago.", saleOrderId: order.id },
        evidenceJson: {
          detector: "SALES_INTEGRITY_DETECTOR",
          rootCause: "Payment POSTED no tiene filas PaymentTender.",
          diagnosis: "Caja no puede distinguir efectivo/tarjeta/transferencia.",
          paymentIds: postedPayments.filter((payment) => payment.tenders.length === 0).map((payment) => payment.id),
          blocksOperationalDayClose: true,
        },
        sourceJson: { detector: "sales-detector", mode: ctx.mode, scope: ctx.scope, problemCode: "POSTED_PAYMENT_WITHOUT_TENDER" },
        fingerprintParts: ["brain", "SALES_INTEGRITY_DETECTOR", order.branchId, ctx.businessDate ?? "range", "SaleOrder", order.id, "POSTED_PAYMENT_WITHOUT_TENDER"],
      });
    }

    if (activeStatus && auditCancellation) {
      decisions.push({
        category: "SALES",
        severity: "CRITICAL",
        title: `Orden activa con auditoria de anulacion ${order.orderNumber}`,
        description: `La orden sigue en estado ${order.status}, pero tiene audit ${auditCancellation.action}.`,
        recommendation: "Bloquear cierre y corregir estado/pagos/inventario en revision tecnica.",
        branchId: order.branchId,
        confidenceScore: 99,
        impactAmount: n(order.grandTotal),
        riskScore: riskScoreFor("CRITICAL", 99),
        proposedActionType: "BLOCK_ORDER_FOR_REVIEW",
        proposedActionJson: { type: "BLOCK_ORDER_FOR_REVIEW", dryRunSupported: true, requiresApproval: true, target: { entityType: "SaleOrder", entityId: order.id }, expectedEffect: "Evitar venta zombie activa despues de anulacion.", saleOrderId: order.id },
        evidenceJson: {
          detector: "SALES_INTEGRITY_DETECTOR",
          rootCause: "AuditLog indica anulacion, pero SaleOrder.status no fue persistido como CANCELLED.",
          diagnosis: "Venta zombie activa/anulada.",
          auditAction: auditCancellation.action,
          auditAt: auditCancellation.occurredAt,
          orderStatus: order.status,
          blocksOperationalDayClose: true,
        },
        sourceJson: { detector: "sales-detector", mode: ctx.mode, scope: ctx.scope, problemCode: "ACTIVE_ORDER_WITH_CANCELLATION_AUDIT" },
        fingerprintParts: ["brain", "SALES_INTEGRITY_DETECTOR", order.branchId, ctx.businessDate ?? "range", "SaleOrder", order.id, "ACTIVE_ORDER_WITH_CANCELLATION_AUDIT"],
      });
    }

    if (activeStatus && postedPayments.length === 0 && voidedPayments.length > 0) {
      decisions.push({
        category: "SALES",
        severity: "CRITICAL",
        title: `Orden activa sin pago valido ${order.orderNumber}`,
        description: "Todos los pagos estan VOIDED, pero la orden sigue activa.",
        recommendation: "Bloquear cierre; revisar si debe quedar CANCELLED o re-pagarse.",
        branchId: order.branchId,
        confidenceScore: 98,
        impactAmount: n(order.grandTotal),
        riskScore: riskScoreFor("CRITICAL", 98),
        proposedActionType: "BLOCK_ORDER_FOR_REVIEW",
        proposedActionJson: { type: "BLOCK_ORDER_FOR_REVIEW", dryRunSupported: true, requiresApproval: true, target: { entityType: "SaleOrder", entityId: order.id }, expectedEffect: "Evitar contar orden activa sin pago POSTED.", saleOrderId: order.id },
        evidenceJson: {
          detector: "SALES_INTEGRITY_DETECTOR",
          rootCause: "No existe Payment POSTED para una orden en estado activo.",
          diagnosis: "Orden activa con pagos anulados.",
          voidedPaymentIds: voidedPayments.map((payment) => payment.id),
          blocksOperationalDayClose: true,
        },
        sourceJson: { detector: "sales-detector", mode: ctx.mode, scope: ctx.scope, problemCode: "ACTIVE_ORDER_WITH_ONLY_VOIDED_PAYMENTS" },
        fingerprintParts: ["brain", "SALES_INTEGRITY_DETECTOR", order.branchId, ctx.businessDate ?? "range", "SaleOrder", order.id, "ACTIVE_ORDER_WITH_ONLY_VOIDED_PAYMENTS"],
      });
    }
  }

  const branchTotals = new Map<string, { branchId: string; code: string; name: string; total: number; count: number }>();
  for (const order of orders) {
    const current = branchTotals.get(order.branchId) ?? {
      branchId: order.branchId,
      code: order.branch.code,
      name: order.branch.name,
      total: 0,
      count: 0,
    };
    current.total += n(order.grandTotal);
    current.count++;
    branchTotals.set(order.branchId, current);
  }

  const branchRows = [...branchTotals.values()].filter((row) => row.count >= 3);
  const average = branchRows.length > 0 ? branchRows.reduce((sum, row) => sum + row.total, 0) / branchRows.length : 0;
  for (const row of branchRows) {
    if (average > 0 && row.total < average * 0.55) {
      decisions.push({
        category: "SALES",
        severity: "MEDIUM",
        title: `Sucursal bajo promedio de ventas: ${row.code}`,
        description: `${row.name} vendio C$${row.total.toFixed(2)} frente a un promedio de C$${average.toFixed(2)}.`,
        recommendation: "Revisar stock, horarios pico, precios y demanda local antes de ajustar metas.",
        branchId: row.branchId,
        confidenceScore: 0.76,
        impactAmount: average - row.total,
        riskScore: riskScoreFor("MEDIUM", 0.76),
        proposedActionType: "REVIEW_BRANCH_SALES_PERFORMANCE",
        evidenceJson: { branchTotal: row.total, averageBranchTotal: average, orders: row.count },
        sourceJson: { detector: "sales-detector" },
        fingerprintParts: ["sales", "branch-below-average", row.branchId],
      });
    }
  }

  const productTrend = new Map<string, { productId: string; sku: string; name: string; early: number; late: number }>();
  for (const line of lines) {
    const row = productTrend.get(line.productId) ?? {
      productId: line.productId,
      sku: line.product.sku,
      name: line.product.name,
      early: 0,
      late: 0,
    };
    const paidAt = line.saleOrder.payments[0]?.paidAt;
    if (!paidAt) continue;
    if (paidAt >= midPoint) row.late += n(line.quantity);
    else row.early += n(line.quantity);
    productTrend.set(line.productId, row);
  }

  for (const row of productTrend.values()) {
    if (row.early + row.late < 10) continue;
    if (row.late >= row.early * 2 && row.late >= 8) {
      decisions.push({
        category: "SALES",
        severity: "INFO",
        title: `Tendencia creciente: ${row.sku}`,
        description: `${row.name} duplico ritmo reciente (${row.early} vs ${row.late} unidades).`,
        recommendation: "Validar inventario y punto de reorden para no perder ventas por quiebre.",
        productId: row.productId,
        confidenceScore: 0.72,
        riskScore: riskScoreFor("INFO", 0.72),
        proposedActionType: "REVIEW_PRODUCT_DEMAND_TREND",
        evidenceJson: { previousHalfUnits: row.early, recentHalfUnits: row.late },
        sourceJson: { detector: "sales-detector" },
        fingerprintParts: ["sales", "trend-up", row.productId, ctx.branchId ?? "all"],
      });
    } else if (row.early >= row.late * 2 && row.early >= 8) {
      decisions.push({
        category: "SALES",
        severity: "LOW",
        title: `Tendencia decreciente: ${row.sku}`,
        description: `${row.name} bajo de ${row.early} a ${row.late} unidades entre mitades del periodo.`,
        recommendation: "Revisar precio, disponibilidad y rotacion antes de reponer agresivamente.",
        productId: row.productId,
        confidenceScore: 0.7,
        riskScore: riskScoreFor("LOW", 0.7),
        proposedActionType: "REVIEW_PRODUCT_DEMAND_TREND",
        evidenceJson: { previousHalfUnits: row.early, recentHalfUnits: row.late },
        sourceJson: { detector: "sales-detector" },
        fingerprintParts: ["sales", "trend-down", row.productId, ctx.branchId ?? "all"],
      });
    }
  }

  return decisions;
}
