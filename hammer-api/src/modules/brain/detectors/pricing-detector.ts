import type { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { riskScoreFor, severityForMargin } from "@/modules/brain/scoring";
import { simulatePriceChange } from "@/modules/brain/prediction/price-simulation";
import type { BrainDecisionDraft, BrainDetectorContext } from "@/modules/brain/types";
import { getEffectiveProductPricing } from "@/modules/catalog/effective-pricing";
import { resolvePolicyForProduct } from "@/modules/pricing/category-policy-service";
import { buildCommercialIntelligenceForProduct } from "@/modules/pricing/commercial-intelligence";
import { calculatePricingSuggestion } from "@/modules/pricing/calculator";

function n(value: Prisma.Decimal | number | null | undefined) {
  return Number(value ?? 0);
}

function marginPct(price: number, cost: number) {
  if (price <= 0) return -100;
  return ((price - cost) / price) * 100;
}

export async function detectPricingDecisions(ctx: BrainDetectorContext): Promise<BrainDecisionDraft[]> {
  const decisions: BrainDecisionDraft[] = [];

  const [balances, branchSettings] = await Promise.all([
    prisma.inventoryBalance.findMany({
      where: ctx.branchId ? { branchId: ctx.branchId } : {},
      include: {
        branch: { select: { id: true, code: true, name: true } },
        product: { select: { id: true, sku: true, name: true, standardSalePrice: true, updatedAt: true } },
      },
      take: 500,
      orderBy: { updatedAt: "desc" },
    }),
    prisma.branchProductSetting.findMany({
      where: ctx.branchId ? { branchId: ctx.branchId } : {},
      include: {
        branch: { select: { id: true, code: true, name: true } },
        product: { select: { id: true, sku: true, name: true, standardSalePrice: true } },
      },
      take: 1000,
    }),
  ]);

  for (const balance of balances) {
    const effective = await getEffectiveProductPricing(prisma, { branchId: balance.branchId, productId: balance.productId });
    const policy = await resolvePolicyForProduct({ branchId: balance.branchId, productId: balance.productId });
    const commercial = await buildCommercialIntelligenceForProduct({ branchId: balance.branchId, productId: balance.productId });
    const cost = effective.effectiveCost === null ? n(balance.weightedAverageCost) : n(effective.effectiveCost);
    const price = n(effective.effectivePrice);
    if (cost <= 0 || price <= 0) continue;

    const margin = marginPct(price, cost);
    const minMargin = policy.categoryPolicy.minMarginPercent;
    if (price <= cost || margin < minMargin) {
      const severity = severityForMargin(margin);
      const suggestion = calculatePricingSuggestion({
        mode: "ADVANCED",
        baseCost: cost,
        includeTaxInCost: false,
        monthlyOperatingExpenses: policy.categoryPolicy.monthlyExpenseAllocation,
        categoryMonthlyUnits: policy.categoryPolicy.estimatedMonthlyUnits,
        estimatedMonthlyUnits: policy.categoryPolicy.estimatedMonthlyUnits,
        expenseAllocationScope: "CATEGORY",
        marginPercent: commercial.recommendedMarginPercent,
        minProfitAmount: commercial.recommendedMinProfitAmount,
        roundingRule: policy.categoryPolicy.roundingRule as any,
      });
      const suggestedPrice = suggestion.suggestedPrice;
      const priceSimulation = simulatePriceChange({
        currentPrice: price,
        cost,
        suggestedPrice,
        recentUnits: n(balance.quantityOnHand),
      });
      decisions.push({
        category: "PRICING",
        severity: price <= cost ? "CRITICAL" : severity,
        title: `Margen bajo: ${balance.product.sku} - ${balance.product.name}`,
        description: `${balance.branch.code} opera con margen efectivo de ${margin.toFixed(1)}%, por debajo de la politica (${minMargin.toFixed(1)}%).`,
        recommendation: price <= cost
          ? "Precio efectivo debajo del costo efectivo: revisar costo/precio antes de vender."
          : "Validar costo reciente y recalcular precio con politica de categoria e inteligencia ABC-XYZ.",
        branchId: balance.branchId,
        productId: balance.productId,
        confidenceScore: 0.82,
        impactAmount: n(balance.quantityOnHand) * Math.max(0, price - cost),
        riskScore: riskScoreFor(price <= cost ? "CRITICAL" : severity, 0.82),
        proposedActionType: price <= cost ? "REVIEW_PRICE_BELOW_COST" : "REVIEW_PRICE_MARGIN_POLICY",
        proposedActionJson: {
          productId: balance.productId,
          branchId: balance.branchId,
          currentPrice: price,
          suggestedPrice,
          reason: price <= cost ? "PRICE_BELOW_EFFECTIVE_COST" : "LOW_MARGIN_POLICY",
          calculationSnapshot: suggestion,
        },
        evidenceJson: {
          price,
          effectivePrice: price,
          effectiveCost: cost,
          priceSource: effective.priceSource,
          costSource: effective.costSource,
          policyMinMarginPercent: minMargin,
          recommendedMarginPercent: commercial.recommendedMarginPercent,
          commercialClass: commercial.combinedClass,
          riskLevel: commercial.riskLevel,
          marginPct: margin.toFixed(1),
          stock: n(balance.quantityOnHand),
          priceSimulation,
          commercialActions: commercial.recommendedActions,
        },
        sourceJson: { detector: "pricing-detector" },
        fingerprintParts: ["pricing", "low-margin", balance.branchId, balance.productId],
      });

      if (suggestion.marketConflict?.hasConflict) {
        decisions.push({
          category: "PRICING",
          severity: "CRITICAL",
          title: `Producto no rentable bajo precio de mercado: ${balance.product.sku}`,
          description: "El precio minimo rentable supera el precio maximo de mercado configurado.",
          recommendation: "No stockear, vender bajo pedido, revisar proveedor o reducir flete/gasto asignado.",
          branchId: balance.branchId,
          productId: balance.productId,
          confidenceScore: 0.9,
          riskScore: riskScoreFor("CRITICAL", 0.9),
          proposedActionType: "PRODUCT_NOT_RENTABLE_UNDER_MARKET_PRICE",
          evidenceJson: { marketConflict: suggestion.marketConflict, calculationSnapshot: suggestion },
          sourceJson: { detector: "pricing-detector" },
          fingerprintParts: ["pricing", "market-conflict", balance.branchId, balance.productId],
        });
      }
    }

    if (commercial.combinedClass === "CZ" && n(balance.quantityOnHand) > 0) {
      decisions.push({
        category: "PRICING",
        severity: "HIGH",
        title: `Politica CZ con stock: ${balance.product.sku}`,
        description: `${balance.product.name} esta clasificado CZ y mantiene stock en ${balance.branch.code}.`,
        recommendation: "Revisar politica de precio/stock: vender bajo pedido, liquidar o reducir reposicion.",
        branchId: balance.branchId,
        productId: balance.productId,
        confidenceScore: 0.75,
        riskScore: riskScoreFor("HIGH", 0.75),
        proposedActionType: "REVIEW_CZ_STOCK_PRICE_POLICY",
        evidenceJson: { stock: n(balance.quantityOnHand), commercialIntelligence: commercial, categoryPolicy: policy.categoryPolicy },
        sourceJson: { detector: "pricing-detector" },
        fingerprintParts: ["pricing", "cz-stock-policy", balance.branchId, balance.productId],
      });
    }
  }

  const settingsByProduct = new Map<string, typeof branchSettings>();
  for (const setting of branchSettings) {
    if (!settingsByProduct.has(setting.productId)) settingsByProduct.set(setting.productId, []);
    settingsByProduct.get(setting.productId)!.push(setting);
  }

  for (const [productId, settings] of settingsByProduct) {
    const priced = settings.filter((s) => s.branchPrice !== null);
    if (priced.length < 2) continue;

    const prices = priced.map((s) => n(s.branchPrice));
    const min = Math.min(...prices);
    const max = Math.max(...prices);
    if (min > 0 && max / min >= 1.25) {
      const product = priced[0].product;
      decisions.push({
        category: "PRICING",
        severity: "MEDIUM",
        title: `Precio inconsistente entre sucursales: ${product.sku}`,
        description: `${product.name} tiene precios por sucursal con diferencia mayor al 25%.`,
        recommendation: "Revisar si la diferencia es intencional o si debe alinearse por politica comercial.",
        productId,
        confidenceScore: 0.78,
        riskScore: riskScoreFor("MEDIUM", 0.78),
        proposedActionType: "REVIEW_BRANCH_PRICE_SETTINGS",
        evidenceJson: {
          minPrice: min,
          maxPrice: max,
          branches: priced.map((s) => ({ branch: s.branch.code, price: n(s.branchPrice) })),
        },
        sourceJson: { detector: "pricing-detector" },
        fingerprintParts: ["pricing", "branch-price-spread", productId],
      });
    }
  }

  for (const setting of branchSettings) {
    const effective = await getEffectiveProductPricing(prisma, { branchId: setting.branchId, productId: setting.productId });
    const price = n(effective.effectivePrice);
    const cost = effective.effectiveCost === null ? n(setting.branchCost) : n(effective.effectiveCost);
    if (cost > 0 && price > 0 && cost >= price) {
      decisions.push({
        category: "PRICING",
        severity: cost > price ? "CRITICAL" : "HIGH",
        title: `Costo de sucursal supera precio: ${setting.product.sku}`,
        description: `${setting.branch.code} tiene costo ${cost.toFixed(2)} y precio ${price.toFixed(2)}.`,
        recommendation: "Actualizar precio o revisar costo de sucursal antes de continuar ventas.",
        branchId: setting.branchId,
        productId: setting.productId,
        confidenceScore: 0.9,
        riskScore: riskScoreFor(cost > price ? "CRITICAL" : "HIGH", 0.9),
        proposedActionType: "REVIEW_BRANCH_COST_PRICE",
        evidenceJson: { effectiveCost: cost, effectivePrice: price, priceSource: effective.priceSource, costSource: effective.costSource },
        sourceJson: { detector: "pricing-detector" },
        fingerprintParts: ["pricing", "branch-cost-above-price", setting.branchId, setting.productId],
      });
    }
  }

  const suspiciousCalculations = await prisma.productPricing.findMany({
    where: {
      ...(ctx.branchId ? { branchId: ctx.branchId } : {}),
      totalMonthlyExpenses: { gte: 5000 },
      estimatedMonthlyUnits: { lt: 50 },
    },
    include: {
      branch: { select: { id: true, code: true, name: true } },
      product: { select: { id: true, sku: true, name: true } },
    },
    orderBy: { calculatedAt: "desc" },
    take: 100,
  });

  for (const calculation of suspiciousCalculations) {
    const purchaseCost = n(calculation.purchaseCost);
    const operatingExpensePerUnit = n(calculation.operatingExpensePerUnit);
    if (purchaseCost <= 0 || operatingExpensePerUnit <= purchaseCost * 5) continue;
    decisions.push({
      category: "PRICING",
      severity: "HIGH",
      title: `Prorrateo sospechoso: ${calculation.product.sku}`,
      description: "Posible mezcla de gasto global con unidades de producto. El precio sugerido puede estar inflado.",
      recommendation: "Recalcular usando ambito CATEGORY o gasto manual por unidad.",
      branchId: calculation.branchId,
      productId: calculation.productId,
      confidenceScore: 0.86,
      riskScore: riskScoreFor("HIGH", 0.86),
      proposedActionType: "PRICING_SCOPE_MISCONFIGURATION",
      evidenceJson: {
        totalMonthlyExpenses: n(calculation.totalMonthlyExpenses),
        estimatedMonthlyUnits: n(calculation.estimatedMonthlyUnits),
        purchaseCost,
        operatingExpensePerUnit,
        suggestedPrice: n(calculation.suggestedPrice),
        calculatedAt: calculation.calculatedAt.toISOString(),
      },
      sourceJson: { detector: "pricing-detector" },
      fingerprintParts: ["pricing", "scope-misconfiguration", calculation.branchId, calculation.productId, calculation.id],
    });
  }

  return decisions;
}
