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
  const days = input.days ?? 30;
  const now = input.now && process.env.NODE_ENV !== "production" ? new Date(input.now) : new Date();
  const ctx: BrainDetectorContext = {
    branchId: input.branchId,
    days,
    now,
    since: new Date(now.getTime() - days * 24 * 60 * 60 * 1000),
  };

  const detectors: Array<{ category: BrainDecisionCategory; run: () => Promise<BrainDecisionDraft[]> }> = [
    { category: BrainDecisionCategory.INVENTORY, run: () => detectInventoryDecisions(ctx) },
    { category: BrainDecisionCategory.REORDER, run: () => detectReorderDecisions(ctx) },
    { category: BrainDecisionCategory.PRICING, run: () => detectPricingDecisions(ctx) },
    { category: BrainDecisionCategory.CASH, run: () => detectCashDecisions(ctx) },
    { category: BrainDecisionCategory.SALES, run: () => detectSalesDecisions(ctx) },
    { category: BrainDecisionCategory.DISPATCH, run: () => detectDispatchDecisions(ctx) },
    { category: BrainDecisionCategory.PURCHASING, run: () => detectPurchasingDecisions(ctx) },
    { category: BrainDecisionCategory.SECURITY, run: () => detectSecurityDecisions(ctx) },
    { category: BrainDecisionCategory.SYSTEM, run: () => detectSystemDecisions(ctx) },
    { category: BrainDecisionCategory.AUDIT, run: () => detectLegacyAiInsightDecisions(ctx) },
  ].filter((detector) => !input.category || detector.category === input.category);

  const settled = await Promise.allSettled(detectors.map((detector) => detector.run()));
  const errors = settled.flatMap((result, index) => result.status === "rejected"
    ? [{ detector: detectors[index].category, message: result.reason instanceof Error ? result.reason.message : String(result.reason) }]
    : []);
  const detectorResults = settled.flatMap((result) => result.status === "fulfilled" ? result.value : []);

  return persistBrainDecisions(detectorResults, input.actorUserId, {
    dryRun: input.dryRun,
    force: input.force,
    scannedCategories: detectors.map((detector) => detector.category),
  }).then((result) => ({ ...result, errors: [...result.errors, ...errors] }));
}
