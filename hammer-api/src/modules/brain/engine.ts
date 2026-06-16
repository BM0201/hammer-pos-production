import { BrainDecisionCategory, Prisma, type BrainDecisionSeverity } from "@prisma/client";
import { refreshAllInsights } from "@/modules/ai-insights/service";
import { detectCashDecisions } from "@/modules/brain/detectors/cash-detector";
import { detectDispatchDecisions } from "@/modules/brain/detectors/dispatch-detector";
import { detectInventoryDecisions } from "@/modules/brain/detectors/inventory-detector";
import { detectPricingDecisions } from "@/modules/brain/detectors/pricing-detector";
import { detectReorderDecisions } from "@/modules/brain/detectors/reorder-detector";
import { detectSalesDecisions } from "@/modules/brain/detectors/sales-detector";
import { detectPurchasingDecisions } from "@/modules/brain/detectors/purchasing-detector";
import { detectSecurityDecisions } from "@/modules/brain/detectors/security-detector";
import { detectSystemDecisions } from "@/modules/brain/detectors/system-detector";
import { riskScoreFor } from "@/modules/brain/scoring";
import { persistBrainDecisions } from "@/modules/brain/service";
import type { BrainDecisionDraft, BrainDetectorContext } from "@/modules/brain/types";
import type { ScanBrainInput } from "@/modules/brain/validators";

const QUICK_SCAN_CATEGORIES = new Set<BrainDecisionCategory>([
  BrainDecisionCategory.CASH,
  BrainDecisionCategory.SALES,
  BrainDecisionCategory.INVENTORY,
  BrainDecisionCategory.DISPATCH,
  BrainDecisionCategory.SYSTEM,
]);

const ENTITY_SCAN_CATEGORIES = new Set<BrainDecisionCategory>([
  BrainDecisionCategory.CASH,
  BrainDecisionCategory.SALES,
  BrainDecisionCategory.INVENTORY,
  BrainDecisionCategory.DISPATCH,
  BrainDecisionCategory.AUDIT,
]);

const REPAIR_SCAN_CATEGORIES = new Set<BrainDecisionCategory>([
  BrainDecisionCategory.CASH,
  BrainDecisionCategory.SALES,
  BrainDecisionCategory.INVENTORY,
  BrainDecisionCategory.SYSTEM,
]);

function managuaBusinessDate(now: Date) {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/Managua",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(now);
}

function managuaDayRangeUtc(ymd: string) {
  const [year, month, day] = ymd.split("-").map(Number);
  const start = new Date(Date.UTC(year, month - 1, day, 6, 0, 0, 0));
  const end = new Date(start.getTime() + 24 * 60 * 60 * 1000);
  return { start, end };
}

function validateScanInput(input: ScanBrainInput) {
  const mode = input.mode ?? "QUICK_SCAN";
  if (mode === "ENTITY_SCAN" && !input.saleOrderId && !input.cashSessionId && !input.productId && !input.operationalDayId) {
    throw new Error("INVALID_INPUT: ENTITY_SCAN requiere saleOrderId, cashSessionId, productId u operationalDayId.");
  }
  if (mode === "OPERATIONAL_DAY_SCAN" && !input.branchId && !input.operationalDayId) {
    throw new Error("INVALID_INPUT: OPERATIONAL_DAY_SCAN requiere branchId u operationalDayId.");
  }
  if (mode === "DEEP_SCAN") {
    if (!input.dateFrom || !input.dateTo) throw new Error("INVALID_INPUT: DEEP_SCAN requiere dateFrom y dateTo.");
    const rangeMs = new Date(input.dateTo).getTime() - new Date(input.dateFrom).getTime();
    if (rangeMs < 0 || rangeMs > 90 * 24 * 60 * 60 * 1000) {
      throw new Error("INVALID_INPUT: DEEP_SCAN solo permite rangos de hasta 90 dias.");
    }
  }
  return mode;
}

function detectorAllowedForMode(category: BrainDecisionCategory, mode: string) {
  if (mode === "QUICK_SCAN") return QUICK_SCAN_CATEGORIES.has(category);
  if (mode === "ENTITY_SCAN") return ENTITY_SCAN_CATEGORIES.has(category);
  if (mode === "REPAIR_SCAN") return REPAIR_SCAN_CATEGORIES.has(category);
  return true;
}

function normalizeSeverity(severity: string): BrainDecisionSeverity {
  const value = severity.toUpperCase();
  if (["CRITICAL", "HIGH", "MEDIUM", "LOW", "INFO"].includes(value)) return value as BrainDecisionSeverity;
  return "INFO";
}

function categoryFromLegacy(category: string): BrainDecisionCategory {
  if (category === "discount") return BrainDecisionCategory.PRICING;
  if (category === "anomaly") return BrainDecisionCategory.AUDIT;
  if (category === "discrepancy") return BrainDecisionCategory.AUDIT;
  if (category === "pattern") return BrainDecisionCategory.SALES;
  return BrainDecisionCategory.AUDIT;
}

async function detectLegacyAiInsightDecisions(ctx: BrainDetectorContext): Promise<BrainDecisionDraft[]> {
  const summary = await refreshAllInsights(ctx.branchId, ctx.days);
  const rows = [
    ...summary.discountSuggestions,
    ...summary.anomalies,
    ...summary.discrepancies,
    ...summary.patterns,
    ...summary.recommendations,
  ].slice(0, 80);

  return rows.map((item) => {
    const severity = normalizeSeverity(item.severity);
    return {
      category: categoryFromLegacy(item.category),
      severity,
      title: item.title,
      description: item.description,
      recommendation: "Revisar la evidencia del insight y aprobar una accion operativa si aplica.",
      confidenceScore: 0.68,
      riskScore: riskScoreFor(severity, 0.68),
      proposedActionType: "REVIEW_LEGACY_AI_INSIGHT",
      evidenceJson: item as unknown as Prisma.InputJsonValue,
      sourceJson: { detector: "ai-insights", legacyId: item.id, generatedAt: summary.generatedAt },
      fingerprintParts: ["ai-insights", item.category, item.id],
    } satisfies BrainDecisionDraft;
  });
}

export async function runBrainScan(input: ScanBrainInput & { actorUserId?: string }) {
  const mode = validateScanInput(input);
  const days = mode === "QUICK_SCAN" ? 1 : input.days ?? 30;
  const now = input.now && process.env.NODE_ENV !== "production" ? new Date(input.now) : new Date();
  const businessDate = input.businessDate ?? (mode === "QUICK_SCAN" ? managuaBusinessDate(now) : undefined);
  const businessRange = businessDate ? managuaDayRangeUtc(businessDate) : null;
  const dateFrom = input.dateFrom ? new Date(input.dateFrom) : businessRange?.start ?? new Date(now.getTime() - days * 24 * 60 * 60 * 1000);
  const dateTo = input.dateTo ? new Date(input.dateTo) : businessRange?.end ?? now;
  const limits = {
    maxIssues: input.maxIssues ?? (mode === "QUICK_SCAN" ? 50 : 150),
    maxEntities: input.maxEntities ?? (mode === "QUICK_SCAN" ? 250 : 1000),
    timeoutMs: input.timeoutMs ?? (mode === "QUICK_SCAN" ? 5000 : 15000),
  };
  const ctx: BrainDetectorContext = {
    branchId: input.branchId,
    businessDate,
    operationalDayId: input.operationalDayId,
    cashSessionId: input.cashSessionId,
    saleOrderId: input.saleOrderId,
    productId: input.productId,
    detector: input.detector,
    mode,
    days,
    now,
    since: dateFrom,
    dateFrom,
    dateTo,
    dryRun: input.dryRun,
    limits,
    scope: {
      branchId: input.branchId,
      businessDate,
      operationalDayId: input.operationalDayId,
      cashSessionId: input.cashSessionId,
      saleOrderId: input.saleOrderId,
      productId: input.productId,
      category: input.category,
      severity: input.severity,
      detector: input.detector,
      dateFrom,
      dateTo,
      mode,
    },
  };

  const detectors: Array<{ key: string; category: BrainDecisionCategory; run: () => Promise<BrainDecisionDraft[]> }> = [
    { key: "inventory-detector", category: BrainDecisionCategory.INVENTORY, run: () => detectInventoryDecisions(ctx) },
    { key: "reorder-detector", category: BrainDecisionCategory.REORDER, run: () => detectReorderDecisions(ctx) },
    { key: "pricing-detector", category: BrainDecisionCategory.PRICING, run: () => detectPricingDecisions(ctx) },
    { key: "cash-detector", category: BrainDecisionCategory.CASH, run: () => detectCashDecisions(ctx) },
    { key: "sales-detector", category: BrainDecisionCategory.SALES, run: () => detectSalesDecisions(ctx) },
    { key: "dispatch-detector", category: BrainDecisionCategory.DISPATCH, run: () => detectDispatchDecisions(ctx) },
    { key: "purchasing-detector", category: BrainDecisionCategory.PURCHASING, run: () => detectPurchasingDecisions(ctx) },
    { key: "security-detector", category: BrainDecisionCategory.SECURITY, run: () => detectSecurityDecisions(ctx) },
    { key: "system-detector", category: BrainDecisionCategory.SYSTEM, run: () => detectSystemDecisions(ctx) },
    { key: "ai-insights", category: BrainDecisionCategory.AUDIT, run: () => detectLegacyAiInsightDecisions(ctx) },
  ].filter((detector) =>
    (!input.category || detector.category === input.category)
    && (!input.detector || detector.key === input.detector)
    && detectorAllowedForMode(detector.category, mode)
  );

  const settled = await Promise.allSettled(detectors.map((detector) => detector.run()));
  const errors = settled.flatMap((result, index) => result.status === "rejected"
    ? [{ detector: detectors[index].key, message: result.reason instanceof Error ? result.reason.message : String(result.reason) }]
    : []);
  const detectorResults = settled
    .flatMap((result) => result.status === "fulfilled" ? result.value : [])
    .filter((draft) => !input.severity || draft.severity === input.severity)
    .filter((draft) => mode !== "QUICK_SCAN" || ["CRITICAL", "HIGH"].includes(draft.severity))
    .slice(0, limits.maxIssues);

  return persistBrainDecisions(detectorResults, input.actorUserId, {
    dryRun: input.dryRun,
    force: input.force,
    scannedCategories: detectors.map((detector) => detector.category),
    scope: ctx.scope,
    limits,
  }).then((result) => ({ ...result, errors: [...result.errors, ...errors] }));
}
