import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { getEffectiveProductPricing } from "@/modules/catalog/effective-pricing";
import { buildCommercialIntelligenceForProduct, type CombinedAbcXyzClass, type CommercialRiskLevel } from "@/modules/pricing/commercial-intelligence";
import { resolvePolicyForProduct } from "@/modules/pricing/category-policy-service";
import { createPurchaseOrder } from "@/modules/purchase-orders/service";
import { createTransfer } from "@/modules/transfers/service";
import { logAuditEvent } from "@/modules/audit/service";

export type ReplenishmentCriticality =
  | "CRITICAL"
  | "LOW"
  | "PREVENTIVE"
  | "OBSERVE"
  | "NORMAL"
  | "DO_NOT_RECOMMEND"
  | "MANUAL_REVIEW";

export type SourceOption = {
  type: "CENTRAL" | "OTHER_BRANCH" | "SUPPLIER" | "PRODUCTION" | "DO_NOT_REPLENISH" | "MANUAL_REVIEW";
  branchId?: string;
  branchName?: string;
  availableStock?: number;
  suggestedQuantity?: number;
  reason: string;
};

export type ReplenishmentRecommendation = {
  productId: string;
  sku: string;
  name: string;
  categoryId?: string | null;
  categoryName?: string | null;
  branchId: string;
  stockOnHand: number;
  reservedStock?: number;
  availableStock: number;
  unitsSoldLast30Days: number;
  unitsSoldLast60Days: number;
  unitsSoldLast90Days: number;
  averageDailyDemand: number;
  lastSoldAt: string | null;
  abcClass: "A" | "B" | "C";
  xyzClass: "X" | "Y" | "Z";
  combinedClass: string;
  riskLevel: CommercialRiskLevel;
  leadTimeDays: number;
  safetyDays: number;
  coverageDays: number;
  reorderPoint: number;
  targetStock: number;
  suggestedOrderQty: number;
  effectiveCost: number | null;
  effectivePrice: number | null;
  grossMarginPercent: number | null;
  estimatedPurchaseCost: number | null;
  priority: "LOW" | "MEDIUM" | "HIGH" | "URGENT";
  criticality: ReplenishmentCriticality;
  recommendationType: "BUY" | "TRANSFER_IN" | "DO_NOT_BUY" | "ON_DEMAND" | "OVERSTOCK" | "REVIEW_PRICE";
  recommendedSource: SourceOption["type"];
  sourceOptions: SourceOption[];
  message: string;
  warnings: string[];
  recommendedActions: string[];
  hasProductionRecipe: boolean;
};

export type TransferOpportunity = {
  productId: string;
  sku: string;
  name: string;
  fromBranchId: string;
  fromBranchName: string;
  toBranchId: string;
  toBranchName: string;
  availableToTransfer: number;
  suggestedTransferQty: number;
  toBranchStockOnHand: number;
  toBranchReorderPoint: number;
  fromBranchStockOnHand: number;
  fromBranchReorderPoint: number;
  estimatedTransferCost: number | null;
  estimatedPurchaseCostAvoided: number | null;
  priority: "LOW" | "MEDIUM" | "HIGH" | "URGENT";
  message: string;
  warnings: string[];
};

type RecommendationParams = {
  branchId: string;
  leadTimeDays?: number;
  coverageDays?: number;
  categoryId?: string;
  onlyCritical?: boolean;
  includeTransferOpportunities?: boolean;
};

const DEFAULT_LEAD_TIME_DAYS = 7;
const ZERO = new Prisma.Decimal(0);

function daysAgo(days: number) {
  const date = new Date();
  date.setDate(date.getDate() - days);
  return date;
}

function finiteNumber(value: unknown, fallback = 0) {
  const n = Number(value ?? fallback);
  return Number.isFinite(n) ? n : fallback;
}

function money(value: number) {
  return Math.round(value * 100) / 100;
}

function qty(value: number) {
  return Math.ceil(Math.max(0, value));
}

function grossMarginPercent(price: number | null, cost: number | null) {
  if (price === null || cost === null || price <= 0) return null;
  return ((price - cost) / price) * 100;
}

function xyzSafetyDays(xyzClass: string) {
  if (xyzClass === "X") return 5;
  if (xyzClass === "Y") return 10;
  return 15;
}

function abcSafetyDays(abcClass: string) {
  if (abcClass === "A") return 5;
  if (abcClass === "B") return 2;
  return 0;
}

function defaultCoverageDays(combinedClass: string) {
  const matrix: Record<string, number> = {
    AX: 30,
    AY: 21,
    AZ: 14,
    BX: 21,
    BY: 14,
    BZ: 10,
    CX: 14,
    CY: 10,
    CZ: 0,
  };
  return matrix[combinedClass] ?? 14;
}

function priorityFor(input: { availableStock: number; reorderPoint: number; riskLevel: CommercialRiskLevel; combinedClass: string }) {
  if (input.availableStock <= 0 && (input.combinedClass.startsWith("A") || input.riskLevel === "CRITICAL")) return "URGENT";
  if (input.availableStock <= input.reorderPoint / 2) return "URGENT";
  if (input.availableStock <= input.reorderPoint) return "HIGH";
  if (input.riskLevel === "HIGH" || input.riskLevel === "CRITICAL") return "MEDIUM";
  return "LOW";
}

async function getSalesMaps(branchId: string, productIds: string[]) {
  const statuses = ["PAID", "DISPATCH_PENDING", "DISPATCHED"] as const;
  const [last30, last60, last90, lastSales] = await Promise.all([
    prisma.saleOrderLine.groupBy({
      by: ["productId"],
      where: { productId: { in: productIds }, saleOrder: { branchId, status: { in: statuses as any }, createdAt: { gte: daysAgo(30) } } },
      _sum: { quantity: true },
    }),
    prisma.saleOrderLine.groupBy({
      by: ["productId"],
      where: { productId: { in: productIds }, saleOrder: { branchId, status: { in: statuses as any }, createdAt: { gte: daysAgo(60) } } },
      _sum: { quantity: true },
    }),
    prisma.saleOrderLine.groupBy({
      by: ["productId"],
      where: { productId: { in: productIds }, saleOrder: { branchId, status: { in: statuses as any }, createdAt: { gte: daysAgo(90) } } },
      _sum: { quantity: true },
    }),
    prisma.saleOrderLine.findMany({
      where: { productId: { in: productIds }, saleOrder: { branchId, status: { in: statuses as any } } },
      select: { productId: true, saleOrder: { select: { createdAt: true } } },
      orderBy: { saleOrder: { createdAt: "desc" } },
      distinct: ["productId"],
    }),
  ]);
  return {
    last30: new Map(last30.map((row) => [row.productId, finiteNumber(row._sum.quantity)])),
    last60: new Map(last60.map((row) => [row.productId, finiteNumber(row._sum.quantity)])),
    last90: new Map(last90.map((row) => [row.productId, finiteNumber(row._sum.quantity)])),
    lastSoldAt: new Map(lastSales.map((row) => [row.productId, row.saleOrder.createdAt.toISOString()])),
  };
}

function determineCriticality(params: {
  stockOnHand: number;
  salesLast30Days: number;
  salesLast90Days: number;
  reorderPoint: number;
  averageDailyDemand: number;
  leadTimeDays: number;
  isManuallyEnabled: boolean;
}): ReplenishmentCriticality {
  const { stockOnHand, salesLast90Days, averageDailyDemand, reorderPoint, leadTimeDays, isManuallyEnabled } = params;
  const hasSalesHistory = salesLast90Days > 0;
  if (!hasSalesHistory && stockOnHand === 0 && !isManuallyEnabled) return "DO_NOT_RECOMMEND";
  if (!hasSalesHistory && stockOnHand === 0 && isManuallyEnabled) return "MANUAL_REVIEW";
  if (stockOnHand === 0 && hasSalesHistory) return "CRITICAL";
  if (stockOnHand > 0 && stockOnHand <= reorderPoint && hasSalesHistory) return "LOW";
  if (averageDailyDemand > 0 && stockOnHand / averageDailyDemand < leadTimeDays * 2) return "PREVENTIVE";
  if (averageDailyDemand === 0 && stockOnHand > 0) return "OBSERVE";
  return "NORMAL";
}

export type TimberLowStockItem = {
  productId: string;
  name: string;
  sku: string;
  stockOnHand: number;
  lastSoldAt: string | null;
};

async function getSourceBranchOpportunity(input: {
  toBranchId: string;
  productId: string;
  suggestedNeedQty: number;
}) {
  const balances = await prisma.inventoryBalance.findMany({
    where: { productId: input.productId, branchId: { not: input.toBranchId }, branch: { isActive: true } },
    include: {
      branch: { select: { id: true, code: true, name: true } },
      product: { select: { id: true, sku: true, name: true } },
    },
  });

  let best: { balance: typeof balances[number]; fromReorderPoint: number; surplus: number } | null = null;
  for (const balance of balances) {
    const setting = await prisma.branchProductSetting.findUnique({
      where: { branchId_productId: { branchId: balance.branchId, productId: input.productId } },
      select: { reorderPoint: true, minStock: true },
    });
    const fromReorderPoint = Math.max(finiteNumber(setting?.reorderPoint), finiteNumber(setting?.minStock));
    const surplus = Math.max(0, finiteNumber(balance.quantityOnHand) - fromReorderPoint);
    if (surplus > 0 && (!best || surplus > best.surplus)) best = { balance, fromReorderPoint, surplus };
  }

  if (!best) return null;
  return {
    fromBranchId: best.balance.branchId,
    fromBranchName: `${best.balance.branch.code} - ${best.balance.branch.name}`,
    fromBranchStockOnHand: finiteNumber(best.balance.quantityOnHand),
    fromBranchReorderPoint: best.fromReorderPoint,
    availableToTransfer: qty(best.surplus),
    suggestedTransferQty: qty(Math.min(best.surplus, input.suggestedNeedQty)),
  };
}

export async function getReplenishmentRecommendations(params: RecommendationParams) {
  const leadTimeDays = Math.max(1, finiteNumber(params.leadTimeDays, DEFAULT_LEAD_TIME_DAYS));
  const balances = await prisma.inventoryBalance.findMany({
    where: {
      branchId: params.branchId,
      product: { isActive: true, ...(params.categoryId ? { categoryId: params.categoryId } : {}) },
    },
    include: {
      product: {
        select: {
          id: true,
          sku: true,
          name: true,
          categoryId: true,
          category: { select: { name: true } },
          averageDailySales: true,
          daysInStock: true,
          isTimber: true,
        },
      },
    },
    orderBy: { inventoryValue: "desc" },
  });

  // Separate timber products — they have their own procurement flow (TimberTrip)
  const timberBalances = balances.filter((b) => b.product.isTimber);
  const regularBalances = balances.filter((b) => !b.product.isTimber);

  const productIds = regularBalances.map((balance) => balance.productId);
  const [sales, recipesSet] = await Promise.all([
    getSalesMaps(params.branchId, productIds),
    prisma.productionRecipe.findMany({ where: { finishedProductId: { in: productIds }, isActive: true }, select: { finishedProductId: true } })
      .then((rows) => new Set(rows.map((r) => r.finishedProductId))),
  ]);
  const recommendations: ReplenishmentRecommendation[] = [];

  for (const balance of regularBalances) {
    const warnings: string[] = [];
    const unitsSoldLast30Days = sales.last30.get(balance.productId) ?? 0;
    const unitsSoldLast60Days = sales.last60.get(balance.productId) ?? 0;
    const unitsSoldLast90Days = sales.last90.get(balance.productId) ?? 0;
    const lastSoldAt = sales.lastSoldAt.get(balance.productId) ?? null;
    let averageDailyDemand = unitsSoldLast30Days > 0 ? unitsSoldLast30Days / 30 : unitsSoldLast90Days > 0 ? unitsSoldLast90Days / 90 : 0;
    if (averageDailyDemand <= 0 && balance.product.averageDailySales) averageDailyDemand = finiteNumber(balance.product.averageDailySales);
    if (averageDailyDemand <= 0) warnings.push("Sin ventas suficientes para estimar demanda.");

    const [pricing, commercial, categoryPolicy, branchSetting] = await Promise.all([
      getEffectiveProductPricing(prisma, { branchId: params.branchId, productId: balance.productId }),
      buildCommercialIntelligenceForProduct({ branchId: params.branchId, productId: balance.productId }),
      resolvePolicyForProduct({ branchId: params.branchId, productId: balance.productId }),
      prisma.branchProductSetting.findUnique({
        where: { branchId_productId: { branchId: params.branchId, productId: balance.productId } },
        select: { minStock: true, maxStock: true, reorderPoint: true, isAvailable: true },
      }),
    ]);

    warnings.push(...commercial.warnings);
    const stockOnHand = finiteNumber(balance.quantityOnHand);
    const availableStock = stockOnHand;
    const effectivePrice = finiteNumber(pricing.effectivePrice);
    const effectiveCost = pricing.effectiveCost === null ? null : finiteNumber(pricing.effectiveCost);
    const margin = grossMarginPercent(effectivePrice, effectiveCost);
    const safetyDays = xyzSafetyDays(commercial.xyzClass) + abcSafetyDays(commercial.abcClass);
    const coverageDays = Math.max(0, finiteNumber(params.coverageDays, defaultCoverageDays(commercial.combinedClass)));
    let reorderPoint = averageDailyDemand * leadTimeDays + averageDailyDemand * safetyDays;
    let targetStock = averageDailyDemand * (leadTimeDays + safetyDays + coverageDays);

    reorderPoint = Math.max(reorderPoint, finiteNumber(branchSetting?.reorderPoint), finiteNumber(branchSetting?.minStock));
    targetStock = Math.max(targetStock, reorderPoint, finiteNumber(branchSetting?.maxStock));
    let suggestedOrderQty = qty(targetStock - availableStock);
    let recommendationType: ReplenishmentRecommendation["recommendationType"] = suggestedOrderQty > 0 ? "BUY" : "DO_NOT_BUY";
    let message = suggestedOrderQty > 0 ? "Comprar para cubrir punto de reposicion y stock objetivo." : "Stock suficiente por ahora.";
    const recommendedActions = [...commercial.recommendedActions];

    if (commercial.combinedClass === "CZ" && unitsSoldLast30Days === 0) {
      suggestedOrderQty = 0;
      recommendationType = stockOnHand > 0 ? "OVERSTOCK" : "ON_DEMAND";
      message = stockOnHand > 0 ? "Producto CZ con stock: evitar compra y revisar salida." : "Producto CZ sin demanda reciente: trabajar bajo pedido.";
      recommendedActions.push("No comprar stock normal sin confirmacion de demanda.");
    }

    if (effectiveCost !== null && effectivePrice < effectiveCost) {
      suggestedOrderQty = 0;
      recommendationType = "REVIEW_PRICE";
      message = "Precio debajo del costo efectivo; revisar precio antes de comprar.";
      warnings.push("Compra bloqueada por precio debajo de costo.");
    } else if (margin !== null && margin < categoryPolicy.categoryPolicy.minMarginPercent) {
      suggestedOrderQty = 0;
      recommendationType = "REVIEW_PRICE";
      message = "Margen por debajo de la politica minima; revisar precio antes de reponer.";
      warnings.push("Compra detenida hasta revisar margen.");
    } else if (availableStock > targetStock * 1.5 && commercial.combinedClass !== "AX") {
      suggestedOrderQty = 0;
      recommendationType = "OVERSTOCK";
      message = "Sobrestock o baja rotacion: no comprar, considerar traslado o liquidacion.";
    }

    let sourceOpportunity: Awaited<ReturnType<typeof getSourceBranchOpportunity>> | null = null;
    if (suggestedOrderQty > 0) {
      sourceOpportunity = await getSourceBranchOpportunity({ toBranchId: params.branchId, productId: balance.productId, suggestedNeedQty: suggestedOrderQty });
      if (params.includeTransferOpportunities && sourceOpportunity && sourceOpportunity.suggestedTransferQty > 0) {
        recommendationType = "TRANSFER_IN";
        message = "Conviene trasladar desde otra sucursal antes de comprar.";
      }
    }

    const hasProductionRecipe = recipesSet.has(balance.productId);
    const isManuallyEnabled = branchSetting?.isAvailable === true;

    const sourceOptions: SourceOption[] = [];
    if (sourceOpportunity && sourceOpportunity.suggestedTransferQty > 0) {
      sourceOptions.push({
        type: "OTHER_BRANCH",
        branchId: sourceOpportunity.fromBranchId,
        branchName: sourceOpportunity.fromBranchName,
        availableStock: sourceOpportunity.availableToTransfer,
        suggestedQuantity: sourceOpportunity.suggestedTransferQty,
        reason: `Stock disponible: ${sourceOpportunity.fromBranchStockOnHand} — puede transferir ${sourceOpportunity.availableToTransfer}`,
      });
    }
    if (suggestedOrderQty > 0) {
      sourceOptions.push({ type: "SUPPLIER", suggestedQuantity: suggestedOrderQty, reason: "Compra a proveedor externo." });
    }
    if (hasProductionRecipe && suggestedOrderQty > 0) {
      sourceOptions.push({ type: "PRODUCTION", suggestedQuantity: suggestedOrderQty, reason: "Produccion interna disponible via receta." });
    }
    if (recommendationType === "DO_NOT_BUY" || recommendationType === "OVERSTOCK" || recommendationType === "ON_DEMAND") {
      sourceOptions.push({ type: "DO_NOT_REPLENISH", reason: message });
    }

    const recommendedSource: SourceOption["type"] =
      sourceOptions.length > 0 ? sourceOptions[0].type : "DO_NOT_REPLENISH";

    const criticality = determineCriticality({
      stockOnHand,
      salesLast30Days: unitsSoldLast30Days,
      salesLast90Days: unitsSoldLast90Days,
      reorderPoint,
      averageDailyDemand,
      leadTimeDays,
      isManuallyEnabled,
    });

    const priority = priorityFor({ availableStock, reorderPoint, riskLevel: commercial.riskLevel, combinedClass: commercial.combinedClass });
    recommendations.push({
      productId: balance.productId,
      sku: balance.product.sku,
      name: balance.product.name,
      categoryId: balance.product.categoryId,
      categoryName: balance.product.category.name,
      branchId: params.branchId,
      stockOnHand,
      reservedStock: 0,
      availableStock,
      unitsSoldLast30Days,
      unitsSoldLast60Days,
      unitsSoldLast90Days,
      averageDailyDemand: Number(averageDailyDemand.toFixed(4)),
      lastSoldAt,
      abcClass: commercial.abcClass,
      xyzClass: commercial.xyzClass,
      combinedClass: commercial.combinedClass,
      riskLevel: commercial.riskLevel,
      leadTimeDays,
      safetyDays,
      coverageDays,
      reorderPoint: money(reorderPoint),
      targetStock: money(targetStock),
      suggestedOrderQty,
      effectiveCost,
      effectivePrice,
      grossMarginPercent: margin === null ? null : Number(margin.toFixed(2)),
      estimatedPurchaseCost: effectiveCost === null ? null : money(effectiveCost * suggestedOrderQty),
      priority,
      criticality,
      recommendationType,
      recommendedSource,
      sourceOptions,
      message,
      warnings,
      recommendedActions,
      hasProductionRecipe,
    });
  }

  const filtered = params.onlyCritical
    ? recommendations.filter((item) => item.priority === "URGENT" || item.priority === "HIGH" || item.recommendationType === "REVIEW_PRICE")
    : recommendations;

  // Build timber alert from the separated timber balances
  const timberLowStockItems: TimberLowStockItem[] = timberBalances
    .filter((b) => finiteNumber(b.quantityOnHand) <= 0)
    .map((b) => ({
      productId: b.productId,
      name: b.product.name,
      sku: b.product.sku,
      stockOnHand: finiteNumber(b.quantityOnHand),
      lastSoldAt: null,
    }));

  const summary = {
    urgentCount: filtered.filter((item) => item.priority === "URGENT").length,
    highCount: filtered.filter((item) => item.priority === "HIGH").length,
    criticalCount: filtered.filter((item) => item.criticality === "CRITICAL").length,
    lowCount: filtered.filter((item) => item.criticality === "LOW").length,
    preventiveCount: filtered.filter((item) => item.criticality === "PREVENTIVE").length,
    buyCount: filtered.filter((item) => item.recommendationType === "BUY").length,
    transferInCount: filtered.filter((item) => item.recommendationType === "TRANSFER_IN").length,
    overstockCount: filtered.filter((item) => item.recommendationType === "OVERSTOCK").length,
    onDemandCount: filtered.filter((item) => item.recommendationType === "ON_DEMAND").length,
    reviewPriceCount: filtered.filter((item) => item.recommendationType === "REVIEW_PRICE").length,
    estimatedTotalPurchaseCost: money(filtered.reduce((sum, item) => sum + (item.recommendationType === "BUY" ? item.estimatedPurchaseCost ?? 0 : 0), 0)),
    timberAlert: {
      totalCount: timberBalances.length,
      zeroStockCount: timberLowStockItems.length,
      lowStockItems: timberLowStockItems,
    },
  };
  return { branchId: params.branchId, generatedAt: new Date().toISOString(), recommendations: filtered, summary };
}

export async function getTransferOpportunities(params: { branchId: string; leadTimeDays?: number; coverageDays?: number }) {
  const recs = await getReplenishmentRecommendations({ ...params, includeTransferOpportunities: false, onlyCritical: true });
  const toBranch = await prisma.branch.findUniqueOrThrow({ where: { id: params.branchId }, select: { id: true, code: true, name: true } });
  const opportunities: TransferOpportunity[] = [];

  for (const rec of recs.recommendations.filter((item) => item.suggestedOrderQty > 0 && item.recommendationType !== "REVIEW_PRICE")) {
    const source = await getSourceBranchOpportunity({ toBranchId: params.branchId, productId: rec.productId, suggestedNeedQty: rec.suggestedOrderQty });
    if (!source || source.suggestedTransferQty <= 0) continue;
    opportunities.push({
      productId: rec.productId,
      sku: rec.sku,
      name: rec.name,
      fromBranchId: source.fromBranchId,
      fromBranchName: source.fromBranchName,
      toBranchId: params.branchId,
      toBranchName: `${toBranch.code} - ${toBranch.name}`,
      availableToTransfer: source.availableToTransfer,
      suggestedTransferQty: source.suggestedTransferQty,
      toBranchStockOnHand: rec.stockOnHand,
      toBranchReorderPoint: rec.reorderPoint,
      fromBranchStockOnHand: source.fromBranchStockOnHand,
      fromBranchReorderPoint: source.fromBranchReorderPoint,
      estimatedTransferCost: null,
      estimatedPurchaseCostAvoided: rec.effectiveCost === null ? null : money(rec.effectiveCost * source.suggestedTransferQty),
      priority: rec.priority,
      message: "Traslado recomendado antes de compra externa.",
      warnings: rec.warnings,
    });
  }
  return { branchId: params.branchId, generatedAt: new Date().toISOString(), opportunities };
}

export async function buildPurchaseDraftFromRecommendations(input: {
  branchId: string;
  items: { productId: string; quantity: number; supplierId?: string }[];
  notes?: string;
  actorUserId: string;
}) {
  const warnings: string[] = [];
  const lines = [];
  for (const item of input.items) {
    const pricing = await getEffectiveProductPricing(prisma, { branchId: input.branchId, productId: item.productId });
    const unitCost = pricing.effectiveCost === null ? 0 : Number(pricing.effectiveCost);
    if (unitCost <= 0) warnings.push(`Producto ${item.productId} sin costo efectivo; se creo linea con costo 0 para revision.`);
    lines.push({ productId: item.productId, quantity: item.quantity, unitCostBeforeTax: unitCost, taxRate: 0, unitTaxAmount: 0 });
  }

  const po = await createPurchaseOrder({
    userId: input.actorUserId,
    branchId: input.branchId,
    supplier: input.items[0]?.supplierId,
    notes: input.notes ?? "Borrador generado desde reposicion inteligente",
    purchaseTaxTreatment: "INCLUDE_IN_COST",
    lines,
  });

  return { ok: true, purchaseOrderId: po.id, status: po.status, warnings };
}

export async function buildTransferDraftFromRecommendations(input: {
  fromBranchId: string;
  toBranchId: string;
  items: { productId: string; quantity: number }[];
  notes?: string;
  actorUserId: string;
}) {
  const transfer = await createTransfer({
    userId: input.actorUserId,
    fromBranchId: input.fromBranchId,
    toBranchId: input.toBranchId,
    notes: input.notes ?? "Borrador generado desde reposicion inteligente",
    lines: input.items,
  });
  return { ok: true, transferId: transfer.id, status: transfer.status, warnings: [] as string[] };
}

export async function notifyMasterReplenishment(input: { branchId: string; actorUserId: string }) {
  await logAuditEvent({
    actorUserId: input.actorUserId,
    branchId: input.branchId,
    module: "inventory",
    action: "REPLENISHMENT_NOTIFY_REQUESTED",
    entityType: "Branch",
    entityId: input.branchId,
    metadataJson: { notificationSystemAvailable: false },
  });
  return {
    ok: true,
    notificationSystemAvailable: false,
    message: "No persistent notification model available; use recommendation endpoints.",
  };
}
