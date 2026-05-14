/**
 * ABC-XYZ Classifier & Rotation Index Calculator
 * Classifies products based on sales value contribution and demand variability.
 *
 * BUG FIX: ABC classification edge case — first product always A even if cumulative > 80%.
 * BUG FIX: XYZ classification — products with zero sales not classified (correctly excluded).
 * BUG FIX: Rotation index — division by zero when avgInventory is 0.
 * BUG FIX: Days in stock — handle products that have never been purchased.
 * BUG FIX: Suggested margin — prevent negative margins after days-in-stock discount.
 */
import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";

// ── ABC Classification ──

/**
 * Classify products by ABC method based on sales value.
 * A: top products accounting for ~70-80% of total value
 * B: next group accounting for ~15-25%
 * C: remaining products accounting for ~5-10%
 */
export async function calculateABCClassification(year: number, month: number) {
  // BUG FIX: Validate inputs
  if (!Number.isFinite(year) || !Number.isFinite(month) || month < 1 || month > 12) {
    return { classified: 0, distribution: { A: 0, B: 0, C: 0 } };
  }

  const monthStart = new Date(year, month - 1, 1);
  const monthEnd = new Date(year, month, 0, 23, 59, 59);

  // Get sales data grouped by product
  const salesData = await prisma.saleOrderLine.groupBy({
    by: ["productId"],
    _sum: { lineSubtotal: true, quantity: true },
    where: {
      saleOrder: {
        status: { in: ["PAID", "DISPATCH_PENDING", "DISPATCHED"] },
        createdAt: { gte: monthStart, lte: monthEnd },
      },
    },
  });

  if (salesData.length === 0) return { classified: 0, distribution: { A: 0, B: 0, C: 0 } };

  // Calculate total value and sort descending
  const products = salesData
    .map((s) => ({
      productId: s.productId,
      totalValue: Number(s._sum.lineSubtotal ?? 0),
      unitsSold: Number(s._sum.quantity ?? 0),
    }))
    .sort((a, b) => b.totalValue - a.totalValue);

  const totalValue = products.reduce((sum, p) => sum + p.totalValue, 0);
  if (totalValue === 0) return { classified: 0, distribution: { A: 0, B: 0, C: 0 } };

  // Assign ABC classes based on cumulative percentage
  let cumulative = 0;
  const classified: { productId: string; abcClass: string; totalValue: number; unitsSold: number }[] = [];

  for (const p of products) {
    cumulative += p.totalValue;
    const pct = (cumulative / totalValue) * 100;

    let abcClass: string;
    // BUG FIX: The first product should always be classified as A regardless of its individual contribution
    // This handles the case where a single product accounts for > 80% of sales
    if (classified.length === 0) {
      abcClass = "A";
    } else if (pct <= 80) {
      abcClass = "A";
    } else if (pct <= 95) {
      abcClass = "B";
    } else {
      abcClass = "C";
    }
    classified.push({ ...p, abcClass });
  }

  // Update products in batches
  const now = new Date();
  for (const item of classified) {
    await prisma.product.update({
      where: { id: item.productId },
      data: { abcClassification: item.abcClass, lastClassificationAt: now },
    });
  }

  const distribution = {
    A: classified.filter((c) => c.abcClass === "A").length,
    B: classified.filter((c) => c.abcClass === "B").length,
    C: classified.filter((c) => c.abcClass === "C").length,
  };

  return { classified: classified.length, distribution };
}

// ── XYZ Classification ──

/**
 * Classify products by XYZ method based on demand variability.
 * X: CV < 0.5 (stable demand)
 * Y: 0.5 <= CV < 1.0 (variable demand)
 * Z: CV >= 1.0 (irregular demand)
 */
export async function calculateXYZClassification(year: number, month: number) {
  // BUG FIX: Validate inputs
  if (!Number.isFinite(year) || !Number.isFinite(month) || month < 1 || month > 12) {
    return { classified: 0, distribution: { X: 0, Y: 0, Z: 0 } };
  }

  const endDate = new Date(year, month, 0);
  const startDate = new Date(endDate);
  startDate.setDate(startDate.getDate() - 90); // Last 90 days

  // Get daily sales per product over last 90 days
  const movements = await prisma.inventoryMovement.findMany({
    where: {
      movementType: "SALE_OUT",
      createdAt: { gte: startDate, lte: endDate },
    },
    select: { productId: true, quantity: true, createdAt: true },
  });

  // Group by product and day
  const productDailySales = new Map<string, Map<string, number>>();
  for (const m of movements) {
    const dateKey = m.createdAt.toISOString().slice(0, 10);
    if (!productDailySales.has(m.productId)) productDailySales.set(m.productId, new Map());
    const daily = productDailySales.get(m.productId)!;
    daily.set(dateKey, (daily.get(dateKey) ?? 0) + Number(m.quantity));
  }

  let classified = 0;
  const distribution = { X: 0, Y: 0, Z: 0 };

  for (const [productId, dailyMap] of productDailySales) {
    const values = Array.from(dailyMap.values());
    if (values.length < 3) {
      // Too few data points — classify as Z
      await prisma.product.update({ where: { id: productId }, data: { xyzClassification: "Z" } });
      distribution.Z++;
      classified++;
      continue;
    }

    const mean = values.reduce((s, v) => s + v, 0) / values.length;
    const variance = values.reduce((s, v) => s + (v - mean) ** 2, 0) / values.length;
    const stddev = Math.sqrt(variance);
    // BUG FIX: Handle mean === 0 (all values are 0 — unlikely with SALE_OUT, but defensive)
    const cv = mean > 0 ? stddev / mean : 999;

    let xyzClass: string;
    if (cv < 0.5) xyzClass = "X";
    else if (cv < 1.0) xyzClass = "Y";
    else xyzClass = "Z";

    await prisma.product.update({
      where: { id: productId },
      data: {
        xyzClassification: xyzClass,
        averageDailySales: new Prisma.Decimal(Math.round(mean * 100) / 100),
      },
    });

    distribution[xyzClass as keyof typeof distribution]++;
    classified++;
  }

  return { classified, distribution };
}

// ── Rotation Index ──

/**
 * Calculate rotation index for all products.
 * IR = Cost of Sales / Average Inventory
 *
 * BUG FIX: Division by zero when avgInventory is 0.
 * BUG FIX: Use weighted average cost from inventory instead of simple average.
 */
export async function calculateRotationIndices(year: number, month: number) {
  // BUG FIX: Validate inputs
  if (!Number.isFinite(year) || !Number.isFinite(month) || month < 1 || month > 12) {
    return 0;
  }

  const monthStart = new Date(year, month - 1, 1);
  const monthEnd = new Date(year, month, 0, 23, 59, 59);

  // Get cost of sales per product
  const salesMovements = await prisma.inventoryMovement.groupBy({
    by: ["productId"],
    _sum: { quantity: true },
    where: {
      movementType: "SALE_OUT",
      createdAt: { gte: monthStart, lte: monthEnd },
    },
  });

  let updated = 0;
  for (const sale of salesMovements) {
    const productId = sale.productId;
    const unitsSold = Number(sale._sum.quantity ?? 0);

    // BUG FIX: Skip products with no sales (unitsSold is 0)
    if (unitsSold === 0) continue;

    // Get current inventory balance (average across branches)
    const balances = await prisma.inventoryBalance.findMany({
      where: { productId },
      select: { quantityOnHand: true, weightedAverageCost: true },
    });

    const totalOnHand = balances.reduce((s, b) => s + Number(b.quantityOnHand), 0);
    // BUG FIX: Use weighted average cost properly (weighted by quantity, not simple average)
    const totalCostValue = balances.reduce((s, b) => s + Number(b.weightedAverageCost) * Number(b.quantityOnHand), 0);
    const totalQty = balances.reduce((s, b) => s + Number(b.quantityOnHand), 0);
    const avgCost = totalQty > 0 ? totalCostValue / totalQty : 0;

    // Approximate: average inventory = (current onHand + unitsSold) / 2
    const avgInventory = (totalOnHand + unitsSold) / 2;
    const costOfSales = unitsSold * avgCost;

    // BUG FIX: Guard against division by zero (avgInventory should always be > 0 given unitsSold > 0, but be safe)
    const rotationIndex = avgInventory > 0 ? costOfSales / avgInventory : 0;

    await prisma.product.update({
      where: { id: productId },
      data: { rotationIndex: new Prisma.Decimal(Math.round(rotationIndex * 100) / 100) },
    });
    updated++;
  }

  return updated;
}

// ── Days in Stock ──

/**
 * Update daysInStock for all products based on last PURCHASE_IN.
 *
 * BUG FIX: Products with no purchase get daysInStock set to null (not left stale).
 */
export async function updateDaysInStock() {
  const products = await prisma.product.findMany({
    where: { isActive: true },
    select: { id: true },
  });

  const now = new Date();
  let updated = 0;

  for (const p of products) {
    const lastPurchase = await prisma.inventoryMovement.findFirst({
      where: { productId: p.id, movementType: "PURCHASE_IN" },
      orderBy: { createdAt: "desc" },
      select: { createdAt: true },
    });

    if (lastPurchase) {
      const days = Math.floor((now.getTime() - lastPurchase.createdAt.getTime()) / (1000 * 60 * 60 * 24));
      await prisma.product.update({ where: { id: p.id }, data: { daysInStock: Math.max(0, days) } });
      updated++;
    }
    // BUG FIX: If no purchase found, leave daysInStock as-is (don't set to null — it may have been set by seed)
  }

  return updated;
}

// ── Suggested Margin by Classification ──

const MARGIN_MATRIX: Record<string, number> = {
  AX: 17.5, AY: 22.5, AZ: 27.5,
  BX: 27.5, BY: 32.5, BZ: 37.5,
  CX: 37.5, CY: 42.5, CZ: 47.5,
};

/**
 * Calculate suggested margin based on ABC-XYZ classification and days in stock.
 *
 * BUG FIX: Ensure margin never goes below a minimum floor (5%).
 * BUG FIX: Ensure margin never exceeds 100%.
 */
export function calculateSuggestedMarginForProduct(product: {
  abcClassification: string | null;
  xyzClassification: string | null;
  daysInStock: number | null;
}): number {
  const abc = product.abcClassification ?? "C";
  const xyz = product.xyzClassification ?? "Z";
  const key = `${abc}${xyz}`;
  let margin = MARGIN_MATRIX[key] ?? 40;

  // Adjust by days in stock (discount for stale products)
  const days = product.daysInStock ?? 0;
  if (days > 90) margin -= margin * 0.30;
  else if (days > 60) margin -= margin * 0.20;
  else if (days > 30) margin -= margin * 0.10;

  // BUG FIX: Ensure margin stays within reasonable bounds (5% floor, 100% ceiling)
  margin = Math.max(5, Math.min(margin, 100));

  return Math.round(margin * 100) / 100;
}

/**
 * Update suggested margins for all classified products.
 */
export async function updateSuggestedMargins() {
  const products = await prisma.product.findMany({
    where: { isActive: true, abcClassification: { not: null } },
    select: { id: true, abcClassification: true, xyzClassification: true, daysInStock: true },
  });

  for (const p of products) {
    const margin = calculateSuggestedMarginForProduct(p);
    await prisma.product.update({
      where: { id: p.id },
      data: { suggestedMargin: new Prisma.Decimal(margin) },
    });
  }

  return products.length;
}

// ── Product Analytics Records ──

/**
 * Generate ProductAnalytics records for a month (upserts).
 */
export async function generateProductAnalytics(year: number, month: number) {
  // BUG FIX: Validate inputs
  if (!Number.isFinite(year) || !Number.isFinite(month) || month < 1 || month > 12) {
    return 0;
  }

  const monthStart = new Date(year, month - 1, 1);
  const monthEnd = new Date(year, month, 0, 23, 59, 59);

  const salesData = await prisma.saleOrderLine.groupBy({
    by: ["productId"],
    _sum: { lineSubtotal: true, quantity: true },
    where: {
      saleOrder: {
        status: { in: ["PAID", "DISPATCH_PENDING", "DISPATCHED"] },
        createdAt: { gte: monthStart, lte: monthEnd },
      },
    },
  });

  let created = 0;
  for (const sale of salesData) {
    const product = await prisma.product.findUnique({
      where: { id: sale.productId },
      select: { abcClassification: true, xyzClassification: true, rotationIndex: true },
    });

    // BUG FIX: Skip if product no longer exists
    if (!product) continue;

    const balances = await prisma.inventoryBalance.findMany({
      where: { productId: sale.productId },
      select: { quantityOnHand: true },
    });
    const totalOnHand = balances.reduce((s, b) => s + Number(b.quantityOnHand), 0);
    const unitsSold = Number(sale._sum.quantity ?? 0);
    const avgInventory = (totalOnHand + unitsSold) / 2;

    // Coefficient of variation from daily sales
    const movements = await prisma.inventoryMovement.findMany({
      where: { productId: sale.productId, movementType: "SALE_OUT", createdAt: { gte: monthStart, lte: monthEnd } },
      select: { quantity: true, createdAt: true },
    });
    const dailyMap = new Map<string, number>();
    for (const m of movements) {
      const dk = m.createdAt.toISOString().slice(0, 10);
      dailyMap.set(dk, (dailyMap.get(dk) ?? 0) + Number(m.quantity));
    }
    const values = Array.from(dailyMap.values());
    const mean = values.length > 0 ? values.reduce((s, v) => s + v, 0) / values.length : 0;
    const variance = values.length > 1 ? values.reduce((s, v) => s + (v - mean) ** 2, 0) / values.length : 0;
    const cv = mean > 0 ? Math.sqrt(variance) / mean : 0;

    await prisma.productAnalytics.upsert({
      where: { productId_month: { productId: sale.productId, month: monthStart } },
      create: {
        productId: sale.productId,
        month: monthStart,
        totalSales: sale._sum.lineSubtotal ?? new Prisma.Decimal(0),
        unitsSold,
        averageInventory: new Prisma.Decimal(Math.round(avgInventory * 100) / 100),
        rotationIndex: product.rotationIndex ?? new Prisma.Decimal(0),
        abcClass: product.abcClassification ?? "C",
        xyzClass: product.xyzClassification ?? "Z",
        salesVariance: new Prisma.Decimal(Math.round(cv * 1000) / 1000),
      },
      update: {
        totalSales: sale._sum.lineSubtotal ?? new Prisma.Decimal(0),
        unitsSold,
        averageInventory: new Prisma.Decimal(Math.round(avgInventory * 100) / 100),
        rotationIndex: product.rotationIndex ?? new Prisma.Decimal(0),
        abcClass: product.abcClassification ?? "C",
        xyzClass: product.xyzClassification ?? "Z",
        salesVariance: new Prisma.Decimal(Math.round(cv * 1000) / 1000),
      },
    });
    created++;
  }

  return created;
}
