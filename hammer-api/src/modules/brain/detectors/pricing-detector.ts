import type { BrainDecisionSeverity, Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { riskScoreFor, severityForMargin } from "@/modules/brain/scoring";
import { simulatePriceChange } from "@/modules/brain/prediction/price-simulation";
import type { BrainDecisionDraft, BrainDetectorContext } from "@/modules/brain/types";
import { getEffectiveProductPricingBatch } from "@/modules/catalog/effective-pricing";
import { checkStockGroupPricingHealth, type FusionPricingIssueKind } from "@/modules/catalog/fusion-pricing-health";
import { resolvePolicyForProductBatch } from "@/modules/pricing/category-policy-service";
import { buildCommercialIntelligenceBatch } from "@/modules/pricing/commercial-intelligence";
import { calculatePricingSuggestion } from "@/modules/pricing/calculator";

function n(value: Prisma.Decimal | number | null | undefined) {
  return Number(value ?? 0);
}

function marginPct(price: number, cost: number) {
  if (price <= 0) return -100;
  return ((price - cost) / price) * 100;
}

/**
 * 1.2 (prompt-motor-precios-lote-herencia-gobierno.md) — pura, sin DB:
 * aislada para poder probar la condición de "costo se movió, precio no" sin
 * base de datos, mismo principio que isLateSyncIntoClosedDay/
 * classifyTenderForLedger en otros módulos. Solo aplica a settings con un
 * branchPrice fijado — sin eso no hay "última vez que alguien fijó el
 * precio de esta sucursal" que comparar.
 */
export function isPriceStaleAgainstCost(input: { branchPrice: number | null; costUpdatedAt: Date | null; lastPriceUpdateAt: Date | null }): boolean {
  if (input.branchPrice === null) return false;
  if (!input.costUpdatedAt) return false;
  return input.lastPriceUpdateAt === null || input.costUpdatedAt > input.lastPriceUpdateAt;
}

export type BranchCostReferenceCheck = {
  referenceCost: number | null;
  referenceSource: "averageCost" | "lastPurchaseCost" | null;
  costLooksWrong: boolean;
};

/**
 * A.1 (prompt-huecos-fase1-fase3-despliegue.md) — pura, sin DB: aislada
 * para poder probar el umbral (2×, deliberadamente grueso — atrapa errores
 * de tecleo de un orden de magnitud, no costos levemente altos) sin base
 * de datos. Sin costo de referencia, costLooksWrong queda en false: sin
 * base de comparación no se puede afirmar que esté mal.
 */
export function evaluateBranchCostAgainstReference(input: { branchCost: number; averageCost: number | null; lastPurchaseCost: number | null }): BranchCostReferenceCheck {
  const referenceCost = input.averageCost ?? input.lastPurchaseCost ?? null;
  const referenceSource: "averageCost" | "lastPurchaseCost" | null =
    input.averageCost !== null ? "averageCost" : input.lastPurchaseCost !== null ? "lastPurchaseCost" : null;
  const costLooksWrong = referenceCost !== null && referenceCost > 0 && input.branchCost > referenceCost * 2;
  return { referenceCost, referenceSource, costLooksWrong };
}

const SEVERITY_ORDER: BrainDecisionSeverity[] = ["INFO", "LOW", "MEDIUM", "HIGH", "CRITICAL"];

/**
 * prompt-precios-vigilancia-movimiento.md — "que se vigile bien... pero
 * sobre todo lo que más se mueve". Un problema de costo/precio en un
 * producto clase A (commercial-intelligence.ts, el 80% acumulado de
 * valor/volumen — resolveAbcXyzClassification, ÚNICA fuente de la clase)
 * importa más que el mismo problema en un producto que casi no se vende.
 *
 * Sube un escalón de severidad (nunca más allá de CRITICAL) y el
 * confidenceScore — ambos ya alimentan priorityScoreFor (brain/scoring.ts)
 * al persistir la decisión (brain/service.ts::normalizeDraft), así que
 * esto reordena la Bandeja (tray-service.ts ya ordena por
 * priorityScore desc) sin tocar esa función de scoring genérica
 * (la usan TODAS las categorías de Brain, no solo precios) ni el ORDER BY.
 */
export function escalateForTopMover(severity: BrainDecisionSeverity, isTopMover: boolean, baseConfidence: number): { severity: BrainDecisionSeverity; confidenceScore: number } {
  if (!isTopMover) return { severity, confidenceScore: baseConfidence };
  const idx = SEVERITY_ORDER.indexOf(severity);
  const nextSeverity = idx >= 0 && idx < SEVERITY_ORDER.length - 1 ? SEVERITY_ORDER[idx + 1] : severity;
  return { severity: nextSeverity, confidenceScore: Math.min(0.98, baseConfidence + 0.12) };
}

export async function detectPricingDecisions(ctx: BrainDetectorContext): Promise<BrainDecisionDraft[]> {
  const decisions: BrainDecisionDraft[] = [];

  const [balances, branchSettings] = await Promise.all([
    // H: filter inactive products and inactive branches
    prisma.inventoryBalance.findMany({
      where: {
        ...(ctx.branchId ? { branchId: ctx.branchId } : {}),
        product: { is: { isActive: true } },
        branch: { is: { isActive: true } },
      },
      include: {
        branch: { select: { id: true, code: true, name: true } },
        product: { select: { id: true, sku: true, name: true, standardSalePrice: true, updatedAt: true } },
      },
      take: 500,
      orderBy: { updatedAt: "desc" },
    }),
    prisma.branchProductSetting.findMany({
      where: {
        ...(ctx.branchId ? { branchId: ctx.branchId } : {}),
        product: { is: { isActive: true } },
        branch: { is: { isActive: true } },
      },
      include: {
        branch: { select: { id: true, code: true, name: true } },
        product: { select: { id: true, sku: true, name: true, standardSalePrice: true, costUpdatedAt: true, averageCost: true, lastPurchaseCost: true } },
      },
      take: 1000,
    }),
  ]);

  // Batch-prefetch pricing/policy/commercial intelligence for every (branchId, productId)
  // pair touched by this detector — both loops below used to call these once per item
  // (up to ~1500 items x ~20 queries each = tens of thousands of sequential round trips).
  const pairs = [
    ...balances.map((b) => ({ branchId: b.branchId, productId: b.productId })),
    ...branchSettings.map((s) => ({ branchId: s.branchId, productId: s.productId })),
  ];
  const [pricingByKey, policyByKey, commercialByKey] = await Promise.all([
    getEffectiveProductPricingBatch(prisma, pairs),
    resolvePolicyForProductBatch(pairs),
    buildCommercialIntelligenceBatch(pairs),
  ]);
  const balanceByKey = new Map(balances.map((b) => [`${b.branchId}:${b.productId}`, b]));

  for (const balance of balances) {
    const key = `${balance.branchId}:${balance.productId}`;
    const effective = pricingByKey.get(key);
    const policy = policyByKey.get(key);
    const commercial = commercialByKey.get(key);
    if (!effective || !policy || !commercial) continue;
    const cost = effective.effectiveCost === null ? n(balance.weightedAverageCost) : n(effective.effectiveCost);
    const price = n(effective.effectivePrice);
    const isTopMover = commercial.abcClass === "A";

    // prompt-precios-vigilancia-movimiento.md — "cuando... no tenga costo,
    // me aparezca": antes esta fila se saltaba entera (cost<=0 caía al
    // `continue` de abajo, igual que un producto sin precio) y nunca
    // llegaba a la Bandeja. Un producto CON precio pero SIN costo conocido
    // es exactamente el blindspot que el flag WAC_DRIVES_COST_CHAIN=false
    // puede producir (docs/WAC-DESACTIVADO.md) — nadie sabe si se vende con
    // margen o a pérdida. Va antes del `continue` de precio<=0: sin precio
    // tampoco, ya es "Sin precio" (Precios vigentes), no competencia de acá.
    if (cost <= 0 && price > 0) {
      const stockQty = n(balance.quantityOnHand);
      const { severity, confidenceScore } = escalateForTopMover(stockQty > 0 ? "HIGH" : "MEDIUM", isTopMover, stockQty > 0 ? 0.8 : 0.65);
      decisions.push({
        category: "PRICING",
        severity,
        title: `Sin costo conocido: ${balance.product.sku} - ${balance.product.name}`,
        description: `${balance.branch.code} vende ${balance.product.name} a ${price.toFixed(2)} sin ningún costo registrado — no se puede saber si el margen es positivo o negativo.${isTopMover ? " Es uno de los productos que más se mueve (clase A)." : ""}`,
        recommendation: "Cargar el costo de compra (global o de esta sucursal) para poder calcular el margen real.",
        branchId: balance.branchId,
        productId: balance.productId,
        confidenceScore,
        // No hay unitLoss real que calcular (no hay costo con qué
        // compararlo) — el valor de venta expuesto sin costo conocido es el
        // proxy más honesto de "cuánto dinero está en juego acá".
        impactAmount: stockQty * price,
        riskScore: riskScoreFor(severity, confidenceScore),
        proposedActionType: "REVIEW_PRODUCT_NO_COST",
        evidenceJson: {
          price,
          effectivePrice: price,
          effectiveCost: null,
          cost: null,
          priceSource: effective.priceSource,
          costSource: effective.costSource,
          stockAtRisk: stockQty,
          stock: stockQty,
          commercialClass: commercial.combinedClass,
          abcClass: commercial.abcClass,
          marginActual: null,
          marginObjetivo: policy.categoryPolicy.targetMarginPercent,
        },
        sourceJson: { detector: "pricing-detector" },
        fingerprintParts: ["pricing", "no-cost", balance.branchId, balance.productId],
      });
      continue;
    }
    if (cost <= 0 || price <= 0) continue;

    const margin = marginPct(price, cost);
    const minMargin = policy.categoryPolicy.minMarginPercent;
    if (price <= cost || margin < minMargin) {
      const marginSeverity = severityForMargin(margin);
      const isBelowCost = price <= cost;
      const { severity, confidenceScore } = escalateForTopMover(isBelowCost ? "CRITICAL" : marginSeverity, isTopMover, 0.82);
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
      // G: when price < cost, impactAmount = stock × (cost – price) = real daily loss exposure.
      // When margin is just below policy, impactAmount = stock × (price – cost) = at-risk margin value.
      const unitLoss = isBelowCost ? Math.max(0, cost - price) : Math.max(0, price - cost);
      const stockQty = n(balance.quantityOnHand);
      decisions.push({
        category: "PRICING",
        severity,
        title: `Margen bajo: ${balance.product.sku} - ${balance.product.name}`,
        description: `${balance.branch.code} opera con margen efectivo de ${margin.toFixed(1)}%, por debajo de la politica (${minMargin.toFixed(1)}%).${isTopMover ? " Es uno de los productos que más se mueve (clase A)." : ""}`,
        recommendation: isBelowCost
          ? "Precio efectivo debajo del costo efectivo: revisar costo/precio antes de vender."
          : "Validar costo reciente y recalcular precio con politica de categoria e inteligencia ABC-XYZ.",
        branchId: balance.branchId,
        productId: balance.productId,
        confidenceScore,
        impactAmount: stockQty * unitLoss,
        riskScore: riskScoreFor(severity, confidenceScore),
        proposedActionType: isBelowCost ? "REVIEW_PRICE_BELOW_COST" : "REVIEW_PRICE_MARGIN_POLICY",
        proposedActionJson: {
          productId: balance.productId,
          branchId: balance.branchId,
          currentPrice: price,
          suggestedPrice,
          reason: isBelowCost ? "PRICE_BELOW_EFFECTIVE_COST" : "LOW_MARGIN_POLICY",
          calculationSnapshot: suggestion,
        },
        evidenceJson: {
          price,
          effectivePrice: price,
          effectiveCost: cost,
          // G: explicit loss fields so UI can show per-unit and total exposure
          cost,
          currentPrice: price,
          suggestedPrice,
          unitLoss: cost - price,
          stockAtRisk: stockQty,
          priceSource: effective.priceSource,
          costSource: effective.costSource,
          policyMinMarginPercent: minMargin,
          recommendedMarginPercent: commercial.recommendedMarginPercent,
          commercialClass: commercial.combinedClass,
          abcClass: commercial.abcClass,
          riskLevel: commercial.riskLevel,
          marginPct: margin.toFixed(1),
          // Alias — mismo nombre que usa COST_CHANGED_PRICE_STALE (§1.2),
          // para que la bandeja de precios (§1.3) lea un shape uniforme sin
          // ramificar por tipo de decisión.
          marginActual: Number(margin.toFixed(1)),
          marginObjetivo: policy.categoryPolicy.targetMarginPercent,
          stock: stockQty,
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
    const key = `${setting.branchId}:${setting.productId}`;
    const effective = pricingByKey.get(key);
    if (!effective) continue;
    const price = n(effective.effectivePrice);
    const cost = effective.effectiveCost === null ? n(setting.branchCost) : n(effective.effectiveCost);
    if (cost > 0 && price > 0 && cost >= price) {
      const policy = policyByKey.get(key);
      const commercial = commercialByKey.get(key);
      const stockQty = n(balanceByKey.get(key)?.quantityOnHand);

      // A.1 (prompt-huecos-fase1-fase3-despliegue.md) — "actualizar precio
      // O REVISAR COSTO de sucursal": la causa más común de branchCost >=
      // price no es un producto mal preciado, es un costo mal tecleado (un
      // punto decimal corrido). El motor calcula fielmente un precio
      // sugerido absurdo sobre esa basura, y esa fila sube al tope de una
      // bandeja ordenada por impacto — a un checkbox de aplicarse. El
      // umbral 2× es deliberadamente grueso: busca errores de un orden de
      // magnitud, no costos levemente altos.
      const branchCostNum = n(setting.branchCost);
      const { referenceCost, referenceSource, costLooksWrong } = evaluateBranchCostAgainstReference({
        branchCost: branchCostNum,
        averageCost: setting.product.averageCost === null ? null : n(setting.product.averageCost),
        lastPurchaseCost: setting.product.lastPurchaseCost === null ? null : n(setting.product.lastPurchaseCost),
      });

      // 1.1 (prompt-motor-precios-lote-herencia-gobierno.md) — la bandeja
      // de precios necesita un suggestedPrice para poder aplicar esta
      // decisión con el mismo botón/código que REVIEW_PRICE_BELOW_COST.
      // Sin política/inteligencia comercial resuelta para el par, queda sin
      // proposedActionJson: informativa, no aplicable desde la bandeja.
      let proposedActionJson: Prisma.InputJsonValue | undefined;
      let suggestedPriceForBranchCost: number | null = null;
      if (policy && commercial) {
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
        suggestedPriceForBranchCost = suggestion.suggestedPrice;
        proposedActionJson = {
          productId: setting.productId,
          branchId: setting.branchId,
          currentPrice: price,
          suggestedPrice: suggestion.suggestedPrice,
          reason: "PRICE_BELOW_EFFECTIVE_COST",
          calculationSnapshot: suggestion,
        };
      }
      // prompt-precios-vigilancia-movimiento.md — "sobre todo lo que más
      // se mueve": mismo escalón de severidad/confianza que el resto del
      // detector para un producto clase A.
      const { severity: branchCostSeverity, confidenceScore: branchCostConfidence } = escalateForTopMover(cost > price ? "CRITICAL" : "HIGH", commercial?.abcClass === "A", 0.9);
      decisions.push({
        category: "PRICING",
        severity: branchCostSeverity,
        title: `Costo de sucursal supera precio: ${setting.product.sku}`,
        description: `${setting.branch.code} tiene costo ${cost.toFixed(2)} y precio ${price.toFixed(2)}.${commercial?.abcClass === "A" ? " Es uno de los productos que más se mueve (clase A)." : ""}`,
        recommendation: "Actualizar precio o revisar costo de sucursal antes de continuar ventas.",
        branchId: setting.branchId,
        productId: setting.productId,
        confidenceScore: branchCostConfidence,
        impactAmount: stockQty * Math.max(0, cost - price),
        riskScore: riskScoreFor(branchCostSeverity, branchCostConfidence),
        proposedActionType: "REVIEW_BRANCH_COST_PRICE",
        proposedActionJson,
        evidenceJson: {
          effectiveCost: cost,
          effectivePrice: price,
          priceSource: effective.priceSource,
          costSource: effective.costSource,
          suggestedPrice: suggestedPriceForBranchCost,
          stockAtRisk: stockQty,
          marginActual: Number(marginPct(price, cost).toFixed(1)),
          marginObjetivo: policy?.categoryPolicy.targetMarginPercent ?? null,
          // A.1 — costo sospechoso: branchCost es un override manual, sin la
          // trazabilidad a compras que sí tiene effectiveCost.
          branchCost: branchCostNum,
          referenceCost,
          costLooksWrong,
          referenceSource,
          abcClass: commercial?.abcClass ?? null,
        },
        sourceJson: { detector: "pricing-detector" },
        fingerprintParts: ["pricing", "branch-cost-above-price", setting.branchId, setting.productId],
      });
    }
  }

  // 1.2 (prompt-motor-precios-lote-herencia-gobierno.md) — la señal que
  // evita que un producto se venda meses al precio viejo después de una
  // compra que subió el costo: el costo se movió DESPUÉS de la última vez
  // que alguien fijó el precio de esta sucursal, o nunca se registró cuándo
  // se fijó pero sí hay un branchPrice puesto (mismo "ciego" que reporta el
  // script de la Fase 0).
  for (const setting of branchSettings) {
    const costUpdatedAt = setting.product.costUpdatedAt;
    if (!costUpdatedAt) continue;
    const branchPrice = setting.branchPrice === null ? null : n(setting.branchPrice);
    if (!isPriceStaleAgainstCost({ branchPrice, costUpdatedAt, lastPriceUpdateAt: setting.lastPriceUpdateAt })) continue;

    const key = `${setting.branchId}:${setting.productId}`;
    const effective = pricingByKey.get(key);
    const policy = policyByKey.get(key);
    const commercial = commercialByKey.get(key);
    if (!effective || !policy || !commercial) continue;
    const cost = effective.effectiveCost === null ? n(setting.branchCost) : n(effective.effectiveCost);
    const price = n(effective.effectivePrice);
    if (cost <= 0 || price <= 0) continue;

    const currentMargin = marginPct(price, cost);
    const minMargin = policy.categoryPolicy.minMarginPercent;
    const targetMargin = policy.categoryPolicy.targetMarginPercent;
    // No hay snapshot histórico del costo al momento en que se fijó el
    // precio, así que "el costo subió" se aproxima con el síntoma que sí es
    // verificable hoy: el margen efectivo actual ya cayó bajo el mínimo de
    // la política de categoría.
    const baseSeverity = currentMargin < minMargin ? "HIGH" : "MEDIUM";
    // prompt-precios-vigilancia-movimiento.md — "sobre todo lo que más se mueve".
    const { severity, confidenceScore } = escalateForTopMover(baseSeverity, commercial.abcClass === "A", 0.8);

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
    const stockQty = n(balanceByKey.get(key)?.quantityOnHand);
    // impactAmount en córdobas: la brecha de margen (esperado − actual, en
    // puntos porcentuales) convertida a córdobas por unidad al precio
    // actual, multiplicada por el stock en riesgo — mismo principio de
    // "stock x pérdida unitaria en córdobas" que el resto del detector.
    const marginGapPercent = Math.max(0, targetMargin - currentMargin);
    const unitImpact = price * (marginGapPercent / 100);

    decisions.push({
      category: "PRICING",
      severity,
      title: `Costo actualizado, precio sin tocar: ${setting.product.sku} - ${setting.product.name}`,
      description: `${setting.branch.code}: el costo cambió el ${costUpdatedAt.toISOString().slice(0, 10)}${setting.lastPriceUpdateAt ? `, después de la última actualización de precio (${setting.lastPriceUpdateAt.toISOString().slice(0, 10)})` : " y este precio nunca registró cuándo se fijó"}. Margen efectivo hoy: ${currentMargin.toFixed(1)}%.${commercial.abcClass === "A" ? " Es uno de los productos que más se mueve (clase A)." : ""}`,
      recommendation: "Recalcular el precio con el costo actual y aplicar la sugerencia.",
      branchId: setting.branchId,
      productId: setting.productId,
      confidenceScore,
      impactAmount: stockQty * unitImpact,
      riskScore: riskScoreFor(severity, confidenceScore),
      proposedActionType: "COST_CHANGED_PRICE_STALE",
      proposedActionJson: {
        productId: setting.productId,
        branchId: setting.branchId,
        currentPrice: price,
        suggestedPrice,
        reason: "COST_CHANGED_PRICE_STALE",
        calculationSnapshot: suggestion,
      },
      evidenceJson: {
        price,
        effectivePrice: price,
        effectiveCost: cost,
        cost,
        currentPrice: price,
        suggestedPrice,
        costUpdatedAt: costUpdatedAt.toISOString(),
        lastPriceUpdateAt: setting.lastPriceUpdateAt ? setting.lastPriceUpdateAt.toISOString() : null,
        marginActual: Number(currentMargin.toFixed(1)),
        marginObjetivo: targetMargin,
        policyMinMarginPercent: minMargin,
        priceSource: effective.priceSource,
        costSource: effective.costSource,
        commercialClass: commercial.combinedClass,
        abcClass: commercial.abcClass,
        stockAtRisk: stockQty,
      },
      sourceJson: { detector: "pricing-detector" },
      fingerprintParts: ["pricing", "cost-stale", setting.branchId, setting.productId],
    });
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
      // Sin calculation.id: cada recálculo de precio generaba un fingerprint
      // nuevo y por tanto una decisión duplicada del mismo producto.
      fingerprintParts: ["pricing", "scope-misconfiguration", calculation.branchId, calculation.productId],
    });
  }

  // prompt-costos-precios-fusion.md §2.3/§5 — coherencia de costo/precio en
  // FUSIONES: COST_BASIS_CONFLICT, PRICE_BASIS_CONFLICT, PLACEHOLDER_COST y
  // el extremo ALTO de MARGIN_OUTLIER. Los dos bloques de arriba (balance-
  // por-balance, setting-por-setting) ya cubren margen bajo/costo>=precio,
  // pero solo para productos con su PROPIA fila de InventoryBalance o
  // BranchProductSetting — un miembro derivado sin override (sin fila
  // propia de ninguna de las dos) nunca pasa por ninguno de los dos loops.
  // checkStockGroupPricingHealth sí cubre TODOS los miembros de cada grupo,
  // vía el mismo motor (getEffectiveProductPricingBatch) — es la única
  // manera de que Brain vea el override desviado que "no rompe nada
  // visible" (el caso piedrín) o el costo de relleno del canónico.
  const activeGroups = await prisma.productStockGroup.findMany({
    where: { isActive: true },
    select: { id: true, code: true, name: true },
    take: 200,
  });
  const severityForFusionIssue = (kind: FusionPricingIssueKind) =>
    kind === "UNSELLABLE" || kind === "COST_BASIS_CONFLICT" || kind === "PLACEHOLDER_COST" ? "HIGH" : "MEDIUM";
  const titleForFusionIssue = (kind: FusionPricingIssueKind) =>
    kind === "UNSELLABLE" ? "Fusion invendible" : kind === "COST_BASIS_CONFLICT" ? "Costo inconsistente en fusion" : kind === "PRICE_BASIS_CONFLICT" ? "Precio inconsistente en fusion" : kind === "PLACEHOLDER_COST" ? "Costo de relleno en fusion" : "Margen atipico en fusion";
  const recommendationForFusionIssue = (kind: FusionPricingIssueKind) =>
    kind === "UNSELLABLE"
      ? "El guard ya bloquea la venta en el mostrador — corregir costo o precio del canonico."
      : kind === "PLACEHOLDER_COST"
        ? "Corregir el costo del producto canonico con un valor real de adquisicion (no 0 ni 1.00)."
        : kind === "COST_BASIS_CONFLICT"
          ? "Los campos de costo propios de los miembros derivados quedaron obsoletos (ya no se leen para vender) — limpiarlos evita confusion en reportes."
          : kind === "PRICE_BASIS_CONFLICT"
            ? "Revisar si el override de precio es intencional; si no, alinearlo al precio implicito de fusion (canonico x factor)."
            : "Revisar el costo: un margen fuera de rango casi siempre significa un costo de relleno, no un producto genuinamente asi de rentable.";

  for (const group of activeGroups) {
    const health = await checkStockGroupPricingHealth(prisma, {
      stockGroupId: group.id,
      branchIds: ctx.branchId ? [ctx.branchId] : undefined,
    });
    for (const issue of health.issues) {
      const severity = severityForFusionIssue(issue.kind);
      decisions.push({
        category: "PRICING",
        severity,
        title: `${titleForFusionIssue(issue.kind)}: ${group.code}`,
        description: `${group.name}: ${issue.detail}`,
        recommendation: recommendationForFusionIssue(issue.kind),
        branchId: issue.branchId,
        // COST_BASIS_CONFLICT / PRICE_BASIS_CONFLICT implican varios miembros — su
        // productId es una lista "id1, id2", no un producto único.
        productId: issue.productId.includes(",") ? undefined : issue.productId,
        confidenceScore: 0.8,
        riskScore: riskScoreFor(severity, 0.8),
        proposedActionType: `REVIEW_FUSION_${issue.kind}`,
        evidenceJson: { stockGroupId: group.id, stockGroupCode: group.code, ...issue },
        sourceJson: { detector: "pricing-detector", checker: "checkStockGroupPricingHealth" },
        fingerprintParts: ["pricing", "fusion-coherence", issue.kind, group.id, issue.branchId, issue.productId],
      });
    }
  }

  return decisions;
}
