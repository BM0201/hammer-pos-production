import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { getEffectiveProductPricing, getEffectiveProductPricingBatch } from "@/modules/catalog/effective-pricing";
import { resolvePolicyForProduct, resolvePolicyForProductBatch, type CategoryPricingPolicyDto } from "@/modules/pricing/category-policy-service";
import { resolveAbcXyzClassification, type AbcClass, type XyzClass, type CombinedAbcXyzClass } from "@/modules/analytics/abc-xyz-classification";

export type { AbcClass, XyzClass, CombinedAbcXyzClass };
export type CommercialRiskLevel = "LOW" | "MEDIUM" | "HIGH" | "CRITICAL";
export type CommercialStockPolicy = "HIGH_STOCK" | "NORMAL" | "LOW_STOCK" | "ON_DEMAND";

export type CommercialIntelligenceInput = {
  productId: string;
  branchId?: string;
  storedAbcClass?: string | null;
  storedXyzClass?: string | null;
  revenueContributionPercent?: number;
  grossProfitContributionPercent?: number;
  unitsSoldLast30Days?: number;
  unitsSoldLast90Days?: number;
  averageDailySales?: number;
  salesVariabilityCoefficient?: number;
  daysInStock?: number | null;
  stockOnHand?: number;
  effectiveCost?: number | null;
  effectivePrice?: number | null;
  grossMarginPercent?: number | null;
  categoryPolicy?: Pick<CategoryPricingPolicyDto,
    "minMarginPercent" |
    "targetMarginPercent" |
    "minProfitAmount" |
    "maxDiscountPercent" |
    "stockPolicy" |
    "priceMode" |
    "roundingRule"
  > | null;
};

export type CommercialPricingRecommendation = {
  abcClass: AbcClass;
  xyzClass: XyzClass;
  combinedClass: CombinedAbcXyzClass;
  recommendedMarginPercent: number;
  recommendedMinProfitAmount: number;
  recommendedMaxDiscountPercent: number;
  recommendedStockPolicy: CommercialStockPolicy;
  riskLevel: CommercialRiskLevel;
  warnings: string[];
  recommendedActions: string[];
};

export type CommercialAlert = {
  productId: string;
  sku: string;
  name: string;
  categoryName: string;
  combinedClass: CombinedAbcXyzClass;
  riskLevel: CommercialRiskLevel;
  effectivePrice: number | null;
  effectiveCost: number | null;
  grossMarginPercent: number | null;
  stockOnHand: number;
  daysInStock: number | null;
  message: string;
  recommendedAction: string;
  severity: "INFO" | "WARNING" | "DANGER";
};

const DEFAULT_POLICY = {
  minMarginPercent: 15,
  targetMarginPercent: 30,
  minProfitAmount: 0,
  maxDiscountPercent: 0,
  stockPolicy: "NORMAL",
  priceMode: "CATEGORY",
  roundingRule: "NEAREST_1",
};

function finite(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value);
}

function clamp(value: number, min: number, max: number) {
  return Math.min(Math.max(value, min), max);
}

function round1(value: number) {
  return Number(value.toFixed(1));
}

function normalizePolicy(input: CommercialIntelligenceInput["categoryPolicy"]) {
  return {
    minMarginPercent: input?.minMarginPercent ?? DEFAULT_POLICY.minMarginPercent,
    targetMarginPercent: input?.targetMarginPercent ?? DEFAULT_POLICY.targetMarginPercent,
    minProfitAmount: input?.minProfitAmount ?? DEFAULT_POLICY.minProfitAmount,
    maxDiscountPercent: input?.maxDiscountPercent ?? DEFAULT_POLICY.maxDiscountPercent,
    stockPolicy: input?.stockPolicy ?? DEFAULT_POLICY.stockPolicy,
    priceMode: input?.priceMode ?? DEFAULT_POLICY.priceMode,
    roundingRule: input?.roundingRule ?? DEFAULT_POLICY.roundingRule,
  };
}

// prompt-precios-fase0: la decisión de clase ya no vive acá — delega en
// resolveAbcXyzClassification (analytics/abc-xyz-classification.ts), la
// misma función que usa el job batch de analytics. `storedAbcClass`/
// `storedXyzClass` siguen siendo la autoridad cuando existen (ver regla de
// precedencia documentada en el módulo canónico); el cálculo en vivo de acá
// (contribución individual / CV / unidades vendidas) es el fallback.
export function classifyProductAbcXyz(input: CommercialIntelligenceInput) {
  const individualContributionPercent = finite(input.revenueContributionPercent) || finite(input.grossProfitContributionPercent)
    ? Math.max(input.revenueContributionPercent ?? 0, input.grossProfitContributionPercent ?? 0)
    : undefined;

  return resolveAbcXyzClassification({
    storedAbcClass: input.storedAbcClass,
    storedXyzClass: input.storedXyzClass,
    individualContributionPercent,
    coefficientOfVariation: input.salesVariabilityCoefficient,
    unitsSoldLast90Days: input.unitsSoldLast90Days,
  });
}

export function buildCommercialWarnings(input: CommercialIntelligenceInput, combinedClass: CombinedAbcXyzClass) {
  const warnings: string[] = [];
  const policy = normalizePolicy(input.categoryPolicy);
  const stockOnHand = input.stockOnHand ?? 0;
  const averageDailySales = input.averageDailySales ?? 0;
  const daysInStock = input.daysInStock ?? null;

  if (input.effectiveCost !== null && input.effectiveCost !== undefined && input.effectivePrice !== null && input.effectivePrice !== undefined && input.effectivePrice < input.effectiveCost) {
    warnings.push("El precio efectivo esta por debajo del costo efectivo.");
  }

  if (input.grossMarginPercent !== null && input.grossMarginPercent !== undefined && input.grossMarginPercent < policy.minMarginPercent) {
    warnings.push("El margen real esta por debajo del margen minimo de la politica.");
  }

  if (combinedClass === "AX" && stockOnHand <= Math.max(2, averageDailySales * 7)) {
    warnings.push("Producto AX con stock bajo: riesgo de perder ventas.");
  }

  if (combinedClass === "CZ" && stockOnHand > Math.max(5, averageDailySales * 30)) {
    warnings.push("Producto CZ con stock alto: riesgo de inventario muerto.");
  }

  if ((combinedClass.startsWith("C") || combinedClass.endsWith("Z")) && daysInStock !== null && daysInStock > 90) {
    warnings.push("Producto con demasiados dias en inventario para su rotacion/riesgo.");
  }

  return warnings;
}

export function resolveCommercialPricingRecommendation(input: CommercialIntelligenceInput): CommercialPricingRecommendation {
  const policy = normalizePolicy(input.categoryPolicy);
  const classified = classifyProductAbcXyz(input);

  const matrix: Record<CombinedAbcXyzClass, {
    marginDelta: number;
    minMargin?: number;
    discountDefault: number;
    stockPolicy: CommercialStockPolicy;
    riskLevel: CommercialRiskLevel;
    actions: string[];
  }> = {
    AX: { marginDelta: -5, minMargin: 10, discountDefault: 10, stockPolicy: "HIGH_STOCK", riskLevel: "LOW", actions: ["Mantener disponibilidad y precio competitivo."] },
    AY: { marginDelta: 0, discountDefault: 8, stockPolicy: "NORMAL", riskLevel: "MEDIUM", actions: ["Revisar temporada y reposicion."] },
    AZ: { marginDelta: 5, discountDefault: 5, stockPolicy: "LOW_STOCK", riskLevel: "HIGH", actions: ["Comprar con cuidado y revisar demanda antes de reponer."] },
    BX: { marginDelta: 0, discountDefault: 8, stockPolicy: "NORMAL", riskLevel: "MEDIUM", actions: ["Mantener seguimiento de margen y rotacion."] },
    BY: { marginDelta: 5, discountDefault: 6, stockPolicy: "NORMAL", riskLevel: "MEDIUM", actions: ["Ajustar compras segun variacion de demanda."] },
    BZ: { marginDelta: 10, discountDefault: 4, stockPolicy: "LOW_STOCK", riskLevel: "HIGH", actions: ["Evitar sobrestock y revisar precio con frecuencia."] },
    CX: { marginDelta: 10, discountDefault: 3, stockPolicy: "LOW_STOCK", riskLevel: "MEDIUM", actions: ["Mantener inventario limitado y margen controlado."] },
    CY: { marginDelta: 15, discountDefault: 2, stockPolicy: "LOW_STOCK", riskLevel: "HIGH", actions: ["Reducir exposicion y comprar en lotes pequenos."] },
    CZ: { marginDelta: 20, discountDefault: 0, stockPolicy: "ON_DEMAND", riskLevel: "CRITICAL", actions: ["Vender bajo pedido, exigir anticipo y no sobrestockear."] },
  };

  const rule = matrix[classified.combinedClass];
  const recommendedMarginPercent = round1(
    clamp(
      Math.max(policy.targetMarginPercent + rule.marginDelta, rule.minMargin ?? policy.minMarginPercent, policy.minMarginPercent),
      0,
      80,
    ),
  );
  const policyDiscount = policy.maxDiscountPercent > 0 ? policy.maxDiscountPercent : rule.discountDefault;
  const recommendedMaxDiscountPercent = round1(Math.max(0, Math.min(policyDiscount, rule.discountDefault)));
  const warnings = [
    ...classified.warnings,
    ...buildCommercialWarnings(input, classified.combinedClass),
  ];

  return {
    abcClass: classified.abcClass,
    xyzClass: classified.xyzClass,
    combinedClass: classified.combinedClass,
    recommendedMarginPercent,
    recommendedMinProfitAmount: policy.minProfitAmount,
    recommendedMaxDiscountPercent,
    recommendedStockPolicy: rule.stockPolicy,
    riskLevel: rule.riskLevel,
    warnings,
    recommendedActions: rule.actions,
  };
}

function grossMarginPercent(price: number, cost: number | null) {
  if (cost === null || price <= 0) return null;
  return ((price - cost) / price) * 100;
}

function startOfDaysAgo(days: number) {
  const date = new Date();
  date.setDate(date.getDate() - days);
  return date;
}

async function getSalesSignals(input: { branchId?: string; productId: string }) {
  const last30 = startOfDaysAgo(30);
  const last90 = startOfDaysAgo(90);
  const saleStatuses = ["PAID", "DISPATCH_PENDING", "DISPATCHED"] as const;

  const [product90, product30, branch90, latestAnalytics] = await Promise.all([
    prisma.saleOrderLine.aggregate({
      where: {
        productId: input.productId,
        saleOrder: {
          status: { in: saleStatuses as any },
          createdAt: { gte: last90 },
          ...(input.branchId ? { branchId: input.branchId } : {}),
        },
      },
      _sum: { quantity: true, lineSubtotal: true },
    }),
    prisma.saleOrderLine.aggregate({
      where: {
        productId: input.productId,
        saleOrder: {
          status: { in: saleStatuses as any },
          createdAt: { gte: last30 },
          ...(input.branchId ? { branchId: input.branchId } : {}),
        },
      },
      _sum: { quantity: true },
    }),
    prisma.saleOrderLine.aggregate({
      where: {
        saleOrder: {
          status: { in: saleStatuses as any },
          createdAt: { gte: last90 },
          ...(input.branchId ? { branchId: input.branchId } : {}),
        },
      },
      _sum: { lineSubtotal: true },
    }),
    prisma.productAnalytics.findFirst({
      where: { productId: input.productId },
      orderBy: { month: "desc" },
      select: { salesVariance: true, abcClass: true, xyzClass: true },
    }),
  ]);

  const productRevenue90 = Number(product90._sum.lineSubtotal ?? 0);
  const branchRevenue90 = Number(branch90._sum.lineSubtotal ?? 0);
  return {
    unitsSoldLast30Days: Number(product30._sum.quantity ?? 0),
    unitsSoldLast90Days: Number(product90._sum.quantity ?? 0),
    revenueContributionPercent: branchRevenue90 > 0 ? (productRevenue90 / branchRevenue90) * 100 : undefined,
    salesVariabilityCoefficient: latestAnalytics?.salesVariance === undefined || latestAnalytics?.salesVariance === null
      ? undefined
      : Number(latestAnalytics.salesVariance),
    analyticsAbcClass: latestAnalytics?.abcClass ?? null,
    analyticsXyzClass: latestAnalytics?.xyzClass ?? null,
  };
}

/**
 * Batch version of getSalesSignals — resolves sales signals for many
 * (branchId, productId) pairs. Groups by branch (branch90 is identical for
 * every product in the same branch, so it's computed once per branch instead
 * of once per product) and uses groupBy to fetch per-product sums in 1 query
 * per branch instead of 1 query per product.
 */
async function getSalesSignalsBatch(
  items: Array<{ branchId: string; productId: string }>,
): Promise<Map<string, ReturnType<typeof buildSalesSignal>>> {
  const result = new Map<string, ReturnType<typeof buildSalesSignal>>();
  if (items.length === 0) return result;

  const last30 = startOfDaysAgo(30);
  const last90 = startOfDaysAgo(90);
  const saleStatuses = ["PAID", "DISPATCH_PENDING", "DISPATCHED"] as const;

  const productIdsByBranch = new Map<string, Set<string>>();
  for (const { branchId, productId } of items) {
    if (!productIdsByBranch.has(branchId)) productIdsByBranch.set(branchId, new Set());
    productIdsByBranch.get(branchId)!.add(productId);
  }

  await Promise.all(
    [...productIdsByBranch.entries()].map(async ([branchId, productIdSet]) => {
      const productIds = [...productIdSet];
      const [product30Rows, product90Rows, branch90, analyticsRows] = await Promise.all([
        prisma.saleOrderLine.groupBy({
          by: ["productId"],
          where: { productId: { in: productIds }, saleOrder: { status: { in: saleStatuses as any }, createdAt: { gte: last30 }, branchId } },
          _sum: { quantity: true },
        }),
        prisma.saleOrderLine.groupBy({
          by: ["productId"],
          where: { productId: { in: productIds }, saleOrder: { status: { in: saleStatuses as any }, createdAt: { gte: last90 }, branchId } },
          _sum: { quantity: true, lineSubtotal: true },
        }),
        prisma.saleOrderLine.aggregate({
          where: { saleOrder: { status: { in: saleStatuses as any }, createdAt: { gte: last90 }, branchId } },
          _sum: { lineSubtotal: true },
        }),
        prisma.productAnalytics.findMany({
          where: { productId: { in: productIds } },
          orderBy: { month: "desc" },
          select: { productId: true, salesVariance: true, abcClass: true, xyzClass: true },
        }),
      ]);

      const product30ByProductId = new Map(product30Rows.map((row) => [row.productId, row]));
      const product90ByProductId = new Map(product90Rows.map((row) => [row.productId, row]));
      const latestAnalyticsByProductId = new Map<string, (typeof analyticsRows)[number]>();
      for (const row of analyticsRows) {
        if (!latestAnalyticsByProductId.has(row.productId)) latestAnalyticsByProductId.set(row.productId, row);
      }
      const branchRevenue90 = Number(branch90._sum.lineSubtotal ?? 0);

      for (const productId of productIds) {
        result.set(`${branchId}:${productId}`, buildSalesSignal({
          product30: product30ByProductId.get(productId) ?? null,
          product90: product90ByProductId.get(productId) ?? null,
          branchRevenue90,
          latestAnalytics: latestAnalyticsByProductId.get(productId) ?? null,
        }));
      }
    }),
  );

  return result;
}

function buildSalesSignal(input: {
  product30: { _sum: { quantity: Prisma.Decimal | null } } | null;
  product90: { _sum: { quantity: Prisma.Decimal | null; lineSubtotal: Prisma.Decimal | null } } | null;
  branchRevenue90: number;
  latestAnalytics: { salesVariance: Prisma.Decimal | null; abcClass: string | null; xyzClass: string | null } | null;
}) {
  const productRevenue90 = Number(input.product90?._sum.lineSubtotal ?? 0);
  return {
    unitsSoldLast30Days: Number(input.product30?._sum.quantity ?? 0),
    unitsSoldLast90Days: Number(input.product90?._sum.quantity ?? 0),
    revenueContributionPercent: input.branchRevenue90 > 0 ? (productRevenue90 / input.branchRevenue90) * 100 : undefined,
    salesVariabilityCoefficient: input.latestAnalytics?.salesVariance === undefined || input.latestAnalytics?.salesVariance === null
      ? undefined
      : Number(input.latestAnalytics.salesVariance),
    analyticsAbcClass: input.latestAnalytics?.abcClass ?? null,
    analyticsXyzClass: input.latestAnalytics?.xyzClass ?? null,
  };
}

/**
 * Batch version of buildCommercialIntelligenceForProduct — resolves commercial
 * intelligence for many (branchId, productId) pairs in a fixed small number of
 * queries instead of ~13+ queries per pair. Used by hot loops (Brain
 * detectors, replenishment) that previously called
 * buildCommercialIntelligenceForProduct once per item.
 */
export async function buildCommercialIntelligenceBatch(
  items: Array<{ branchId: string; productId: string }>,
): Promise<Map<string, CommercialPricingRecommendation>> {
  const result = new Map<string, CommercialPricingRecommendation>();
  if (items.length === 0) return result;

  const productIds = [...new Set(items.map((item) => item.productId))];

  const [products, balances, pricingByKey, policyByKey, signalsByKey] = await Promise.all([
    prisma.product.findMany({
      where: { id: { in: productIds } },
      select: { id: true, abcClassification: true, xyzClassification: true, averageDailySales: true, daysInStock: true },
    }),
    prisma.inventoryBalance.findMany({
      where: { productId: { in: productIds } },
      select: { branchId: true, productId: true, quantityOnHand: true },
    }),
    getEffectiveProductPricingBatch(prisma, items),
    resolvePolicyForProductBatch(items),
    getSalesSignalsBatch(items),
  ]);

  const productById = new Map(products.map((product) => [product.id, product]));
  const balanceByKey = new Map(balances.map((balance) => [`${balance.branchId}:${balance.productId}`, balance]));

  for (const { branchId, productId } of items) {
    const key = `${branchId}:${productId}`;
    if (result.has(key)) continue;
    const product = productById.get(productId);
    if (!product) continue;

    const pricing = pricingByKey.get(key);
    const policy = policyByKey.get(key);
    const signals = signalsByKey.get(key) ?? buildSalesSignal({ product30: null, product90: null, branchRevenue90: 0, latestAnalytics: null });
    const balance = balanceByKey.get(key);

    const effectivePrice = pricing?.effectivePrice === null || pricing?.effectivePrice === undefined ? null : Number(pricing.effectivePrice);
    const effectiveCost = pricing?.effectiveCost === null || pricing?.effectiveCost === undefined ? null : Number(pricing.effectiveCost);

    result.set(key, resolveCommercialPricingRecommendation({
      productId: product.id,
      branchId,
      storedAbcClass: product.abcClassification ?? signals.analyticsAbcClass,
      storedXyzClass: product.xyzClassification ?? signals.analyticsXyzClass,
      revenueContributionPercent: signals.revenueContributionPercent,
      unitsSoldLast30Days: signals.unitsSoldLast30Days,
      unitsSoldLast90Days: signals.unitsSoldLast90Days,
      averageDailySales: product.averageDailySales === null ? undefined : Number(product.averageDailySales),
      salesVariabilityCoefficient: signals.salesVariabilityCoefficient,
      daysInStock: product.daysInStock,
      stockOnHand: Number(balance?.quantityOnHand ?? 0),
      effectiveCost,
      effectivePrice,
      grossMarginPercent: effectivePrice === null ? null : grossMarginPercent(effectivePrice, effectiveCost),
      categoryPolicy: policy?.categoryPolicy,
    }));
  }

  return result;
}

export async function buildCommercialIntelligenceForProduct(input: { branchId: string; productId: string }) {
  const [product, pricing, balance, policy, signals] = await Promise.all([
    prisma.product.findUniqueOrThrow({
      where: { id: input.productId },
      select: {
        id: true,
        abcClassification: true,
        xyzClassification: true,
        averageDailySales: true,
        daysInStock: true,
      },
    }),
    getEffectiveProductPricing(prisma, input),
    prisma.inventoryBalance.findUnique({
      where: { branchId_productId: { branchId: input.branchId, productId: input.productId } },
      select: { quantityOnHand: true },
    }),
    resolvePolicyForProduct(input),
    getSalesSignals(input),
  ]);

  return resolveCommercialPricingRecommendation({
    productId: product.id,
    branchId: input.branchId,
    storedAbcClass: product.abcClassification ?? signals.analyticsAbcClass,
    storedXyzClass: product.xyzClassification ?? signals.analyticsXyzClass,
    revenueContributionPercent: signals.revenueContributionPercent,
    unitsSoldLast30Days: signals.unitsSoldLast30Days,
    unitsSoldLast90Days: signals.unitsSoldLast90Days,
    averageDailySales: product.averageDailySales === null ? undefined : Number(product.averageDailySales),
    salesVariabilityCoefficient: signals.salesVariabilityCoefficient,
    daysInStock: product.daysInStock,
    stockOnHand: Number(balance?.quantityOnHand ?? 0),
    effectiveCost: pricing.effectiveCost === null ? null : Number(pricing.effectiveCost),
    effectivePrice: pricing.effectivePrice === null ? null : Number(pricing.effectivePrice),
    grossMarginPercent: pricing.effectivePrice === null
      ? null
      : grossMarginPercent(Number(pricing.effectivePrice), pricing.effectiveCost === null ? null : Number(pricing.effectiveCost)),
    categoryPolicy: policy.categoryPolicy,
  });
}

export async function listCommercialAlerts(input: { branchId: string; limit?: number }) {
  const balances = await prisma.inventoryBalance.findMany({
    where: { branchId: input.branchId },
    take: input.limit ?? 200,
    orderBy: { inventoryValue: "desc" },
    include: {
      product: {
        select: {
          id: true,
          sku: true,
          name: true,
          isActive: true,
          category: { select: { name: true } },
          daysInStock: true,
        },
      },
    },
  });

  const activeBalances = balances.filter((balance) => balance.product.isActive);
  const pairs = activeBalances.map((balance) => ({ branchId: input.branchId, productId: balance.productId }));
  const [pricingByKey, policyByKey, commercialByKey] = await Promise.all([
    getEffectiveProductPricingBatch(prisma, pairs),
    resolvePolicyForProductBatch(pairs),
    buildCommercialIntelligenceBatch(pairs),
  ]);

  const alerts: CommercialAlert[] = [];
  for (const balance of activeBalances) {
    const key = `${input.branchId}:${balance.productId}`;
    const pricing = pricingByKey.get(key);
    const policy = policyByKey.get(key);
    const commercial = commercialByKey.get(key);
    if (!pricing || !policy || !commercial) continue;
    const effectivePrice = pricing.effectivePrice === null ? null : Number(pricing.effectivePrice);
    const effectiveCost = pricing.effectiveCost === null ? null : Number(pricing.effectiveCost);
    const stockOnHand = Number(balance.quantityOnHand);
    const margin = effectivePrice === null ? null : grossMarginPercent(effectivePrice, effectiveCost);
    const base = {
      productId: balance.productId,
      sku: balance.product.sku,
      name: balance.product.name,
      categoryName: balance.product.category.name,
      combinedClass: commercial.combinedClass,
      riskLevel: commercial.riskLevel,
      effectivePrice,
      effectiveCost,
      grossMarginPercent: margin,
      stockOnHand,
      daysInStock: balance.product.daysInStock,
    };

    if (effectivePrice === null) {
      alerts.push({ ...base, severity: "WARNING", message: "Producto sin precio de venta asignado en esta sucursal.", recommendedAction: "Asignar precio en Catalogo -> Precios y costos." });
    } else if (effectiveCost !== null && effectivePrice < effectiveCost) {
      alerts.push({ ...base, severity: "DANGER", message: "Precio debajo de costo efectivo.", recommendedAction: "Corregir precio o revisar costo antes de vender." });
    }
    if (margin !== null && margin < policy.categoryPolicy.minMarginPercent) {
      alerts.push({ ...base, severity: "WARNING", message: "Margen real debajo del minimo de categoria.", recommendedAction: "Recalcular precio con politica de categoria." });
    }
    if (commercial.combinedClass === "CZ" && stockOnHand > 0) {
      alerts.push({ ...base, severity: stockOnHand > 5 ? "DANGER" : "WARNING", message: "Producto CZ con stock disponible.", recommendedAction: "Vender bajo pedido, liquidar excedente o detener compras." });
    }
    if (commercial.combinedClass === "AX" && stockOnHand <= Math.max(2, (commercial.warnings.length ? 2 : 0))) {
      alerts.push({ ...base, severity: "WARNING", message: "Producto AX con stock bajo.", recommendedAction: "Priorizar reposicion para evitar perdida de ventas." });
    }
    if ((commercial.combinedClass.startsWith("C") || commercial.combinedClass.endsWith("Z")) && balance.product.daysInStock !== null && balance.product.daysInStock > 90) {
      alerts.push({ ...base, severity: "WARNING", message: "Producto con demasiados dias en inventario.", recommendedAction: "Revisar precio, promocion o compra bajo pedido." });
    }
    if (commercial.warnings.some((warning) => warning.includes("Sin datos suficientes"))) {
      alerts.push({ ...base, severity: "INFO", message: "Producto sin datos suficientes para clasificacion robusta.", recommendedAction: "Usar fallback C/Z hasta acumular ventas." });
    }
  }

  return {
    alerts: alerts
      .sort((a, b) => ({ DANGER: 0, WARNING: 1, INFO: 2 }[a.severity] - { DANGER: 0, WARNING: 1, INFO: 2 }[b.severity]))
      .slice(0, input.limit ?? 100),
  };
}
