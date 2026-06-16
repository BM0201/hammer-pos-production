/**
 * AI Insights — Pattern Analyzer
 *
 * Identifies actionable patterns from sales data:
 *  1. Market Basket Analysis (basic co-occurrence / association rules)
 *  2. Temporal patterns: sales by day-of-week, hour, month trends
 *  3. Demand trend detection: growing vs. declining products
 *  4. Cashier/seller efficiency analysis
 *  5. Correlation patterns (events, paydays, etc.)
 *
 * Methods:
 *  - Co-occurrence matrix for basket analysis (support & confidence metrics)
 *  - Linear regression for demand trends
 *  - Coefficient of variation for demand stability
 */

import { prisma } from "@/lib/prisma";
import {
  mean,
  linearRegression,
  trendDirection,
  coefficientOfVariation,
  daysAgo,
  dayOfWeekLabel,
  hourLabel,
  type PatternInsight,
  type BusinessRecommendation,
  type Severity,
} from "./analyzer";

const DAYS_WINDOW = 30;

function formatActor(user: { fullName?: string | null; username?: string | null } | null | undefined, fallback = "Usuario") {
  if (!user) return fallback;
  const fullName = user.fullName?.trim();
  const username = user.username?.trim();
  if (fullName && username) return `${fullName} (usuario: ${username})`;
  return fullName || username || fallback;
}

// ─── All Patterns ────────────────────────────────────────────────

export async function analyzePatterns(
  branchId?: string,
  days = DAYS_WINDOW,
): Promise<PatternInsight[]> {
  const since = daysAgo(days);
  const patterns: PatternInsight[] = [];

  const [basket, temporal, demand, efficiency] = await Promise.all([
    analyzeBasketPatterns(since, branchId),
    analyzeTemporalPatterns(since, branchId),
    analyzeDemandTrends(since, branchId),
    analyzeCashierEfficiency(since, branchId),
  ]);

  patterns.push(...basket, ...temporal, ...demand, ...efficiency);
  return patterns.slice(0, 20);
}

// ─── 1. Market Basket Analysis ───────────────────────────────────

async function analyzeBasketPatterns(
  since: Date,
  branchId?: string,
): Promise<PatternInsight[]> {
  const patterns: PatternInsight[] = [];

  // Get orders with their products
  const orders = await prisma.saleOrder.findMany({
    where: {
      status: { in: ["PAID", "DISPATCH_PENDING", "DISPATCHED"] },
      createdAt: { gte: since },
      ...(branchId ? { branchId } : {}),
    },
    select: {
      id: true,
      lines: {
        select: {
          productId: true,
          product: { select: { name: true } },
        },
      },
    },
  });

  if (orders.length < 10) return patterns;

  // Build co-occurrence matrix
  const pairCount = new Map<string, number>();
  const productCount = new Map<string, number>();
  const productNames = new Map<string, string>();
  const totalOrders = orders.length;

  for (const order of orders) {
    const productIds = [...new Set(order.lines.map((l) => l.productId))];
    for (const pid of productIds) {
      productCount.set(pid, (productCount.get(pid) ?? 0) + 1);
      const pName = order.lines.find((l) => l.productId === pid)?.product.name;
      if (pName) productNames.set(pid, pName);
    }

    // Count pairs
    for (let i = 0; i < productIds.length; i++) {
      for (let j = i + 1; j < productIds.length; j++) {
        const key = [productIds[i], productIds[j]].sort().join("||");
        pairCount.set(key, (pairCount.get(key) ?? 0) + 1);
      }
    }
  }

  // Find strong associations
  const associations: {
    products: [string, string];
    names: [string, string];
    support: number;
    confidence: number;
    lift: number;
  }[] = [];

  for (const [key, count] of pairCount) {
    const [pA, pB] = key.split("||");
    const support = count / totalOrders;
    if (support < 0.05 || count < 3) continue; // Min 5% support, 3 occurrences

    const countA = productCount.get(pA) ?? 0;
    const countB = productCount.get(pB) ?? 0;
    const confidence = count / Math.max(countA, 1);
    const expectedSupport = (countA / totalOrders) * (countB / totalOrders);
    const lift = expectedSupport > 0 ? support / expectedSupport : 0;

    if (confidence > 0.2 && lift > 1.5) {
      associations.push({
        products: [pA, pB],
        names: [productNames.get(pA) ?? pA, productNames.get(pB) ?? pB],
        support,
        confidence,
        lift,
      });
    }
  }

  // Sort by lift and take top ones
  associations.sort((a, b) => b.lift - a.lift);

  for (const assoc of associations.slice(0, 5)) {
    patterns.push({
      id: `pat-basket-${assoc.products[0]}-${assoc.products[1]}`,
      category: "pattern",
      title: `Productos frecuentemente comprados juntos`,
      description: `"${assoc.names[0]}" y "${assoc.names[1]}" se compran juntos en ${(assoc.support * 100).toFixed(1)}% de las órdenes. Confianza: ${(assoc.confidence * 100).toFixed(1)}%, Lift: ${assoc.lift.toFixed(2)}x.`,
      severity: "info",
      patternType: "basket",
      details: {
        productA: assoc.names[0],
        productB: assoc.names[1],
        support: `${(assoc.support * 100).toFixed(1)}%`,
        confidence: `${(assoc.confidence * 100).toFixed(1)}%`,
        lift: assoc.lift.toFixed(2),
      },
      impact: `Oportunidad de cross-selling o bundle: combinar "${assoc.names[0]}" + "${assoc.names[1]}"`,
      metric: `${(assoc.support * 100).toFixed(1)}% soporte | ${assoc.lift.toFixed(1)}x lift`,
      createdAt: new Date().toISOString(),
    });
  }

  return patterns;
}

// ─── 2. Temporal Patterns ────────────────────────────────────────

async function analyzeTemporalPatterns(
  since: Date,
  branchId?: string,
): Promise<PatternInsight[]> {
  const patterns: PatternInsight[] = [];

  const orders = await prisma.saleOrder.findMany({
    where: {
      status: { in: ["PAID", "DISPATCH_PENDING", "DISPATCHED"] },
      createdAt: { gte: since },
      ...(branchId ? { branchId } : {}),
    },
    select: { grandTotal: true, createdAt: true },
  });

  if (orders.length < 10) return patterns;

  // Day-of-week analysis
  const dowTotals = Array.from({ length: 7 }, () => ({ total: 0, count: 0 }));
  const hourTotals = Array.from({ length: 24 }, () => ({ total: 0, count: 0 }));

  for (const o of orders) {
    const dow = o.createdAt.getDay();
    const hour = o.createdAt.getHours();
    const amount = Number(o.grandTotal);
    dowTotals[dow].total += amount;
    dowTotals[dow].count++;
    hourTotals[hour].total += amount;
    hourTotals[hour].count++;
  }

  // Best and worst days
  const dowAvgs = dowTotals.map((d, i) => ({
    day: dayOfWeekLabel(i),
    avg: d.count > 0 ? d.total / d.count : 0,
    total: d.total,
    count: d.count,
  }));

  const activeDays = dowAvgs.filter((d) => d.count > 0);
  if (activeDays.length >= 2) {
    const best = activeDays.reduce((a, b) => (a.total > b.total ? a : b));
    const worst = activeDays.reduce((a, b) => (a.total < b.total ? a : b));

    if (best.total > worst.total * 2) {
      patterns.push({
        id: "pat-temporal-dow",
        category: "pattern",
        title: "Patrón de ventas por día de semana",
        description: `${best.day} es el día más fuerte con C$ ${best.total.toFixed(2)} (${best.count} ventas), mientras ${worst.day} es el más débil con C$ ${worst.total.toFixed(2)} (${worst.count} ventas). La diferencia es de ${((best.total / Math.max(worst.total, 1) - 1) * 100).toFixed(0)}%.`,
        severity: "info",
        patternType: "temporal",
        details: {
          bestDay: best.day,
          bestTotal: best.total,
          worstDay: worst.day,
          worstTotal: worst.total,
          breakdown: dowAvgs,
        },
        impact: `Considerar promociones los ${worst.day} para equilibrar ventas semanales`,
        metric: `Pico: ${best.day} (C$ ${best.total.toFixed(0)}) | Valle: ${worst.day} (C$ ${worst.total.toFixed(0)})`,
        createdAt: new Date().toISOString(),
      });
    }
  }

  // Peak hours
  const activeHours = hourTotals
    .map((h, i) => ({ hour: hourLabel(i), total: h.total, count: h.count }))
    .filter((h) => h.count > 0)
    .sort((a, b) => b.total - a.total);

  if (activeHours.length >= 3) {
    const top3 = activeHours.slice(0, 3);
    patterns.push({
      id: "pat-temporal-hour",
      category: "pattern",
      title: "Horas pico de ventas",
      description: `Las horas con mayor facturación son: ${top3.map((h) => `${h.hour} (C$ ${h.total.toFixed(0)}, ${h.count} ventas)`).join(", ")}. Optimizar personal y stock para estas franjas.`,
      severity: "info",
      patternType: "temporal",
      details: { peakHours: top3, allHours: activeHours },
      impact: "Ajustar personal y preparación de inventario para horas pico",
      metric: `Top: ${top3[0].hour} con C$ ${top3[0].total.toFixed(0)}`,
      createdAt: new Date().toISOString(),
    });
  }

  return patterns;
}

// ─── 3. Demand Trends ────────────────────────────────────────────

async function analyzeDemandTrends(
  since: Date,
  branchId?: string,
): Promise<PatternInsight[]> {
  const patterns: PatternInsight[] = [];

  // Get daily sales per product
  const lines = await prisma.saleOrderLine.findMany({
    where: {
      saleOrder: {
        status: { in: ["PAID", "DISPATCH_PENDING", "DISPATCHED"] },
        createdAt: { gte: since },
        ...(branchId ? { branchId } : {}),
      },
    },
    select: {
      productId: true,
      quantity: true,
      saleOrder: { select: { createdAt: true } },
      product: { select: { name: true } },
    },
  });

  // Group by product → daily units
  const productDaily = new Map<string, { name: string; dailyMap: Map<string, number> }>();
  for (const line of lines) {
    const pid = line.productId;
    if (!productDaily.has(pid)) {
      productDaily.set(pid, { name: line.product.name, dailyMap: new Map() });
    }
    const dk = line.saleOrder.createdAt.toISOString().slice(0, 10);
    const entry = productDaily.get(pid)!;
    entry.dailyMap.set(dk, (entry.dailyMap.get(dk) ?? 0) + Number(line.quantity));
  }

  const growing: { name: string; slope: number; r2: number; avgSales: number }[] = [];
  const declining: { name: string; slope: number; r2: number; avgSales: number }[] = [];

  for (const [pid, data] of productDaily) {
    if (data.dailyMap.size < 7) continue; // Need at least a week

    // Create time series ordered by date
    const sortedDates = [...data.dailyMap.keys()].sort();
    const values = sortedDates.map((d) => data.dailyMap.get(d) ?? 0);
    const reg = linearRegression(values);
    const avgSales = mean(values);
    const dir = trendDirection(reg.slope, avgSales);

    if (dir === "creciente" && reg.r2 > 0.3 && avgSales >= 1) {
      growing.push({ name: data.name, slope: reg.slope, r2: reg.r2, avgSales });
    } else if (dir === "decreciente" && reg.r2 > 0.3 && avgSales >= 1) {
      declining.push({ name: data.name, slope: reg.slope, r2: reg.r2, avgSales });
    }
  }

  // Top growing products
  growing.sort((a, b) => b.slope - a.slope);
  if (growing.length > 0) {
    const top = growing.slice(0, 5);
    patterns.push({
      id: "pat-demand-growing",
      category: "pattern",
      title: "Productos con demanda creciente",
      description: `${top.length} productos muestran tendencia creciente: ${top.map((p) => `"${p.name}" (+${(p.slope * 100 / Math.max(p.avgSales, 1)).toFixed(0)}%/día)`).join(", ")}.`,
      severity: "info",
      patternType: "demand_trend",
      details: {
        direction: "growing",
        products: top.map((p) => ({
          name: p.name,
          dailyIncrease: p.slope.toFixed(2),
          confidence: `${(p.r2 * 100).toFixed(0)}%`,
          avgDailySales: p.avgSales.toFixed(1),
        })),
      },
      impact: "Asegurar stock suficiente para productos con demanda en alza",
      metric: `${growing.length} productos con tendencia positiva`,
      createdAt: new Date().toISOString(),
    });
  }

  // Top declining products
  declining.sort((a, b) => a.slope - b.slope);
  if (declining.length > 0) {
    const top = declining.slice(0, 5);
    patterns.push({
      id: "pat-demand-declining",
      category: "pattern",
      title: "Productos con demanda decreciente",
      description: `${top.length} productos muestran tendencia decreciente: ${top.map((p) => `"${p.name}" (${(p.slope * 100 / Math.max(p.avgSales, 1)).toFixed(0)}%/día)`).join(", ")}. Considerar descuentos o reducir reposición.`,
      severity: "medium",
      patternType: "demand_trend",
      details: {
        direction: "declining",
        products: top.map((p) => ({
          name: p.name,
          dailyDecrease: Math.abs(p.slope).toFixed(2),
          confidence: `${(p.r2 * 100).toFixed(0)}%`,
          avgDailySales: p.avgSales.toFixed(1),
        })),
      },
      impact: "Reducir pedidos de reposición o aplicar descuentos para mover inventario",
      metric: `${declining.length} productos con tendencia negativa`,
      createdAt: new Date().toISOString(),
    });
  }

  return patterns;
}

// ─── 4. Cashier/Seller Efficiency ────────────────────────────────

async function analyzeCashierEfficiency(
  since: Date,
  branchId?: string,
): Promise<PatternInsight[]> {
  const patterns: PatternInsight[] = [];

  const userSales = await prisma.saleOrder.groupBy({
    by: ["createdByUserId"],
    _sum: { grandTotal: true },
    _count: { id: true },
    _avg: { grandTotal: true },
    where: {
      status: { in: ["PAID", "DISPATCH_PENDING", "DISPATCHED"] },
      createdAt: { gte: since },
      ...(branchId ? { branchId } : {}),
    },
  });

  if (userSales.length < 2) return patterns;

  // Get user names
  const userIds = userSales.map((u) => u.createdByUserId);
  const users = await prisma.user.findMany({
    where: { id: { in: userIds } },
    select: { id: true, username: true, fullName: true },
  });
  const userMap = new Map(users.map((u) => [u.id, formatActor(u, u.id)]));

  const efficiencyData = userSales.map((u) => ({
    userId: u.createdByUserId,
    username: userMap.get(u.createdByUserId) ?? u.createdByUserId,
    totalSales: Number(u._sum.grandTotal ?? 0),
    txCount: u._count.id,
    avgTicket: Number(u._avg.grandTotal ?? 0),
  }));

  efficiencyData.sort((a, b) => b.totalSales - a.totalSales);

  // Compare top vs bottom performers
  if (efficiencyData.length >= 2) {
    const top = efficiencyData[0];
    const bottom = efficiencyData[efficiencyData.length - 1];
    const avgTotal = mean(efficiencyData.map((e) => e.totalSales));

    patterns.push({
      id: "pat-efficiency-comparison",
      category: "pattern",
      title: "Comparación de eficiencia de vendedores",
      description: `Mejor vendedor: "${top.username}" con C$ ${top.totalSales.toFixed(2)} (${top.txCount} ventas, ticket promedio C$ ${top.avgTicket.toFixed(2)}). Menor rendimiento: "${bottom.username}" con C$ ${bottom.totalSales.toFixed(2)} (${bottom.txCount} ventas). Diferencia: ${((top.totalSales / Math.max(bottom.totalSales, 1) - 1) * 100).toFixed(0)}%.`,
      severity: top.totalSales > bottom.totalSales * 3 ? "medium" : "info",
      patternType: "efficiency",
      details: {
        ranking: efficiencyData.map((e) => ({
          username: e.username,
          totalSales: `C$ ${e.totalSales.toFixed(2)}`,
          transactions: e.txCount,
          avgTicket: `C$ ${e.avgTicket.toFixed(2)}`,
        })),
        networkAverage: `C$ ${avgTotal.toFixed(2)}`,
      },
      impact: "Identificar mejores prácticas del top performer y aplicarlas al equipo",
      metric: `Top: ${top.username} (C$ ${top.totalSales.toFixed(0)}) | Red: C$ ${avgTotal.toFixed(0)} promedio`,
      createdAt: new Date().toISOString(),
    });
  }

  return patterns;
}

// ─── Business Recommendations ────────────────────────────────────

export async function generateRecommendations(
  branchId?: string,
  days = DAYS_WINDOW,
): Promise<BusinessRecommendation[]> {
  const since = daysAgo(days);
  const recommendations: BusinessRecommendation[] = [];

  // 1. Overall sales trend
  const orders = await prisma.saleOrder.findMany({
    where: {
      status: { in: ["PAID", "DISPATCH_PENDING", "DISPATCHED"] },
      createdAt: { gte: since },
      ...(branchId ? { branchId } : {}),
    },
    select: { grandTotal: true, createdAt: true },
    orderBy: { createdAt: "asc" },
  });

  if (orders.length >= 7) {
    // Daily totals
    const dailyMap = new Map<string, number>();
    for (const o of orders) {
      const dk = o.createdAt.toISOString().slice(0, 10);
      dailyMap.set(dk, (dailyMap.get(dk) ?? 0) + Number(o.grandTotal));
    }
    const sortedDays = [...dailyMap.keys()].sort();
    const dailyValues = sortedDays.map((d) => dailyMap.get(d) ?? 0);
    const reg = linearRegression(dailyValues);
    const dir = trendDirection(reg.slope, mean(dailyValues));

    if (dir === "decreciente") {
      recommendations.push({
        id: "rec-sales-trend",
        category: "recommendation",
        title: "Tendencia de ventas a la baja",
        description: `Las ventas diarias muestran una tendencia decreciente en los últimos ${days} días. Promedio diario: C$ ${mean(dailyValues).toFixed(2)}, pendiente: ${reg.slope.toFixed(2)}/día (R²: ${reg.r2.toFixed(2)}).`,
        severity: reg.r2 > 0.5 ? "high" : "medium",
        actionType: "review_strategy",
        estimatedImpact: `Si la tendencia continúa, las ventas podrían disminuir C$ ${Math.abs(reg.slope * 30).toFixed(2)} en el próximo mes`,
        priority: 1,
        createdAt: new Date().toISOString(),
      });
    } else if (dir === "creciente") {
      recommendations.push({
        id: "rec-sales-trend",
        category: "recommendation",
        title: "Tendencia de ventas positiva — asegurar inventario",
        description: `Las ventas muestran crecimiento. Promedio diario: C$ ${mean(dailyValues).toFixed(2)}, crecimiento: +C$ ${reg.slope.toFixed(2)}/día. Asegure inventario suficiente.`,
        severity: "info",
        actionType: "stock_preparation",
        estimatedImpact: `Proyección: +C$ ${(reg.slope * 30).toFixed(2)} adicionales el próximo mes`,
        priority: 3,
        createdAt: new Date().toISOString(),
      });
    }
  }

  // 2. Inventory health check
  const lowStockProducts = await prisma.inventoryBalance.findMany({
    where: {
      quantityOnHand: { lte: 5 },
      ...(branchId ? { branchId } : {}),
      product: { isActive: true },
    },
    include: {
      product: { select: { name: true, abcClassification: true, averageDailySales: true } },
      branch: { select: { name: true } },
    },
  });

  const criticalLowStock = lowStockProducts.filter(
    (b) => b.product.abcClassification === "A" && Number(b.product.averageDailySales ?? 0) > 0,
  );

  if (criticalLowStock.length > 0) {
    recommendations.push({
      id: "rec-stock-critical",
      category: "recommendation",
      title: `${criticalLowStock.length} productos clase A con stock bajo`,
      description: `Productos de alta contribución con stock crítico: ${criticalLowStock.slice(0, 3).map((b) => `"${b.product.name}" (${Number(b.quantityOnHand)} uds en ${b.branch.name})`).join(", ")}${criticalLowStock.length > 3 ? ` y ${criticalLowStock.length - 3} más` : ""}.`,
      severity: "high",
      actionType: "restock",
      estimatedImpact: `Evitar pérdida de ventas por desabastecimiento de productos clave`,
      priority: 1,
      createdAt: new Date().toISOString(),
    });
  }

  // 3. Discount effectiveness
  const discountOrders = await prisma.saleOrder.findMany({
    where: {
      status: { in: ["PAID", "DISPATCH_PENDING", "DISPATCHED"] },
      createdAt: { gte: since },
      discountTotal: { gt: 0 },
      ...(branchId ? { branchId } : {}),
    },
    select: { grandTotal: true, discountTotal: true },
  });

  if (discountOrders.length > 0 && orders.length > 0) {
    const totalDiscounts = discountOrders.reduce((s, o) => s + Number(o.discountTotal), 0);
    const totalRevenue = orders.reduce((s, o) => s + Number(o.grandTotal), 0);
    const discountRate = (totalDiscounts / Math.max(totalRevenue, 1)) * 100;

    if (discountRate > 10) {
      recommendations.push({
        id: "rec-discount-review",
        category: "recommendation",
        title: "Tasa de descuentos elevada",
        description: `Los descuentos representan el ${discountRate.toFixed(1)}% de la facturación total (C$ ${totalDiscounts.toFixed(2)} en descuentos de C$ ${totalRevenue.toFixed(2)} en ventas). Revisar política de descuentos.`,
        severity: discountRate > 15 ? "high" : "medium",
        actionType: "review_discounts",
        estimatedImpact: `Reducir descuentos al 5% ahorraría C$ ${(totalDiscounts - totalRevenue * 0.05).toFixed(2)}`,
        priority: 2,
        createdAt: new Date().toISOString(),
      });
    }
  }

  recommendations.sort((a, b) => a.priority - b.priority);
  return recommendations.slice(0, 10);
}
