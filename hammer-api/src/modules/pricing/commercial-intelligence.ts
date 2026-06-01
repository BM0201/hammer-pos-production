import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { getEffectiveProductPricing } from "@/modules/catalog/effective-pricing";
import { resolvePolicyForProduct, type CategoryPricingPolicyDto } from "@/modules/pricing/category-policy-service";

export type AbcClass = "A" | "B" | "C";
export type XyzClass = "X" | "Y" | "Z";
export type CombinedAbcXyzClass = `${AbcClass}${XyzClass}`;
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
  effectivePrice: number;
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

const VALID_ABC = new Set(["A", "B", "C"]);
const VALID_XYZ = new Set(["X", "Y", "Z"]);

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

export function classifyProductAbcXyz(input: CommercialIntelligenceInput) {
  const warnings: string[] = [];
  let abcClass: AbcClass;
  let xyzClass: XyzClass;

  if (input.storedAbcClass && VALID_ABC.has(input.storedAbcClass)) {
    abcClass = input.storedAbcClass as AbcClass;
  } else if (finite(input.revenueContributionPercent) || finite(input.grossProfitContributionPercent)) {
    const contribution = Math.max(input.revenueContributionPercent ?? 0, input.grossProfitContributionPercent ?? 0);
    if (contribution >= 5) abcClass = "A";
    else if (contribution >= 1) abcClass = "B";
    else abcClass = "C";
  } else {
    abcClass = "C";
    warnings.push("Sin datos suficientes de ventas para clasificacion ABC; se uso C como fallback.");
  }

  if (input.storedXyzClass && VALID_XYZ.has(input.storedXyzClass)) {
    xyzClass = input.storedXyzClass as XyzClass;
  } else if (finite(input.salesVariabilityCoefficient)) {
    if (input.salesVariabilityCoefficient <= 0.5) xyzClass = "X";
    else if (input.salesVariabilityCoefficient <= 1) xyzClass = "Y";
    else xyzClass = "Z";
  } else if (finite(input.unitsSoldLast90Days)) {
    if (input.unitsSoldLast90Days >= 90) xyzClass = "X";
    else if (input.unitsSoldLast90Days >= 15) xyzClass = "Y";
    else xyzClass = "Z";
  } else {
    xyzClass = "Z";
    warnings.push("Sin datos suficientes de demanda para clasificacion XYZ; se uso Z como fallback.");
  }

  return {
    abcClass,
    xyzClass,
    combinedClass: `${abcClass}${xyzClass}` as CombinedAbcXyzClass,
    warnings,
  };
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
    effectivePrice: Number(pricing.effectivePrice),
    grossMarginPercent: grossMarginPercent(Number(pricing.effectivePrice), pricing.effectiveCost === null ? null : Number(pricing.effectiveCost)),
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

  const alerts: CommercialAlert[] = [];
  for (const balance of balances) {
    if (!balance.product.isActive) continue;
    const [pricing, policy, commercial] = await Promise.all([
      getEffectiveProductPricing(prisma, { branchId: input.branchId, productId: balance.productId }),
      resolvePolicyForProduct({ branchId: input.branchId, productId: balance.productId }),
      buildCommercialIntelligenceForProduct({ branchId: input.branchId, productId: balance.productId }),
    ]);
    const effectivePrice = Number(pricing.effectivePrice);
    const effectiveCost = pricing.effectiveCost === null ? null : Number(pricing.effectiveCost);
    const stockOnHand = Number(balance.quantityOnHand);
    const margin = grossMarginPercent(effectivePrice, effectiveCost);
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

    if (effectiveCost !== null && effectivePrice < effectiveCost) {
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
