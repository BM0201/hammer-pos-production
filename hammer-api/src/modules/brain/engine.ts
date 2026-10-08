import { BrainDecisionCategory, Prisma, type BrainDecisionSeverity } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { refreshAllInsights } from "@/modules/ai-insights/service";
import { detectCashDecisions } from "@/modules/brain/detectors/cash-detector";
import { detectDispatchDecisions } from "@/modules/brain/detectors/dispatch-detector";
import { detectInventoryDecisions } from "@/modules/brain/detectors/inventory-detector";
import { detectWacHealthDecisions } from "@/modules/brain/detectors/wac-health-detector";
import { detectPricingDecisions } from "@/modules/brain/detectors/pricing-detector";
import { detectReorderDecisions } from "@/modules/brain/detectors/reorder-detector";
import { detectSalesDecisions } from "@/modules/brain/detectors/sales-detector";
import { detectPurchasingDecisions } from "@/modules/brain/detectors/purchasing-detector";
import { detectSecurityDecisions } from "@/modules/brain/detectors/security-detector";
import { detectSystemDecisions } from "@/modules/brain/detectors/system-detector";
import { riskScoreFor } from "@/modules/brain/scoring";
import { persistBrainDecisions, autoResolveNotRedetected, acquireScanRunLockTx, shouldAutoCloseAfterScan } from "@/modules/brain/service";
import type { BrainDecisionDraft, BrainDetectorContext, BrainScanResult, BrainScanDetectorSummary } from "@/modules/brain/types";
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

const OPERATIONAL_DAY_SCAN_CATEGORIES = new Set<BrainDecisionCategory>([
  BrainDecisionCategory.CASH,
  BrainDecisionCategory.SALES,
  BrainDecisionCategory.INVENTORY,
  BrainDecisionCategory.DISPATCH,
  BrainDecisionCategory.REORDER,
  BrainDecisionCategory.PURCHASING,
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
  // SCHEDULED_SCAN (cron cada hora, "Escanear ahora" y el refresh de
  // Precios) es el default ahora — antes era QUICK_SCAN. Los otros 5 modos
  // ("avanzados") siguen existiendo para diagnóstico puntual (Fase 2 los
  // deja detrás de SYSTEM_ADMIN en la ruta).
  const mode = input.mode ?? "SCHEDULED_SCAN";
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
  if (mode === "OPERATIONAL_DAY_SCAN") return OPERATIONAL_DAY_SCAN_CATEGORIES.has(category);
  // SCHEDULED_SCAN y DEEP_SCAN: todos los detectores, sin filtro de categoría.
  return true;
}

function withTimeout<T>(promise: Promise<T>, ms: number, label: string): Promise<T> {
  return Promise.race([
    promise,
    new Promise<T>((_, reject) =>
      setTimeout(() => reject(new Error(`TIMEOUT: ${label} excedió ${ms}ms`)), ms)
    ),
  ]);
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
      branchId: ctx.branchId ?? null,
      // B.11 — sin branchId el mismo insight de dos sucursales se pisaba
      // (mismo fingerprint); confidenceScore ya no es fijo (null: la
      // pantalla no debe mostrar "Confianza" para algo que nunca se midió).
      confidenceScore: null,
      riskScore: riskScoreFor(severity, 75),
      proposedActionType: "REVIEW_LEGACY_AI_INSIGHT",
      evidenceJson: item as unknown as Prisma.InputJsonValue,
      sourceJson: { detector: "ai-insights", legacyId: item.id, generatedAt: summary.generatedAt },
      fingerprintParts: ["ai-insights", ctx.branchId ?? "ALL", item.category, item.id],
    } satisfies BrainDecisionDraft;
  });
}

export async function runBrainScan(input: ScanBrainInput & { actorUserId?: string }) {
  const mode = validateScanInput(input);
  const trigger = input.trigger ?? "MANUAL";
  const scanRunId = await acquireScanRunLockTx(prisma, { mode, trigger, branchId: input.branchId, actorUserId: input.actorUserId });
  const scanStartedAt = new Date();

  try {
    const days = mode === "QUICK_SCAN" ? 1 : mode === "SCHEDULED_SCAN" ? 30 : input.days ?? 30;
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
      { key: "wac-health-detector", category: BrainDecisionCategory.INVENTORY, run: () => detectWacHealthDecisions(ctx) },
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

    const timedRuns = await Promise.allSettled(
      detectors.map(async (detector) => {
        const startedAt = Date.now();
        const drafts = await withTimeout(detector.run(), limits.timeoutMs, detector.key);
        return { drafts, ms: Date.now() - startedAt };
      })
    );

    // Tope POR DETECTOR, no global — antes un solo slice(0, maxIssues) sobre
    // la lista combinada podía dejar a un detector entero sin nada si otro
    // producía muchos hallazgos primero.
    const detectorSummaries: BrainScanDetectorSummary[] = [];
    const allDrafts: Array<BrainDecisionDraft & { detectorKey: string }> = [];

    timedRuns.forEach((result, index) => {
      const detector = detectors[index];
      if (result.status === "rejected") {
        detectorSummaries.push({
          key: detector.key,
          category: detector.category,
          ok: false,
          count: 0,
          capped: false,
          ms: null,
          error: result.reason instanceof Error ? result.reason.message : String(result.reason),
        });
        return;
      }
      const filtered = result.value.drafts
        .filter((draft) => !input.severity || draft.severity === input.severity)
        .filter((draft) => mode !== "QUICK_SCAN" || ["CRITICAL", "HIGH"].includes(draft.severity));
      const capped = filtered.length > limits.maxIssues;
      const kept = filtered.slice(0, limits.maxIssues);
      for (const draft of kept) allDrafts.push({ ...draft, detectorKey: detector.key });
      detectorSummaries.push({ key: detector.key, category: detector.category, ok: true, count: kept.length, capped, ms: result.value.ms });
    });

    const persistResult = await persistBrainDecisions(allDrafts, input.actorUserId, {
      dryRun: input.dryRun,
      force: input.force,
      scannedCategories: detectors.map((detector) => detector.category),
      scope: ctx.scope,
      limits,
    });

    let autoResolved = 0;
    if (!input.dryRun) {
      for (const summary of detectorSummaries) {
        if (!shouldAutoCloseAfterScan(mode, summary)) continue;
        autoResolved += await autoResolveNotRedetected({
          detectorKey: summary.key,
          branchId: ctx.branchId,
          scanStartedAt,
        });
      }
    }

    const hasErrors = detectorSummaries.some((d) => !d.ok);
    const hasCapped = detectorSummaries.some((d) => d.capped);
    const finalStatus = hasErrors ? "PARTIAL" : hasCapped ? "PARTIAL" : "OK";
    await prisma.brainScanRun.update({
      where: { id: scanRunId },
      data: {
        status: finalStatus,
        finishedAt: new Date(),
        runningLock: null,
        detectorsJson: detectorSummaries as unknown as Prisma.InputJsonValue,
        created: persistResult.created,
        updated: persistResult.updated,
        reopened: persistResult.reopened,
        autoResolved,
        skipped: persistResult.skipped,
      },
    });

    const partialWarning = detectorSummaries
      .filter((d) => d.capped)
      .map((d) => ({ detector: d.key, message: `SCAN_PARTIAL: ${d.key} produjo más de ${limits.maxIssues} hallazgos; se procesaron solo los primeros ${limits.maxIssues}.` }));

    return {
      ...persistResult,
      autoResolved,
      scanRunId,
      errors: [...persistResult.errors, ...partialWarning],
    } satisfies BrainScanResult & { autoResolved: number; scanRunId: string };
  } catch (error) {
    await prisma.brainScanRun.update({
      where: { id: scanRunId },
      data: { status: "FAILED", finishedAt: new Date(), runningLock: null },
    }).catch(() => {});
    throw error;
  }
}
