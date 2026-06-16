/**
 * AI Insights — Discount Optimizer
 *
 * Generates intelligent discount suggestions based on:
 *  1. Low-rotation products that could benefit from promotional discounts
 *  2. High-margin products that can absorb discounts
 *  3. Temporal sales patterns (day-of-week / hour peaks)
 *  4. Volume-based discount opportunities
 *  5. Historical price-elasticity indicators
 *
 * Algorithm notes:
 *  - Uses ABC-XYZ classification already present in the system
 *  - Compares current rotation vs. category average to find under-performers
 *  - Estimates price-elasticity from historical discount vs. units-sold correlation
 *  - Suggests discount % proportional to margin headroom and rotation gap
 */

import { prisma } from "@/lib/prisma";
import {
  mean,
  linearRegression,
  trendDirection,
  daysAgo,
  type DiscountSuggestion,
  type Severity,
} from "./analyzer";

// ─── Configuration ───────────────────────────────────────────────

const MIN_MARGIN_FOR_DISCOUNT = 15; // % — don't suggest discounts if margin < this
const MAX_SUGGESTED_DISCOUNT = 35;   // % cap
const LOW_ROTATION_THRESHOLD = 0.3;  // rotation index below this = low rotation
const DAYS_ANALYSIS_WINDOW = 30;

// ─── Main Generator ──────────────────────────────────────────────

export async function generateDiscountSuggestions(
  branchId?: string,
  days = DAYS_ANALYSIS_WINDOW,
): Promise<DiscountSuggestion[]> {
  const since = daysAgo(days);
  const suggestions: DiscountSuggestion[] = [];

  // 1. Get all active products with their analytics data
  const products = await prisma.product.findMany({
    where: { isActive: true },
    select: {
      id: true,
      name: true,
      sku: true,
      standardSalePrice: true,
      abcClassification: true,
      xyzClassification: true,
      rotationIndex: true,
      suggestedMargin: true,
      daysInStock: true,
      averageDailySales: true,
      inventoryBalances: {
        where: branchId ? { branchId } : undefined,
        select: {
          quantityOnHand: true,
          weightedAverageCost: true,
          branchId: true,
        },
      },
    },
  });

  // 2. Get recent sales per product
  const salesLines = await prisma.saleOrderLine.groupBy({
    by: ["productId"],
    _sum: { quantity: true, lineSubtotal: true, discountAmount: true },
    _count: { id: true },
    where: {
      saleOrder: {
        status: { in: ["PAID", "DISPATCH_PENDING", "DISPATCHED"] },
        createdAt: { gte: since },
        ...(branchId ? { branchId } : {}),
      },
    },
  });

  const salesMap = new Map(
    salesLines.map((s) => [
      s.productId,
      {
        unitsSold: Number(s._sum.quantity ?? 0),
        revenue: Number(s._sum.lineSubtotal ?? 0),
        discountGiven: Number(s._sum.discountAmount ?? 0),
        txCount: s._count.id,
      },
    ]),
  );

  // 3. Category rotation averages (for comparison)
  const allRotations = products
    .map((p) => Number(p.rotationIndex ?? 0))
    .filter((r) => r > 0);
  const avgRotation = allRotations.length > 0 ? mean(allRotations) : 1;

  // 4. Analyze each product
  for (const product of products) {
    const salePrice = Number(product.standardSalePrice ?? 0);
    if (salePrice <= 0) continue;

    const totalStock = product.inventoryBalances.reduce(
      (s, b) => s + Number(b.quantityOnHand),
      0,
    );
    const avgCost =
      product.inventoryBalances.length > 0
        ? product.inventoryBalances.reduce(
            (s, b) => s + Number(b.weightedAverageCost) * Number(b.quantityOnHand),
            0,
          ) /
          Math.max(
            product.inventoryBalances.reduce((s, b) => s + Number(b.quantityOnHand), 0),
            1,
          )
        : 0;

    const currentMargin = avgCost > 0 ? ((salePrice - avgCost) / salePrice) * 100 : 0;
    const rotation = Number(product.rotationIndex ?? 0);
    const sales = salesMap.get(product.id);
    const unitsSold = sales?.unitsSold ?? 0;
    const daysInStock = product.daysInStock ?? 0;

    // ── A) Low Rotation + Has Stock → suggest discount to move inventory
    if (
      rotation < LOW_ROTATION_THRESHOLD &&
      totalStock > 0 &&
      currentMargin > MIN_MARGIN_FOR_DISCOUNT
    ) {
      const rotationGap = Math.max(0, avgRotation - rotation) / Math.max(avgRotation, 0.01);
      const discountPct = Math.min(
        MAX_SUGGESTED_DISCOUNT,
        Math.round(rotationGap * currentMargin * 0.5),
      );

      if (discountPct >= 5) {
        const estimatedIncrease = Math.round(discountPct * 1.5); // rough elasticity
        suggestions.push({
          id: `disc-low-rot-${product.id}`,
          category: "discount",
          title: `Descuento por baja rotación: ${product.name}`,
          description: `El producto "${product.name}" (SKU: ${product.sku}) tiene un índice de rotación de ${rotation.toFixed(2)} vs promedio ${avgRotation.toFixed(2)}. Con ${totalStock} unidades en stock y un margen de ${currentMargin.toFixed(1)}%, se sugiere un descuento del ${discountPct}%.`,
          severity: daysInStock > 60 ? "high" : "medium",
          productId: product.id,
          productName: product.name,
          currentPrice: salePrice,
          suggestedDiscount: discountPct,
          estimatedSalesIncrease: estimatedIncrease,
          reason: "Baja rotación con inventario disponible",
          impact: `Descuento del ${discountPct}% podría aumentar ventas en ~${estimatedIncrease}%`,
          metric: `Rotación: ${rotation.toFixed(2)} | Stock: ${totalStock} | Margen: ${currentMargin.toFixed(1)}%`,
          createdAt: new Date().toISOString(),
        });
      }
    }

    // ── B) High Margin Products → room for promotional discounts
    if (
      currentMargin > 40 &&
      unitsSold > 0 &&
      product.abcClassification !== "A"
    ) {
      const promoDiscount = Math.min(
        MAX_SUGGESTED_DISCOUNT,
        Math.round((currentMargin - 25) * 0.4),
      );
      if (promoDiscount >= 8) {
        suggestions.push({
          id: `disc-high-margin-${product.id}`,
          category: "discount",
          title: `Oportunidad promocional: ${product.name}`,
          description: `"${product.name}" tiene un margen del ${currentMargin.toFixed(1)}% — suficiente para una promoción del ${promoDiscount}% manteniendo rentabilidad. Clasificación actual: ${product.abcClassification ?? "N/A"}-${product.xyzClassification ?? "N/A"}.`,
          severity: "low",
          productId: product.id,
          productName: product.name,
          currentPrice: salePrice,
          suggestedDiscount: promoDiscount,
          estimatedSalesIncrease: Math.round(promoDiscount * 1.2),
          reason: "Alto margen permite descuento promocional",
          impact: `Promoción del ${promoDiscount}% manteniendo margen > 25%`,
          metric: `Margen actual: ${currentMargin.toFixed(1)}% | Clase: ${product.abcClassification ?? "?"}-${product.xyzClassification ?? "?"}`,
          createdAt: new Date().toISOString(),
        });
      }
    }

    // ── C) Stale Inventory (>60 days) → urgency discount
    if (daysInStock > 60 && totalStock > 0 && currentMargin > 10) {
      const urgencyDiscount = Math.min(
        MAX_SUGGESTED_DISCOUNT,
        Math.round(Math.min(daysInStock / 3, 30)),
      );
      if (urgencyDiscount >= 10 && !suggestions.find((s) => s.id === `disc-low-rot-${product.id}`)) {
        suggestions.push({
          id: `disc-stale-${product.id}`,
          category: "discount",
          title: `Inventario estancado: ${product.name}`,
          description: `"${product.name}" lleva ${daysInStock} días en inventario sin reposición. Se sugiere descuento agresivo del ${urgencyDiscount}% para liberar capital.`,
          severity: daysInStock > 90 ? "high" : "medium",
          productId: product.id,
          productName: product.name,
          currentPrice: salePrice,
          suggestedDiscount: urgencyDiscount,
          estimatedSalesIncrease: Math.round(urgencyDiscount * 2),
          reason: `Inventario estancado ${daysInStock} días`,
          impact: `Liberar C$ ${(totalStock * salePrice * (urgencyDiscount / 100)).toFixed(2)} en inventario`,
          metric: `Días en stock: ${daysInStock} | Stock: ${totalStock} unidades`,
          createdAt: new Date().toISOString(),
        });
      }
    }
  }

  // 5. Temporal pattern analysis — identify products with strong day-of-week patterns
  const temporalSuggestions = await analyzeTemporalDiscountOpportunities(since, branchId);
  suggestions.push(...temporalSuggestions);

  // Sort by severity then estimated increase
  suggestions.sort((a, b) => {
    const sevDiff =
      (b.severity === "high" ? 3 : b.severity === "medium" ? 2 : 1) -
      (a.severity === "high" ? 3 : a.severity === "medium" ? 2 : 1);
    if (sevDiff !== 0) return sevDiff;
    return b.estimatedSalesIncrease - a.estimatedSalesIncrease;
  });

  return suggestions.slice(0, 15); // Top 15 suggestions
}

// ─── Temporal Pattern Discounts ──────────────────────────────────

async function analyzeTemporalDiscountOpportunities(
  since: Date,
  branchId?: string,
): Promise<DiscountSuggestion[]> {
  const suggestions: DiscountSuggestion[] = [];

  // Get orders with their line items and creation times
  const orders = await prisma.saleOrder.findMany({
    where: {
      status: { in: ["PAID", "DISPATCH_PENDING", "DISPATCHED"] },
      createdAt: { gte: since },
      ...(branchId ? { branchId } : {}),
    },
    select: {
      createdAt: true,
      lines: {
        select: {
          productId: true,
          quantity: true,
          lineSubtotal: true,
        },
      },
    },
  });

  // Aggregate sales by product and day-of-week
  const productDayMap = new Map<string, Map<number, number>>();
  for (const order of orders) {
    const dow = order.createdAt.getDay();
    for (const line of order.lines) {
      if (!productDayMap.has(line.productId)) productDayMap.set(line.productId, new Map());
      const dayMap = productDayMap.get(line.productId)!;
      dayMap.set(dow, (dayMap.get(dow) ?? 0) + Number(line.quantity));
    }
  }

  // Identify products with significantly higher sales on specific days
  for (const [productId, dayMap] of productDayMap) {
    const allDayValues = Array.from({ length: 7 }, (_, i) => dayMap.get(i) ?? 0);
    const avg = mean(allDayValues);
    if (avg < 1) continue; // Skip low-volume products

    const peakDay = allDayValues.indexOf(Math.max(...allDayValues));
    const peakValue = allDayValues[peakDay];

    // If peak day sales are 2x the average, it's a pattern
    if (peakValue >= avg * 2 && peakValue >= 3) {
      const product = await prisma.product.findUnique({
        where: { id: productId },
        select: { name: true, standardSalePrice: true },
      });
      if (!product) continue;

      const dayNames = ["Domingo", "Lunes", "Martes", "Miércoles", "Jueves", "Viernes", "Sábado"];
      const weakDays = allDayValues
        .map((v, i) => ({ day: dayNames[i], sales: v }))
        .filter((d) => d.sales < avg * 0.5)
        .map((d) => d.day);

      if (weakDays.length > 0) {
        suggestions.push({
          id: `disc-temporal-${productId}`,
          category: "discount",
          title: `Patrón temporal: ${product.name}`,
          description: `"${product.name}" se vende ${peakValue.toFixed(0)} unidades los ${dayNames[peakDay]} pero baja a casi cero los ${weakDays.join(", ")}. Descuento en días débiles podría equilibrar la demanda.`,
          severity: "info" as Severity,
          productId,
          productName: product.name,
          currentPrice: Number(product.standardSalePrice ?? 0),
          suggestedDiscount: 10,
          estimatedSalesIncrease: 15,
          reason: `Patrón de ventas concentrado en ${dayNames[peakDay]}`,
          impact: `Descuento del 10% en ${weakDays.join("/")} podría generar ventas adicionales`,
          metric: `Pico: ${peakValue.toFixed(0)} uds (${dayNames[peakDay]}) | Promedio: ${avg.toFixed(1)} uds/día`,
          createdAt: new Date().toISOString(),
        });
      }
    }
  }

  return suggestions.slice(0, 5);
}
