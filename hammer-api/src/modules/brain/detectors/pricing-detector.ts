import type { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { riskScoreFor, severityForMargin } from "@/modules/brain/scoring";
import { simulatePriceChange } from "@/modules/brain/prediction/price-simulation";
import type { BrainDecisionDraft, BrainDetectorContext } from "@/modules/brain/types";

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
    const cost = n(balance.weightedAverageCost);
    const price = n(balance.product.standardSalePrice);
    if (cost <= 0 || price <= 0) continue;

    const margin = marginPct(price, cost);
    if (margin < 20) {
      const severity = severityForMargin(margin);
      const suggestedPrice = cost > 0 ? Math.ceil(cost / 0.75) : price;
      const priceSimulation = simulatePriceChange({
        currentPrice: price,
        cost,
        suggestedPrice,
        recentUnits: n(balance.quantityOnHand),
      });
      decisions.push({
        category: "PRICING",
        severity,
        title: `Margen bajo: ${balance.product.sku} - ${balance.product.name}`,
        description: `${balance.branch.code} opera con margen estimado de ${margin.toFixed(1)}%.`,
        recommendation: "Validar costo reciente y considerar ajuste de precio con aprobacion.",
        branchId: balance.branchId,
        productId: balance.productId,
        confidenceScore: 0.82,
        impactAmount: n(balance.quantityOnHand) * Math.max(0, price - cost),
        riskScore: riskScoreFor(severity, 0.82),
        proposedActionType: "REVIEW_PRICE_MARGIN",
        proposedActionJson: {
          productId: balance.productId,
          branchId: balance.branchId,
          currentPrice: price,
          suggestedPrice,
          reason: "LOW_MARGIN",
        },
        evidenceJson: {
          price,
          weightedAverageCost: cost,
          marginPct: margin.toFixed(1),
          stock: n(balance.quantityOnHand),
          priceSimulation,
        },
        sourceJson: { detector: "pricing-detector" },
        fingerprintParts: ["pricing", "low-margin", balance.branchId, balance.productId],
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
    const price = n(setting.branchPrice ?? setting.product.standardSalePrice);
    const cost = n(setting.branchCost);
    if (setting.branchCost !== null && cost > 0 && price > 0 && cost >= price) {
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
        evidenceJson: { branchCost: cost, effectivePrice: price },
        sourceJson: { detector: "pricing-detector" },
        fingerprintParts: ["pricing", "branch-cost-above-price", setting.branchId, setting.productId],
      });
    }
  }

  return decisions;
}
