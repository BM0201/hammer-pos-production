import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { getEffectiveProductPricing } from "@/modules/catalog/effective-pricing";
import { resolvePolicyForProduct } from "@/modules/pricing/category-policy-service";
import { describeAbcXyzClass, type CombinedAbcXyzClass } from "@/modules/pricing/commercial-intelligence";
import { type RoundingRule } from "@/modules/pricing/calculator";
import { buildPriceReferences, type PriceReference, type SuggestedBreakdown } from "@/modules/pricing/price-references";

/**
 * Parte C.2 (prompt-completo-pendientes-2026-10.md) — GET
 * /api/master/pricing/tray/[decisionId]/context: todo lo que la Bandeja
 * necesita para explicar una fila y ofrecer los "otros métodos", a partir
 * de lo que el detector YA calculó (calculationSnapshot/evidenceJson en la
 * propia BrainDecision) — nada se recalcula desde cero.
 */

const SALE_STATUSES = ["PAID", "DISPATCH_PENDING", "DISPATCHED"] as const;
const REALIZED_MARGIN_WINDOW_DAYS = 90;
const MIN_LINES_FOR_REALIZED_MARGIN = 5;
const MIN_DAYS_FOR_REALIZED_MARGIN = 3;

function daysAgo(days: number): Date {
  const d = new Date();
  d.setDate(d.getDate() - days);
  return d;
}

export type RealizedMarginResult = { marginPct: number; lineCount: number; distinctSaleDays: number };

/**
 * Margen REALMENTE vendido, ponderado por cantidad, en los últimos 90 días
 * de ESA sucursal — (unitPrice − descuento por unidad − costSnapshot) /
 * precio neto, solo líneas con costSnapshot (sin eso no hay margen real
 * que calcular, y promediar con un 0 falso inflaría/desinflaría el real).
 */
export async function computeRealizedMarginBatch(
  db: typeof prisma,
  pairs: Array<{ branchId: string; productId: string }>,
): Promise<Map<string, RealizedMarginResult>> {
  const result = new Map<string, RealizedMarginResult>();
  if (pairs.length === 0) return result;

  const since = daysAgo(REALIZED_MARGIN_WINDOW_DAYS);
  const productIds = [...new Set(pairs.map((p) => p.productId))];
  const branchIds = [...new Set(pairs.map((p) => p.branchId))];

  const lines = await db.saleOrderLine.findMany({
    where: {
      productId: { in: productIds },
      costSnapshot: { not: null },
      saleOrder: { status: { in: [...SALE_STATUSES] }, createdAt: { gte: since }, branchId: { in: branchIds } },
    },
    select: { productId: true, quantity: true, unitPrice: true, discountAmount: true, costSnapshot: true, saleOrder: { select: { branchId: true, createdAt: true } } },
  });

  const byKey = new Map<string, { weightedMarginSum: Prisma.Decimal; qtySum: Prisma.Decimal; lineCount: number; days: Set<string> }>();
  for (const line of lines) {
    const branchId = line.saleOrder.branchId;
    if (!branchId) continue;
    const key = `${branchId}:${line.productId}`;
    const qty = line.quantity;
    if (qty.lte(0)) continue;
    const discountPerUnit = line.discountAmount.div(qty);
    const netPricePerUnit = line.unitPrice.sub(discountPerUnit);
    if (netPricePerUnit.lte(0)) continue;
    const marginPerUnit = netPricePerUnit.sub(line.costSnapshot!);
    const marginPctLine = marginPerUnit.div(netPricePerUnit);

    const bucket = byKey.get(key) ?? { weightedMarginSum: new Prisma.Decimal(0), qtySum: new Prisma.Decimal(0), lineCount: 0, days: new Set<string>() };
    bucket.weightedMarginSum = bucket.weightedMarginSum.add(marginPctLine.mul(qty));
    bucket.qtySum = bucket.qtySum.add(qty);
    bucket.lineCount += 1;
    bucket.days.add(line.saleOrder.createdAt.toISOString().slice(0, 10));
    byKey.set(key, bucket);
  }

  for (const [key, bucket] of byKey) {
    if (bucket.qtySum.lte(0)) continue;
    result.set(key, {
      marginPct: Number(bucket.weightedMarginSum.div(bucket.qtySum).mul(100).toFixed(2)),
      lineCount: bucket.lineCount,
      distinctSaleDays: bucket.days.size,
    });
  }
  return result;
}

export async function computeRealizedMargin(db: typeof prisma, input: { branchId: string; productId: string }): Promise<RealizedMarginResult | null> {
  const batch = await computeRealizedMarginBatch(db, [input]);
  return batch.get(`${input.branchId}:${input.productId}`) ?? null;
}

/**
 * Unidades vendidas en 90 días — TODAS las líneas, con o sin costSnapshot
 * (a diferencia de computeRealizedMarginBatch, que necesita costSnapshot
 * para el margen). Una fila de la lista (§1.3/§1.4) no necesita margen
 * real para mostrar cuánto se vendió.
 */
export async function computeUnits90dBatch(
  db: typeof prisma,
  pairs: Array<{ branchId: string; productId: string }>,
): Promise<Map<string, number>> {
  const result = new Map<string, number>();
  if (pairs.length === 0) return result;

  const since = daysAgo(REALIZED_MARGIN_WINDOW_DAYS);
  const productIds = [...new Set(pairs.map((p) => p.productId))];
  const branchIds = [...new Set(pairs.map((p) => p.branchId))];

  const lines = await db.saleOrderLine.findMany({
    where: { productId: { in: productIds }, saleOrder: { status: { in: [...SALE_STATUSES] }, createdAt: { gte: since }, branchId: { in: branchIds } } },
    select: { productId: true, quantity: true, saleOrder: { select: { branchId: true } } },
  });
  for (const line of lines) {
    const branchId = line.saleOrder.branchId;
    if (!branchId) continue;
    const key = `${branchId}:${line.productId}`;
    result.set(key, (result.get(key) ?? 0) + Number(line.quantity));
  }
  return result;
}

export type OtherBranchPricesResult = { min: number; max: number; count: number };

/** Mín/máx del precio de ESE producto en las DEMÁS sucursales — una sola consulta para toda la página, agrupada por producto. */
export async function computeOtherBranchPricesBatch(
  db: typeof prisma,
  pairs: Array<{ branchId: string; productId: string }>,
): Promise<Map<string, OtherBranchPricesResult>> {
  const result = new Map<string, OtherBranchPricesResult>();
  if (pairs.length === 0) return result;

  const productIds = [...new Set(pairs.map((p) => p.productId))];
  const settings = await db.branchProductSetting.findMany({
    where: { productId: { in: productIds }, branchPrice: { not: null } },
    select: { branchId: true, productId: true, branchPrice: true },
  });

  const pricesByProduct = new Map<string, Array<{ branchId: string; price: number }>>();
  for (const s of settings) {
    const list = pricesByProduct.get(s.productId) ?? [];
    list.push({ branchId: s.branchId, price: Number(s.branchPrice) });
    pricesByProduct.set(s.productId, list);
  }

  for (const pair of pairs) {
    const prices = (pricesByProduct.get(pair.productId) ?? []).filter((p) => p.branchId !== pair.branchId).map((p) => p.price);
    if (prices.length === 0) continue;
    result.set(`${pair.branchId}:${pair.productId}`, { min: Math.min(...prices), max: Math.max(...prices), count: prices.length });
  }
  return result;
}

/** "no disponible" según el umbral de la Fase 2: menos de 5 líneas o menos de 3 días con venta. */
export function realizedMarginUsable(result: RealizedMarginResult | null): result is RealizedMarginResult {
  return result !== null && result.lineCount >= MIN_LINES_FOR_REALIZED_MARGIN && result.distinctSaleDays >= MIN_DAYS_FOR_REALIZED_MARGIN;
}

/**
 * Costo ANTERIOR al cambio que disparó la revisión — priceReviewedCost si
 * el dueño ya revisó este producto antes, o el costSnapshot de la última
 * venta anterior a `costUpdatedAt` (el momento conocido en que el costo
 * global/promedio del producto cambió). null = sin nada confiable.
 */
export async function resolvePriorCost(
  db: typeof prisma,
  input: { branchId: string; productId: string; priceReviewedCost: Prisma.Decimal | null; costUpdatedAt: Date | null },
): Promise<number | null> {
  if (input.priceReviewedCost !== null) return Number(input.priceReviewedCost);
  if (!input.costUpdatedAt) return null;

  const lastLineBefore = await db.saleOrderLine.findFirst({
    where: {
      productId: input.productId,
      costSnapshot: { not: null },
      saleOrder: { branchId: input.branchId, status: { in: [...SALE_STATUSES] }, createdAt: { lt: input.costUpdatedAt } },
    },
    orderBy: { saleOrder: { createdAt: "desc" } },
    select: { costSnapshot: true },
  });
  return lastLineBefore?.costSnapshot ? Number(lastLineBefore.costSnapshot) : null;
}

/** Lee el desglose directo de lo que el detector ya calculó — no recalcula nada. */
export function buildSuggestedBreakdownFromDecision(
  evidence: Record<string, unknown> | null,
  calculationSnapshot: Record<string, unknown> | null | undefined,
): SuggestedBreakdown | null {
  if (!evidence || !calculationSnapshot) return null;
  const targetMarginPercent = typeof evidence.marginObjetivo === "number" ? evidence.marginObjetivo : null;
  const commercialClass = typeof evidence.commercialClass === "string" ? evidence.commercialClass as CombinedAbcXyzClass : null;
  const marginAfterAdjustment = typeof calculationSnapshot.marginPercent === "number" ? calculationSnapshot.marginPercent : null;
  const finalPrice = typeof calculationSnapshot.suggestedPrice === "number" ? calculationSnapshot.suggestedPrice : null;
  if (targetMarginPercent === null || commercialClass === null || marginAfterAdjustment === null || finalPrice === null) return null;

  const marginDelta = typeof evidence.marginDelta === "number" ? evidence.marginDelta : Number((marginAfterAdjustment - targetMarginPercent).toFixed(1));
  const flooredByPolicy = Math.abs(targetMarginPercent + marginDelta - marginAfterAdjustment) > 0.05;
  const rawPrice = typeof calculationSnapshot.rawSuggestedPrice === "number" ? calculationSnapshot.rawSuggestedPrice : finalPrice;
  const operatingExpensePerUnit = typeof calculationSnapshot.operatingExpensePerUnit === "number" ? calculationSnapshot.operatingExpensePerUnit : 0;
  const minProfitAmount = typeof calculationSnapshot.minProfitAmount === "number" ? calculationSnapshot.minProfitAmount : 0;
  const roundingRule = typeof calculationSnapshot.roundingRule === "string" ? calculationSnapshot.roundingRule as RoundingRule : "NEAREST_1";

  return {
    targetMarginPercent,
    abcXyzClass: describeAbcXyzClass(commercialClass),
    marginDelta,
    marginAfterAdjustment,
    flooredByPolicy,
    operatingExpensePerUnit,
    minProfitAmount,
    roundingRule,
    rawPrice,
    finalPrice,
  };
}

export type PricingTrayDecisionContext = {
  references: PriceReference[];
  sales90d: { units: number; amount: number };
  /** "un gráfico simple de las ventas de 90 días por semana" (Fase 4.2) — ~13 semanas, la más vieja primero. */
  weeklyUnits: Array<{ weekStart: string; units: number }>;
  daysInStock: number | null;
  realizedMarginPct: number | null;
  otherBranches: Array<{ branchId: string; branchName: string; price: number; marginHere: number | null }>;
  priceHistory: Array<{ changedAt: string; previousPrice: number | null; newPrice: number | null; actorName: string | null }>;
  lastReview: { reviewedAt: string; reviewedPrice: number | null; reviewedCost: number | null; byUserName: string | null; note: string | null } | null;
};

/** Pura — agrupa líneas (fecha, cantidad) en baldes semanales de domingo a sábado, la semana más vieja primero. */
export function bucketUnitsByWeek(lines: Array<{ createdAt: Date; quantity: number }>, windowDays: number): Array<{ weekStart: string; units: number }> {
  const since = new Date();
  since.setDate(since.getDate() - windowDays);
  since.setHours(0, 0, 0, 0);

  const buckets = new Map<string, number>();
  for (const line of lines) {
    const weekStart = new Date(line.createdAt);
    weekStart.setHours(0, 0, 0, 0);
    weekStart.setDate(weekStart.getDate() - weekStart.getDay());
    const key = weekStart.toISOString().slice(0, 10);
    buckets.set(key, (buckets.get(key) ?? 0) + line.quantity);
  }
  return [...buckets.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([weekStart, units]) => ({ weekStart, units }));
}

export async function getPricingTrayDecisionContext(decisionId: string, db: typeof prisma = prisma): Promise<PricingTrayDecisionContext> {
  const decision = await db.brainDecision.findUniqueOrThrow({ where: { id: decisionId } });
  if (decision.category !== "PRICING") throw new Error("DECISION_NOT_PRICING");
  if (!decision.branchId || !decision.productId) throw new Error("DECISION_MISSING_SUGGESTED_PRICE");
  const { branchId, productId } = decision;

  const evidence = decision.evidenceJson as Record<string, unknown> | null;
  const proposed = decision.proposedActionJson as Record<string, unknown> | null;
  const calculationSnapshot = (proposed?.calculationSnapshot ?? null) as Record<string, unknown> | null;

  const [effective, policy, realized, setting, product, otherSettings, priceChanges, salesAgg] = await Promise.all([
    getEffectiveProductPricing(db, { branchId, productId }),
    resolvePolicyForProduct({ branchId, productId }, db),
    computeRealizedMargin(db, { branchId, productId }),
    db.branchProductSetting.findUnique({ where: { branchId_productId: { branchId, productId } } }),
    db.product.findUniqueOrThrow({ where: { id: productId }, select: { costUpdatedAt: true } }),
    db.branchProductSetting.findMany({
      where: { productId, branchId: { not: branchId }, branchPrice: { not: null } },
      include: { branch: { select: { id: true, name: true } } },
    }),
    db.auditLog.findMany({
      where: { module: "pricing", action: "PRODUCT_PRICE_CHANGED", entityId: productId, branchId },
      orderBy: { occurredAt: "desc" },
      take: 5,
      include: { actor: { select: { fullName: true, username: true } } },
    }),
    db.saleOrderLine.aggregate({
      where: { productId, saleOrder: { branchId, status: { in: [...SALE_STATUSES] }, createdAt: { gte: daysAgo(REALIZED_MARGIN_WINDOW_DAYS) } } },
      _sum: { quantity: true, lineSubtotal: true },
    }),
  ]);

  const weeklyLines = await db.saleOrderLine.findMany({
    where: { productId, saleOrder: { branchId, status: { in: [...SALE_STATUSES] }, createdAt: { gte: daysAgo(REALIZED_MARGIN_WINDOW_DAYS) } } },
    select: { quantity: true, saleOrder: { select: { createdAt: true } } },
  });
  const weeklyUnits = bucketUnitsByWeek(weeklyLines.map((l) => ({ createdAt: l.saleOrder.createdAt, quantity: Number(l.quantity) })), REALIZED_MARGIN_WINDOW_DAYS);

  const reviewer = setting?.priceReviewedByUserId
    ? await db.user.findUnique({ where: { id: setting.priceReviewedByUserId }, select: { fullName: true, username: true } })
    : null;

  const effectivePrice = effective.effectivePrice === null ? null : Number(effective.effectivePrice);
  const effectiveCost = effective.effectiveCost === null ? null : Number(effective.effectiveCost);
  const priorCost = await resolvePriorCost(db, { branchId, productId, priceReviewedCost: setting?.priceReviewedCost ?? null, costUpdatedAt: product.costUpdatedAt });
  const suggested = buildSuggestedBreakdownFromDecision(evidence, calculationSnapshot);

  const references = buildPriceReferences({
    currentPrice: effectivePrice,
    effectiveCost,
    roundingRule: policy.categoryPolicy.roundingRule as RoundingRule,
    policyMinMarginPercent: policy.categoryPolicy.minMarginPercent,
    suggested,
    realizedMargin: realizedMarginUsable(realized) ? realized : null,
    priorCost,
    otherBranches: otherSettings.map((s) => ({ branchId: s.branchId, branchName: s.branch.name, price: Number(s.branchPrice) })),
  });

  const avgDailySales = Number(salesAgg._sum.quantity ?? 0) / REALIZED_MARGIN_WINDOW_DAYS;
  const stockOnHand = typeof evidence?.stockAtRisk === "number" ? evidence.stockAtRisk : (typeof evidence?.stock === "number" ? evidence.stock : null);
  const daysInStock = stockOnHand !== null && avgDailySales > 0 ? Number((stockOnHand / avgDailySales).toFixed(1)) : null;

  return {
    references,
    sales90d: { units: Number(salesAgg._sum.quantity ?? 0), amount: Number(salesAgg._sum.lineSubtotal ?? 0) },
    weeklyUnits,
    daysInStock,
    realizedMarginPct: realizedMarginUsable(realized) ? realized.marginPct : null,
    otherBranches: otherSettings.map((s) => {
      const price = Number(s.branchPrice);
      const marginHere = effectiveCost !== null && price > 0 ? Number((((price - effectiveCost) / price) * 100).toFixed(1)) : null;
      return { branchId: s.branchId, branchName: s.branch.name, price, marginHere };
    }),
    priceHistory: priceChanges.map((log) => {
      const meta = (log.metadataJson ?? {}) as Record<string, unknown>;
      return {
        changedAt: log.occurredAt.toISOString(),
        previousPrice: typeof meta.previousPrice === "number" ? meta.previousPrice : null,
        newPrice: typeof meta.newPrice === "number" ? meta.newPrice : null,
        actorName: log.actor?.fullName ?? log.actor?.username ?? null,
      };
    }),
    lastReview: setting?.priceReviewedAt
      ? {
          reviewedAt: setting.priceReviewedAt.toISOString(),
          reviewedPrice: setting.priceReviewedPrice === null ? null : Number(setting.priceReviewedPrice),
          reviewedCost: setting.priceReviewedCost === null ? null : Number(setting.priceReviewedCost),
          byUserName: reviewer?.fullName ?? reviewer?.username ?? null,
          note: setting.priceReviewNote ?? null,
        }
      : null,
  };
}
