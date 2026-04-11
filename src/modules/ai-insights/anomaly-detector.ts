/**
 * AI Insights — Anomaly Detector
 *
 * Detects unusual patterns using statistical methods:
 *  1. Sales volume anomalies by hour/day (Z-Score + IQR)
 *  2. Price anomalies — products sold at significantly different prices
 *  3. Inventory anomalies — unexplained stock discrepancies
 *  4. Cashier anomalies — individual cashier patterns vs. peers
 *  5. Branch performance anomalies — branches outside normal range
 *
 * Detection methods:
 *  - Z-Score (|z| > 2.5 for critical, > 2.0 for high, > 1.5 for medium)
 *  - IQR fence method for robust outlier detection
 *  - Peer comparison (cashier vs. peer average, branch vs. network average)
 */

import { prisma } from "@/lib/prisma";
import {
  mean,
  stddev,
  zScore,
  iqrBounds,
  daysAgo,
  dayOfWeekLabel,
  hourLabel,
  type AnomalyInsight,
  type Severity,
} from "./analyzer";

const DAYS_WINDOW = 7;

export async function detectAnomalies(
  branchId?: string,
  days = DAYS_WINDOW,
): Promise<AnomalyInsight[]> {
  const since = daysAgo(days);
  const anomalies: AnomalyInsight[] = [];

  // Run all detectors in parallel
  const [salesAnomalies, priceAnomalies, inventoryAnomalies, cashierAnomalies, branchAnomalies] =
    await Promise.all([
      detectSalesVolumeAnomalies(since, branchId),
      detectPriceAnomalies(since, branchId),
      detectInventoryAnomalies(branchId),
      detectCashierAnomalies(since, branchId),
      detectBranchAnomalies(since),
    ]);

  anomalies.push(...salesAnomalies, ...priceAnomalies, ...inventoryAnomalies, ...cashierAnomalies);
  if (!branchId) anomalies.push(...branchAnomalies);

  // Sort by severity
  const sevOrder: Record<Severity, number> = { critical: 0, high: 1, medium: 2, low: 3, info: 4 };
  anomalies.sort((a, b) => sevOrder[a.severity] - sevOrder[b.severity]);

  return anomalies.slice(0, 30);
}

// ─── 1. Sales Volume Anomalies ───────────────────────────────────

async function detectSalesVolumeAnomalies(
  since: Date,
  branchId?: string,
): Promise<AnomalyInsight[]> {
  const anomalies: AnomalyInsight[] = [];

  const orders = await prisma.saleOrder.findMany({
    where: {
      status: { in: ["PAID", "DISPATCH_PENDING", "DISPATCHED"] },
      createdAt: { gte: since },
      ...(branchId ? { branchId } : {}),
    },
    select: {
      id: true,
      grandTotal: true,
      createdAt: true,
      branch: { select: { name: true } },
    },
  });

  if (orders.length < 5) return anomalies;

  // Group by hour-of-day
  const hourlyTotals = new Map<number, number[]>();
  for (const o of orders) {
    const h = o.createdAt.getHours();
    if (!hourlyTotals.has(h)) hourlyTotals.set(h, []);
    hourlyTotals.get(h)!.push(Number(o.grandTotal));
  }

  // Check each hour's total against overall distribution
  const allTotals = orders.map((o) => Number(o.grandTotal));
  const m = mean(allTotals);
  const sd = stddev(allTotals);

  for (const [hour, totals] of hourlyTotals) {
    const hourAvg = mean(totals);
    const z = zScore(hourAvg, m, sd);

    if (Math.abs(z) > 2.0) {
      const sev: Severity = Math.abs(z) > 2.5 ? "high" : "medium";
      const direction = z > 0 ? "inusualmente altas" : "inusualmente bajas";
      anomalies.push({
        id: `anom-sales-hour-${hour}`,
        category: "anomaly",
        title: `Ventas ${direction} a las ${hourLabel(hour)}`,
        description: `Las ventas promedio a las ${hourLabel(hour)} son C$ ${hourAvg.toFixed(2)} — ${direction} comparado con el promedio general de C$ ${m.toFixed(2)} (z-score: ${z.toFixed(2)}).`,
        severity: sev,
        entityType: "sale",
        entityId: `hour-${hour}`,
        entityName: `Franja horaria ${hourLabel(hour)}`,
        detectedValue: hourAvg,
        expectedRange: { min: m - 2 * sd, max: m + 2 * sd },
        deviationPercent: Math.round(Math.abs((hourAvg - m) / Math.max(m, 1)) * 100),
        impact: `${totals.length} transacciones en esta franja horaria`,
        createdAt: new Date().toISOString(),
      });
    }
  }

  // Check for individual unusually large transactions
  const bounds = iqrBounds(allTotals);
  for (const o of orders) {
    const total = Number(o.grandTotal);
    if (total > bounds.upper * 1.5 && total > m + 3 * sd) {
      anomalies.push({
        id: `anom-large-tx-${o.id}`,
        category: "anomaly",
        title: `Transacción inusualmente alta: C$ ${total.toFixed(2)}`,
        description: `Orden en "${o.branch.name}" por C$ ${total.toFixed(2)} — significativamente mayor al rango esperado (C$ ${bounds.upper.toFixed(2)} máximo IQR). Verificar legitimidad.`,
        severity: "high",
        entityType: "sale",
        entityId: o.id,
        entityName: `Orden en ${o.branch.name}`,
        detectedValue: total,
        expectedRange: { min: bounds.lower, max: bounds.upper },
        deviationPercent: Math.round(((total - m) / Math.max(m, 1)) * 100),
        createdAt: new Date().toISOString(),
      });
    }
  }

  return anomalies;
}

// ─── 2. Price Anomalies ──────────────────────────────────────────

async function detectPriceAnomalies(
  since: Date,
  branchId?: string,
): Promise<AnomalyInsight[]> {
  const anomalies: AnomalyInsight[] = [];

  // Get sale lines with product info
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
      productId: true,
      unitPrice: true,
      quantity: true,
      discountAmount: true,
      product: { select: { name: true, standardSalePrice: true } },
    },
  });

  // Group by product and check unit prices
  const productPrices = new Map<string, { prices: number[]; name: string; listPrice: number }>();
  for (const line of lines) {
    const pid = line.productId;
    if (!productPrices.has(pid)) {
      productPrices.set(pid, {
        prices: [],
        name: line.product.name,
        listPrice: Number(line.product.standardSalePrice ?? 0),
      });
    }
    productPrices.get(pid)!.prices.push(Number(line.unitPrice));
  }

  for (const [productId, data] of productPrices) {
    if (data.prices.length < 3) continue;

    const m = mean(data.prices);
    const sd = stddev(data.prices);
    const bounds = iqrBounds(data.prices);

    // Find outlier prices
    for (const price of data.prices) {
      const z = zScore(price, m, sd);
      if (Math.abs(z) > 2.5 && (price < bounds.lower || price > bounds.upper)) {
        const direction = price > m ? "por encima" : "por debajo";
        anomalies.push({
          id: `anom-price-${productId}-${price}`,
          category: "anomaly",
          title: `Precio anómalo: ${data.name}`,
          description: `"${data.name}" vendido a C$ ${price.toFixed(2)} — ${direction} del promedio C$ ${m.toFixed(2)}. Precio de lista: C$ ${data.listPrice.toFixed(2)}.`,
          severity: Math.abs(z) > 3 ? "high" : "medium",
          entityType: "product",
          entityId: productId,
          entityName: data.name,
          detectedValue: price,
          expectedRange: { min: bounds.lower, max: bounds.upper },
          deviationPercent: Math.round(Math.abs((price - m) / Math.max(m, 1)) * 100),
          createdAt: new Date().toISOString(),
        });
        break; // One anomaly per product is enough
      }
    }
  }

  return anomalies.slice(0, 10);
}

// ─── 3. Inventory Anomalies ──────────────────────────────────────

async function detectInventoryAnomalies(branchId?: string): Promise<AnomalyInsight[]> {
  const anomalies: AnomalyInsight[] = [];

  // Products with negative or zero stock that had recent sales
  const recentSince = daysAgo(7);
  const balances = await prisma.inventoryBalance.findMany({
    where: {
      ...(branchId ? { branchId } : {}),
      quantityOnHand: { lte: 0 },
    },
    select: {
      productId: true,
      quantityOnHand: true,
      branchId: true,
      product: { select: { name: true, isActive: true } },
      branch: { select: { name: true } },
    },
  });

  for (const b of balances) {
    if (!b.product.isActive) continue;

    const recentMovements = await prisma.inventoryMovement.count({
      where: {
        productId: b.productId,
        branchId: b.branchId,
        createdAt: { gte: recentSince },
      },
    });

    if (recentMovements > 0) {
      anomalies.push({
        id: `anom-inv-${b.branchId}-${b.productId}`,
        category: "anomaly",
        title: `Stock agotado con actividad reciente: ${b.product.name}`,
        description: `"${b.product.name}" en "${b.branch.name}" tiene stock ${Number(b.quantityOnHand)} pero tuvo ${recentMovements} movimientos en los últimos 7 días. Posible faltante o error.`,
        severity: Number(b.quantityOnHand) < 0 ? "high" : "medium",
        entityType: "inventory",
        entityId: `${b.branchId}-${b.productId}`,
        entityName: `${b.product.name} @ ${b.branch.name}`,
        detectedValue: Number(b.quantityOnHand),
        expectedRange: { min: 0, max: 100 },
        deviationPercent: 100,
        impact: `${recentMovements} movimientos recientes con stock en cero/negativo`,
        createdAt: new Date().toISOString(),
      });
    }
  }

  return anomalies.slice(0, 10);
}

// ─── 4. Cashier Anomalies ────────────────────────────────────────

async function detectCashierAnomalies(
  since: Date,
  branchId?: string,
): Promise<AnomalyInsight[]> {
  const anomalies: AnomalyInsight[] = [];

  // Aggregate sales by cashier/user
  const userSales = await prisma.saleOrder.groupBy({
    by: ["createdByUserId"],
    _sum: { grandTotal: true, discountTotal: true },
    _count: { id: true },
    where: {
      status: { in: ["PAID", "DISPATCH_PENDING", "DISPATCHED"] },
      createdAt: { gte: since },
      ...(branchId ? { branchId } : {}),
    },
  });

  if (userSales.length < 3) return anomalies;

  const avgTotals = userSales.map((u) => Number(u._sum.grandTotal ?? 0) / Math.max(u._count.id, 1));
  const avgDiscounts = userSales.map((u) => Number(u._sum.discountTotal ?? 0) / Math.max(u._count.id, 1));

  const totalMean = mean(avgTotals);
  const totalSd = stddev(avgTotals);
  const discMean = mean(avgDiscounts);
  const discSd = stddev(avgDiscounts);

  for (const u of userSales) {
    const userId = u.createdByUserId;
    const avgTotal = Number(u._sum.grandTotal ?? 0) / Math.max(u._count.id, 1);
    const avgDisc = Number(u._sum.discountTotal ?? 0) / Math.max(u._count.id, 1);

    // Check for unusual average transaction amount
    const zTotal = zScore(avgTotal, totalMean, totalSd);
    if (Math.abs(zTotal) > 2.0) {
      const user = await prisma.user.findUnique({
        where: { id: userId },
        select: { username: true },
      });

      const direction = zTotal > 0 ? "superior" : "inferior";
      anomalies.push({
        id: `anom-cashier-total-${userId}`,
        category: "anomaly",
        title: `Cajero con ticket promedio ${direction}: ${user?.username ?? userId}`,
        description: `${user?.username ?? "Usuario"} tiene un ticket promedio de C$ ${avgTotal.toFixed(2)} — significativamente ${direction} al promedio de C$ ${totalMean.toFixed(2)} (${u._count.id} transacciones).`,
        severity: Math.abs(zTotal) > 2.5 ? "high" : "medium",
        entityType: "cashier",
        entityId: userId,
        entityName: user?.username ?? userId,
        detectedValue: avgTotal,
        expectedRange: { min: totalMean - 2 * totalSd, max: totalMean + 2 * totalSd },
        deviationPercent: Math.round(Math.abs((avgTotal - totalMean) / Math.max(totalMean, 1)) * 100),
        metric: `${u._count.id} transacciones | Promedio: C$ ${avgTotal.toFixed(2)}`,
        createdAt: new Date().toISOString(),
      });
    }

    // Check for unusual discount amounts
    if (discSd > 0) {
      const zDisc = zScore(avgDisc, discMean, discSd);
      if (zDisc > 2.0) {
        const user = await prisma.user.findUnique({
          where: { id: userId },
          select: { username: true },
        });

        anomalies.push({
          id: `anom-cashier-disc-${userId}`,
          category: "anomaly",
          title: `Descuentos excesivos: ${user?.username ?? userId}`,
          description: `${user?.username ?? "Usuario"} aplica un descuento promedio de C$ ${avgDisc.toFixed(2)} por transacción — significativamente mayor al promedio de C$ ${discMean.toFixed(2)}.`,
          severity: zDisc > 2.5 ? "high" : "medium",
          entityType: "cashier",
          entityId: userId,
          entityName: user?.username ?? userId,
          detectedValue: avgDisc,
          expectedRange: { min: 0, max: discMean + 2 * discSd },
          deviationPercent: Math.round(((avgDisc - discMean) / Math.max(discMean, 1)) * 100),
          metric: `Desc. promedio: C$ ${avgDisc.toFixed(2)} vs C$ ${discMean.toFixed(2)} red`,
          createdAt: new Date().toISOString(),
        });
      }
    }
  }

  return anomalies;
}

// ─── 5. Branch Performance Anomalies ─────────────────────────────

async function detectBranchAnomalies(since: Date): Promise<AnomalyInsight[]> {
  const anomalies: AnomalyInsight[] = [];

  const branchSales = await prisma.saleOrder.groupBy({
    by: ["branchId"],
    _sum: { grandTotal: true },
    _count: { id: true },
    where: {
      status: { in: ["PAID", "DISPATCH_PENDING", "DISPATCHED"] },
      createdAt: { gte: since },
    },
  });

  if (branchSales.length < 2) return anomalies;

  const totals = branchSales.map((b) => Number(b._sum.grandTotal ?? 0));
  const m = mean(totals);
  const sd = stddev(totals);

  for (const bs of branchSales) {
    const total = Number(bs._sum.grandTotal ?? 0);
    const z = zScore(total, m, sd);

    if (Math.abs(z) > 1.5) {
      const branch = await prisma.branch.findUnique({
        where: { id: bs.branchId },
        select: { name: true, code: true },
      });

      const direction = z > 0 ? "por encima" : "por debajo";
      anomalies.push({
        id: `anom-branch-${bs.branchId}`,
        category: "anomaly",
        title: `Sucursal ${direction} del promedio: ${branch?.name ?? bs.branchId}`,
        description: `"${branch?.name}" (${branch?.code}) facturó C$ ${total.toFixed(2)} — ${direction} del promedio de red C$ ${m.toFixed(2)} en los últimos ${DAYS_WINDOW} días (${bs._count.id} transacciones).`,
        severity: Math.abs(z) > 2.5 ? "high" : Math.abs(z) > 2.0 ? "medium" : "low",
        entityType: "branch",
        entityId: bs.branchId,
        entityName: branch?.name ?? bs.branchId,
        detectedValue: total,
        expectedRange: { min: m - 2 * sd, max: m + 2 * sd },
        deviationPercent: Math.round(Math.abs((total - m) / Math.max(m, 1)) * 100),
        metric: `${bs._count.id} transacciones | C$ ${total.toFixed(2)} total`,
        createdAt: new Date().toISOString(),
      });
    }
  }

  return anomalies;
}
