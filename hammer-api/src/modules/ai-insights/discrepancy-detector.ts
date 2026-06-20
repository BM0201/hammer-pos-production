/**
 * AI Insights — Discrepancy Detector
 *
 * Identifies data inconsistencies and suspicious patterns:
 *  1. Unusual discounts (too high, out of policy)
 *  2. Potential duplicate transactions
 *  3. Price inconsistencies (sale price vs list price)
 *  4. Anomalous return patterns
 *  5. Branch sales deviations (expected vs actual)
 */

import { prisma } from "@/lib/prisma";
import {
  mean,
  stddev,
  zScore,
  iqrBounds,
  daysAgo,
  type DiscrepancyInsight,
  type Severity,
} from "./analyzer";

const DAYS_WINDOW = 7;

function formatActor(user: { fullName?: string | null; username?: string | null } | null | undefined) {
  if (!user) return "Usuario";
  const fullName = user.fullName?.trim();
  const username = user.username?.trim();
  if (fullName && username) return `${fullName} (usuario: ${username})`;
  return fullName || username || "Usuario";
}

export async function detectDiscrepancies(
  branchId?: string,
  days = DAYS_WINDOW,
): Promise<DiscrepancyInsight[]> {
  const since = daysAgo(days);
  const discrepancies: DiscrepancyInsight[] = [];

  const [unusualDiscounts, duplicates, priceInconsistencies, returns, branchDeviations] =
    await Promise.all([
      detectUnusualDiscounts(since, branchId),
      detectPotentialDuplicates(since, branchId),
      detectPriceInconsistencies(since, branchId),
      detectAnomalousReturns(since, branchId),
      branchId ? [] : detectBranchDeviations(since),
    ]);

  discrepancies.push(
    ...unusualDiscounts,
    ...duplicates,
    ...priceInconsistencies,
    ...returns,
    ...branchDeviations,
  );

  const sevOrder: Record<Severity, number> = { critical: 0, high: 1, medium: 2, low: 3, info: 4 };
  discrepancies.sort((a, b) => sevOrder[a.severity] - sevOrder[b.severity]);

  return discrepancies.slice(0, 25);
}

// ─── 1. Unusual Discounts ────────────────────────────────────────

async function detectUnusualDiscounts(
  since: Date,
  branchId?: string,
): Promise<DiscrepancyInsight[]> {
  const discrepancies: DiscrepancyInsight[] = [];

  const ordersWithDiscount = await prisma.saleOrder.findMany({
    where: {
      status: { in: ["PAID", "DISPATCH_PENDING", "DISPATCHED"] },
      createdAt: { gte: since },
      discountTotal: { gt: 0 },
      ...(branchId ? { branchId } : {}),
    },
    select: {
      id: true,
      orderNumber: true,
      grandTotal: true,
      subtotal: true,
      discountTotal: true,
      createdAt: true,
      branch: { select: { name: true } },
      createdBy: { select: { username: true, fullName: true } },
    },
  });

  if (ordersWithDiscount.length < 3) return discrepancies;

  // Calculate discount rates
  const discountRates = ordersWithDiscount.map((o) => {
    const subtotal = Number(o.subtotal);
    const discount = Number(o.discountTotal);
    return {
      ...o,
      discountRate: subtotal > 0 ? (discount / subtotal) * 100 : 0,
    };
  });

  const rates = discountRates.map((d) => d.discountRate);
  const m = mean(rates);
  const sd = stddev(rates);
  const bounds = iqrBounds(rates);

  for (const order of discountRates) {
    // Flag orders with discount rate > 30% or significantly above average
    if (order.discountRate > 30 || (sd > 0 && zScore(order.discountRate, m, sd) > 2.5)) {
      discrepancies.push({
        id: `disc-unusual-disc-${order.id}`,
        category: "discrepancy",
        title: `Descuento inusual: ${order.discountRate.toFixed(1)}% en orden ${order.orderNumber}`,
        description: `Orden ${order.orderNumber} en "${order.branch.name}" por ${formatActor(order.createdBy)} tiene un descuento del ${order.discountRate.toFixed(1)}% (C$ ${Number(order.discountTotal).toFixed(2)} de C$ ${Number(order.subtotal).toFixed(2)}). Promedio de descuento: ${m.toFixed(1)}%.`,
        severity: order.discountRate > 50 ? "critical" : order.discountRate > 30 ? "high" : "medium",
        discrepancyType: "unusual_discount",
        entityId: order.id,
        entityName: `Orden ${order.orderNumber}`,
        details: {
          orderNumber: order.orderNumber,
          branch: order.branch.name,
          user: formatActor(order.createdBy),
          subtotal: Number(order.subtotal),
          discount: Number(order.discountTotal),
          discountRate: `${order.discountRate.toFixed(1)}%`,
          avgDiscountRate: `${m.toFixed(1)}%`,
          date: order.createdAt.toISOString(),
        },
        impact: `Descuento excesivo: C$ ${Number(order.discountTotal).toFixed(2)}`,
        createdAt: new Date().toISOString(),
      });
    }
  }

  return discrepancies.slice(0, 5);
}

// ─── 2. Potential Duplicates ─────────────────────────────────────

async function detectPotentialDuplicates(
  since: Date,
  branchId?: string,
): Promise<DiscrepancyInsight[]> {
  const discrepancies: DiscrepancyInsight[] = [];

  // Find orders with same total, same branch, within short time window
  const orders = await prisma.saleOrder.findMany({
    where: {
      status: { in: ["PAID", "DISPATCH_PENDING", "DISPATCHED"] },
      createdAt: { gte: since },
      ...(branchId ? { branchId } : {}),
    },
    select: {
      id: true,
      orderNumber: true,
      grandTotal: true,
      branchId: true,
      createdByUserId: true,
      createdAt: true,
      branch: { select: { name: true } },
      createdBy: { select: { username: true, fullName: true } },
    },
    orderBy: { createdAt: "asc" },
  });

  // Check for near-duplicates (same total, same branch, within 5 minutes)
  for (let i = 0; i < orders.length; i++) {
    for (let j = i + 1; j < orders.length; j++) {
      const a = orders[i];
      const b = orders[j];

      if (a.branchId !== b.branchId) continue;

      const timeDiff = Math.abs(b.createdAt.getTime() - a.createdAt.getTime()) / 60000; // minutes
      if (timeDiff > 5) break; // Orders are sorted by time, so no need to check further

      const totalA = Number(a.grandTotal);
      const totalB = Number(b.grandTotal);

      if (Math.abs(totalA - totalB) < 0.01 && totalA > 0) {
        discrepancies.push({
          id: `disc-dup-${a.id}-${b.id}`,
          category: "discrepancy",
          title: `Posible transacción duplicada`,
          description: `Órdenes ${a.orderNumber} y ${b.orderNumber} en "${a.branch.name}" con el mismo total (C$ ${totalA.toFixed(2)}) a ${timeDiff.toFixed(0)} minutos de diferencia. Verificar si es intencional.`,
          severity: timeDiff < 2 ? "high" : "medium",
          discrepancyType: "duplicate_transaction",
          entityId: a.id,
          entityName: `Órdenes ${a.orderNumber} / ${b.orderNumber}`,
          details: {
            orderA: a.orderNumber,
            orderB: b.orderNumber,
            total: `C$ ${totalA.toFixed(2)}`,
            timeDiffMinutes: timeDiff.toFixed(1),
            branch: a.branch.name,
            userA: formatActor(a.createdBy),
            userB: formatActor(b.createdBy),
          },
          impact: `Posible cobro duplicado de C$ ${totalA.toFixed(2)}`,
          createdAt: new Date().toISOString(),
        });
      }
    }
  }

  return discrepancies.slice(0, 5);
}

// ─── 3. Price Inconsistencies ────────────────────────────────────

async function detectPriceInconsistencies(
  since: Date,
  branchId?: string,
): Promise<DiscrepancyInsight[]> {
  const discrepancies: DiscrepancyInsight[] = [];

  // Get sale lines with product list prices
  const lines = await prisma.saleOrderLine.findMany({
    where: {
      saleOrder: {
        status: { in: ["PAID", "DISPATCH_PENDING", "DISPATCHED"] },
        createdAt: { gte: since },
        ...(branchId ? { branchId } : {}),
      },
    },
    select: {
      id: true,
      unitPrice: true,
      discountAmount: true,
      productId: true,
      product: { select: { name: true, standardSalePrice: true } },
      saleOrder: {
        select: { orderNumber: true, branch: { select: { name: true } } },
      },
    },
  });

  // Check for significant price deviations from list price
  for (const line of lines) {
    const listPrice = Number(line.product.standardSalePrice ?? 0);
    const salePrice = Number(line.unitPrice);
    const discount = Number(line.discountAmount ?? 0);

    if (listPrice <= 0) continue;

    const effectivePrice = salePrice - discount;
    const deviation = ((effectivePrice - listPrice) / listPrice) * 100;

    // Flag if sold above list price (possible error) or way below (>40% off)
    if (deviation > 10) {
      discrepancies.push({
        id: `disc-price-above-${line.id}`,
        category: "discrepancy",
        title: `Precio de venta superior al de lista: ${line.product.name}`,
        description: `"${line.product.name}" vendido a C$ ${salePrice.toFixed(2)} (precio de lista: C$ ${listPrice.toFixed(2)}, +${deviation.toFixed(1)}%) en orden ${line.saleOrder.orderNumber}. Posible error de captura.`,
        severity: deviation > 30 ? "high" : "medium",
        discrepancyType: "price_inconsistency",
        entityId: line.productId,
        entityName: line.product.name,
        details: {
          listPrice: `C$ ${listPrice.toFixed(2)}`,
          salePrice: `C$ ${salePrice.toFixed(2)}`,
          deviation: `+${deviation.toFixed(1)}%`,
          order: line.saleOrder.orderNumber,
          branch: line.saleOrder.branch.name,
        },
        createdAt: new Date().toISOString(),
      });
    } else if (deviation < -40) {
      discrepancies.push({
        id: `disc-price-below-${line.id}`,
        category: "discrepancy",
        title: `Venta muy por debajo del precio de lista: ${line.product.name}`,
        description: `"${line.product.name}" vendido efectivamente a C$ ${effectivePrice.toFixed(2)} (lista: C$ ${listPrice.toFixed(2)}, ${deviation.toFixed(1)}%) en ${line.saleOrder.branch.name}. Verificar autorización.`,
        severity: "high",
        discrepancyType: "price_inconsistency",
        entityId: line.productId,
        entityName: line.product.name,
        details: {
          listPrice: `C$ ${listPrice.toFixed(2)}`,
          effectivePrice: `C$ ${effectivePrice.toFixed(2)}`,
          deviation: `${deviation.toFixed(1)}%`,
          order: line.saleOrder.orderNumber,
          branch: line.saleOrder.branch.name,
        },
        createdAt: new Date().toISOString(),
      });
    }
  }

  return discrepancies.slice(0, 8);
}

// ─── 4. Anomalous Returns ────────────────────────────────────────

async function detectAnomalousReturns(
  since: Date,
  branchId?: string,
): Promise<DiscrepancyInsight[]> {
  const discrepancies: DiscrepancyInsight[] = [];

  // Count returns per branch/user
  const returnOrders = await prisma.saleOrder.findMany({
    where: {
      status: "RETURNED",
      updatedAt: { gte: since },
      ...(branchId ? { branchId } : {}),
    },
    select: {
      id: true,
      orderNumber: true,
      grandTotal: true,
      branchId: true,
      createdByUserId: true,
      branch: { select: { name: true } },
      createdBy: { select: { username: true, fullName: true } },
    },
  });

  // Count total orders for context
  const totalOrders = await prisma.saleOrder.count({
    where: {
      status: { in: ["PAID", "DISPATCH_PENDING", "DISPATCHED", "RETURNED"] },
      createdAt: { gte: since },
      ...(branchId ? { branchId } : {}),
    },
  });

  const returnRate = totalOrders > 0 ? (returnOrders.length / totalOrders) * 100 : 0;

  if (returnRate > 10 && returnOrders.length >= 3) {
    discrepancies.push({
      id: "disc-return-rate",
      category: "discrepancy",
      title: `Tasa de devoluciones elevada: ${returnRate.toFixed(1)}%`,
      description: `${returnOrders.length} devoluciones de ${totalOrders} órdenes (${returnRate.toFixed(1)}%) en los últimos ${DAYS_WINDOW} días. Valor devuelto: C$ ${returnOrders.reduce((s, o) => s + Number(o.grandTotal), 0).toFixed(2)}.`,
      severity: returnRate > 20 ? "critical" : "high",
      discrepancyType: "anomalous_returns",
      entityId: "returns-global",
      entityName: "Devoluciones",
      details: {
        returnCount: returnOrders.length,
        totalOrders,
        returnRate: `${returnRate.toFixed(1)}%`,
        totalReturnValue: returnOrders.reduce((s, o) => s + Number(o.grandTotal), 0),
      },
      impact: `C$ ${returnOrders.reduce((s, o) => s + Number(o.grandTotal), 0).toFixed(2)} en devoluciones`,
      createdAt: new Date().toISOString(),
    });
  }

  // Check per-user return patterns
  const userReturnCount = new Map<string, { count: number; actorLabel: string; branch: string }>();
  for (const r of returnOrders) {
    const key = r.createdByUserId;
    if (!userReturnCount.has(key)) {
      userReturnCount.set(key, { count: 0, actorLabel: formatActor(r.createdBy), branch: r.branch.name });
    }
    userReturnCount.get(key)!.count++;
  }

  for (const [userId, data] of userReturnCount) {
    if (data.count >= 3) {
      discrepancies.push({
        id: `disc-return-user-${userId}`,
        category: "discrepancy",
        title: `Alto número de devoluciones por usuario: ${data.actorLabel}`,
        description: `${data.actorLabel} (${data.branch}) procesó ${data.count} devoluciones en los últimos ${DAYS_WINDOW} días. Verificar procedimiento.`,
        severity: data.count >= 5 ? "high" : "medium",
        discrepancyType: "anomalous_returns",
        entityId: userId,
        entityName: data.actorLabel,
        details: {
          user: data.actorLabel,
          returnCount: data.count,
          branch: data.branch,
        },
        createdAt: new Date().toISOString(),
      });
    }
  }

  return discrepancies;
}

// ─── 5. Branch Deviations ────────────────────────────────────────

async function detectBranchDeviations(since: Date): Promise<DiscrepancyInsight[]> {
  const discrepancies: DiscrepancyInsight[] = [];

  // Compare branches against each other
  const branchSales = await prisma.saleOrder.groupBy({
    by: ["branchId"],
    _sum: { grandTotal: true },
    _count: { id: true },
    where: {
      status: { in: ["PAID", "DISPATCH_PENDING", "DISPATCHED"] },
      createdAt: { gte: since },
    },
  });

  if (branchSales.length < 2) return discrepancies;

  const totals = branchSales.map((b) => Number(b._sum.grandTotal ?? 0));
  const m = mean(totals);
  const sd = stddev(totals);

  for (const bs of branchSales) {
    const total = Number(bs._sum.grandTotal ?? 0);
    const z = zScore(total, m, sd);

    if (z < -1.5 && sd > 0) {
      const branch = await prisma.branch.findUnique({
        where: { id: bs.branchId },
        select: { name: true, code: true },
      });

      const deficit = m - total;
      discrepancies.push({
        id: `disc-branch-${bs.branchId}`,
        category: "discrepancy",
        title: `Ventas por debajo del esperado: ${branch?.name}`,
        description: `"${branch?.name}" (${branch?.code}) facturó C$ ${total.toFixed(2)} vs promedio de red C$ ${m.toFixed(2)} — un déficit de C$ ${deficit.toFixed(2)} (${((deficit / Math.max(m, 1)) * 100).toFixed(1)}% debajo).`,
        severity: Math.abs(z) > 2.5 ? "high" : "medium",
        discrepancyType: "branch_deviation",
        entityId: bs.branchId,
        entityName: branch?.name ?? bs.branchId,
        details: {
          branchTotal: total,
          networkAverage: m,
          deficit,
          deviationPercent: `${((deficit / Math.max(m, 1)) * 100).toFixed(1)}%`,
          transactions: bs._count.id,
        },
        impact: `Déficit de C$ ${deficit.toFixed(2)} vs promedio de red`,
        createdAt: new Date().toISOString(),
      });
    }
  }

  return discrepancies;
}
