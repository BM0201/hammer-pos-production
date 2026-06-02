import { BrainDecisionCategory, BrainDecisionStatus, Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { executeDecisionAction } from "@/modules/brain/actions/execute-decision";
import {
  makeDecisionFingerprint,
  makeIdempotencyKey,
  normalizeConfidence,
  priorityScoreFor,
  riskScoreFor,
} from "@/modules/brain/scoring";
import type { BrainDecisionDraft, BrainDecisionFilters, BrainScanResult } from "@/modules/brain/types";

const terminalStatuses: BrainDecisionStatus[] = ["EXECUTED", "DISMISSED"];
const activeStatuses: BrainDecisionStatus[] = ["OPEN", "APPROVED", "MANUAL_REVIEW", "SNOOZED", "FAILED"];
const REOPEN_AFTER_DAYS = 14;

function decimal(value: number | null | undefined) {
  return value === null || value === undefined ? undefined : new Prisma.Decimal(value);
}

function json(value: Prisma.InputJsonValue | null | undefined) {
  return value === undefined ? undefined : value === null ? Prisma.JsonNull : value;
}

function includeDecisionRelations() {
  return {
    branch: { select: { id: true, code: true, name: true } },
    product: { select: { id: true, sku: true, name: true, unit: true } },
    resolvedBy: { select: { id: true, username: true, fullName: true } },
    targetUser: { select: { id: true, username: true, fullName: true } },
    actionLogs: {
      include: { actor: { select: { id: true, username: true, fullName: true } } },
      orderBy: { createdAt: "desc" as const },
      take: 10,
    },
    outcomes: { orderBy: { measuredAt: "desc" as const }, take: 5 },
  } satisfies Prisma.BrainDecisionInclude;
}

type DecisionWithRelations = Prisma.BrainDecisionGetPayload<{ include: ReturnType<typeof includeDecisionRelations> }>;

function numberValue(value: Prisma.Decimal | number | string | null | undefined) {
  const parsed = Number(value ?? 0);
  return Number.isFinite(parsed) ? parsed : 0;
}

function recordValue(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
}

function nestedRecord(value: unknown, key: string): Record<string, unknown> {
  return recordValue(recordValue(value)[key]);
}

function stringArray(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === "string") : [];
}

function relatedModuleFor(category: string) {
  if (category === "PRICING") return "PRICING";
  if (category === "INVENTORY" || category === "REORDER") return "INVENTORY";
  if (category === "PURCHASING") return "PURCHASING";
  if (category === "CASH" || category === "SALES") return "CASH";
  if (category === "SYSTEM" || category === "SECURITY" || category === "AUDIT") return "CONFIG";
  return category;
}

function nextBestActionFor(decision: Pick<DecisionWithRelations, "category" | "proposedActionType" | "severity" | "title" | "recommendation" | "evidenceJson">) {
  const actionType = decision.proposedActionType ?? "";
  if (actionType.includes("PURCHASE")) return "CREATE_PURCHASE_DRAFT";
  if (actionType.includes("TRANSFER")) return "CREATE_TRANSFER_DRAFT";
  if (actionType.includes("PRICE") || actionType.includes("MARGIN") || actionType.includes("COST")) return "RECALCULATE_PRICE";
  if (actionType.includes("CATEGORY_POLICY")) return "REVIEW_CATEGORY_POLICY";
  if (actionType.includes("PRICING_SCOPE_MISCONFIGURATION")) return "REVIEW_CATEGORY_POLICY";
  if (actionType.includes("CZ") || `${decision.title} ${decision.recommendation}`.includes("bajo pedido")) return "SELL_ON_DEMAND";
  if (decision.category === "CASH") return "REVIEW_DISCOUNTS";
  if (decision.category === "SYSTEM") return "FIX_CONFIGURATION";
  if (decision.category === "INVENTORY") return "REVIEW_REORDER_POLICY";
  return actionType || null;
}

function reasoningFor(decision: DecisionWithRelations) {
  const evidence = recordValue(decision.evidenceJson);
  const reasoning = stringArray(evidence.reasoning);
  if (reasoning.length) return reasoning;

  const lines = [
    decision.description,
    decision.recommendation,
  ];
  if (evidence.effectivePrice !== undefined && evidence.effectiveCost !== undefined) {
    lines.push(`Precio efectivo ${evidence.effectivePrice} contra costo efectivo ${evidence.effectiveCost}.`);
  }
  if (evidence.marginPct !== undefined && evidence.policyMinMarginPercent !== undefined) {
    lines.push(`Margen real ${evidence.marginPct}% contra minimo de politica ${evidence.policyMinMarginPercent}%.`);
  }
  if (evidence.commercialClass !== undefined) {
    lines.push(`Clasificacion comercial ${evidence.commercialClass}.`);
  }
  if (evidence.quantityOnHand !== undefined || evidence.stock !== undefined) {
    lines.push(`Stock observado: ${evidence.quantityOnHand ?? evidence.stock}.`);
  }
  return lines.filter(Boolean).slice(0, 5);
}

function recommendedActionsFor(decision: DecisionWithRelations) {
  const evidence = recordValue(decision.evidenceJson);
  const commercialActions = stringArray(evidence.commercialActions);
  const proposed = decision.proposedActionType ? [decision.proposedActionType] : [];
  const next = nextBestActionFor(decision);
  return Array.from(new Set([...proposed, ...(next ? [next] : []), ...commercialActions])).slice(0, 6);
}

function enrichDecision(decision: DecisionWithRelations) {
  const evidence = recordValue(decision.evidenceJson);
  const action = recordValue(decision.proposedActionJson);
  const categoryPolicy = recordValue(evidence.categoryPolicy);
  const commercial = recordValue(evidence.commercialIntelligence);
  const calculationSnapshot = recordValue(action.calculationSnapshot ?? evidence.calculationSnapshot);
  const urgencyScore = Math.max(numberValue(decision.priorityScore), numberValue(decision.riskScore));

  return {
    ...decision,
    confidenceScore: decision.confidenceScore,
    urgencyScore,
    estimatedImpactAmount: decision.impactAmount,
    nextBestAction: nextBestActionFor(decision),
    recommendedActions: recommendedActionsFor(decision),
    reasoning: reasoningFor(decision),
    evidence: {
      ...evidence,
      effectivePrice: evidence.effectivePrice,
      effectiveCost: evidence.effectiveCost,
      grossMarginPercent: evidence.marginPct,
      minMarginPercent: evidence.policyMinMarginPercent ?? categoryPolicy.minMarginPercent,
      categoryPolicy: Object.keys(categoryPolicy).length ? categoryPolicy : undefined,
      abcXyz: evidence.commercialClass ?? commercial.combinedClass,
      marketConflict: evidence.marketConflict ?? calculationSnapshot.marketConflict,
    },
    relatedModule: relatedModuleFor(decision.category),
  };
}

function buildExecutiveSummary(input: {
  totalDecisions: number;
  criticalCount: number;
  highRiskCount: number;
  estimatedImpactAmount: number;
  categoriesBreakdown: Record<string, number>;
  decisions: Array<ReturnType<typeof enrichDecision>>;
}) {
  const messages: string[] = [];
  const allText = input.decisions.map((decision) => `${decision.title} ${decision.description} ${decision.proposedActionType ?? ""}`).join(" ").toLowerCase();
  if (allText.includes("debajo") && allText.includes("costo")) messages.push("Hay productos con precio por debajo del costo.");
  if (allText.includes("transfer")) messages.push("Hay oportunidades de traslado antes de comprar.");
  if (allText.includes("cz") && allText.includes("stock")) messages.push("Hay productos CZ con stock que conviene revisar.");
  if (allText.includes("politica") || allText.includes("policy")) messages.push("Hay politicas o configuraciones que requieren revision.");
  if (allText.includes("prorrateo") || allText.includes("scope_misconfiguration")) messages.push("Hay posibles errores de prorrateo en pricing.");
  if (input.criticalCount > 0) messages.unshift(`Hay ${input.criticalCount} decisiones criticas abiertas.`);
  if (!messages.length) messages.push("No hay señales criticas nuevas en el conjunto filtrado.");

  return {
    executiveSummary: messages,
    priorityMessage: input.criticalCount > 0
      ? "Atender primero las decisiones criticas antes de aprobar compras, traslados o cambios de precio."
      : input.highRiskCount > 0
        ? "Revisar decisiones de alto riesgo y priorizar las que tengan impacto economico."
        : "El Brain no detecta prioridades criticas abiertas con los filtros actuales.",
    totalDecisions: input.totalDecisions,
    criticalCount: input.criticalCount,
    highRiskCount: input.highRiskCount,
    estimatedImpactAmount: input.estimatedImpactAmount,
    categoriesBreakdown: {
      pricing: input.categoriesBreakdown.PRICING ?? 0,
      inventory: (input.categoriesBreakdown.INVENTORY ?? 0) + (input.categoriesBreakdown.REORDER ?? 0),
      purchasing: input.categoriesBreakdown.PURCHASING ?? 0,
      transfers: input.decisions.filter((decision) => `${decision.proposedActionType ?? ""} ${decision.recommendation}`.toUpperCase().includes("TRANSFER")).length,
      cash: (input.categoriesBreakdown.CASH ?? 0) + (input.categoriesBreakdown.SALES ?? 0),
      config: (input.categoriesBreakdown.SYSTEM ?? 0) + (input.categoriesBreakdown.SECURITY ?? 0) + (input.categoriesBreakdown.AUDIT ?? 0),
    },
  };
}

function normalizeDraft(draft: BrainDecisionDraft) {
  const confidenceScore = normalizeConfidence(draft.confidenceScore);
  const riskScore = draft.riskScore ?? riskScoreFor(draft.severity, confidenceScore);
  const priorityScore = draft.priorityScore ?? priorityScoreFor({
    severity: draft.severity,
    riskScore,
    confidenceScore,
    impactAmount: draft.impactAmount,
    expiresAt: draft.expiresAt,
  });

  return { confidenceScore, riskScore, priorityScore };
}

function draftData(draft: BrainDecisionDraft, fingerprint: string, idempotencyKey: string): Prisma.BrainDecisionCreateInput {
  const scores = normalizeDraft(draft);
  const targetUserId = draft.targetUserId ?? draft.userId ?? null;
  return {
    category: draft.category,
    severity: draft.severity,
    title: draft.title,
    description: draft.description,
    recommendation: draft.recommendation,
    branch: draft.branchId ? { connect: { id: draft.branchId } } : undefined,
    product: draft.productId ? { connect: { id: draft.productId } } : undefined,
    legacyUser: draft.userId ? { connect: { id: draft.userId } } : undefined,
    targetUser: targetUserId ? { connect: { id: targetUserId } } : undefined,
    confidenceScore: decimal(scores.confidenceScore),
    impactAmount: decimal(draft.impactAmount),
    riskScore: decimal(scores.riskScore),
    priorityScore: decimal(scores.priorityScore),
    proposedActionType: draft.proposedActionType ?? null,
    proposedActionJson: json(draft.proposedActionJson),
    evidenceJson: json(draft.evidenceJson),
    sourceJson: json(draft.sourceJson),
    fingerprint,
    idempotencyKey,
    firstDetectedAt: new Date(),
    lastDetectedAt: new Date(),
    expiresAt: draft.expiresAt ?? null,
  };
}

function updateData(draft: BrainDecisionDraft): Prisma.BrainDecisionUpdateInput {
  const scores = normalizeDraft(draft);
  const targetUserId = draft.targetUserId ?? draft.userId ?? null;
  return {
    category: draft.category,
    severity: draft.severity,
    title: draft.title,
    description: draft.description,
    recommendation: draft.recommendation,
    branch: draft.branchId ? { connect: { id: draft.branchId } } : { disconnect: true },
    product: draft.productId ? { connect: { id: draft.productId } } : { disconnect: true },
    legacyUser: draft.userId ? { connect: { id: draft.userId } } : { disconnect: true },
    targetUser: targetUserId ? { connect: { id: targetUserId } } : { disconnect: true },
    confidenceScore: decimal(scores.confidenceScore),
    impactAmount: decimal(draft.impactAmount),
    riskScore: decimal(scores.riskScore),
    priorityScore: decimal(scores.priorityScore),
    proposedActionType: draft.proposedActionType ?? null,
    proposedActionJson: json(draft.proposedActionJson),
    evidenceJson: json(draft.evidenceJson),
    sourceJson: json(draft.sourceJson),
    lastDetectedAt: new Date(),
    expiresAt: draft.expiresAt ?? null,
  };
}

export async function getBrainSummary() {
  const [openCritical, highRisk, impact, reorderSuggested, cashRisks, lowMargin, lateDispatch, manualReview] = await Promise.all([
    prisma.brainDecision.count({ where: { status: "OPEN", severity: "CRITICAL" } }),
    prisma.brainDecision.count({ where: { status: "OPEN", severity: { in: ["CRITICAL", "HIGH"] } } }),
    prisma.brainDecision.aggregate({ where: { status: { in: ["OPEN", "APPROVED", "MANUAL_REVIEW"] } }, _sum: { impactAmount: true } }),
    prisma.brainDecision.count({ where: { status: "OPEN", category: "REORDER" } }),
    prisma.brainDecision.count({ where: { status: "OPEN", category: "CASH", severity: { in: ["CRITICAL", "HIGH"] } } }),
    prisma.brainDecision.count({ where: { status: "OPEN", category: "PRICING", severity: { in: ["CRITICAL", "HIGH"] } } }),
    prisma.brainDecision.count({ where: { status: "OPEN", category: "DISPATCH", severity: { in: ["CRITICAL", "HIGH", "MEDIUM"] } } }),
    prisma.brainDecision.count({ where: { status: "MANUAL_REVIEW" } }),
  ]);

  return {
    openCritical,
    highRisk,
    estimatedImpact: impact._sum.impactAmount ?? new Prisma.Decimal(0),
    reorderSuggested,
    cashRisks,
    lowMarginPrices: lowMargin,
    lateDispatches: lateDispatch,
    manualReview,
  };
}

export async function listBrainDecisions(filters: BrainDecisionFilters) {
  const since = filters.days ? new Date(Date.now() - filters.days * 24 * 60 * 60 * 1000) : undefined;
  const categoryIn = [
    filters.onlyPricing ? BrainDecisionCategory.PRICING : null,
    filters.onlyInventory ? BrainDecisionCategory.INVENTORY : null,
    filters.onlyCash ? BrainDecisionCategory.CASH : null,
    filters.onlyPurchasing ? BrainDecisionCategory.PURCHASING : null,
    filters.onlyTransfers ? BrainDecisionCategory.REORDER : null,
    filters.onlyConfiguration ? BrainDecisionCategory.SYSTEM : null,
  ].filter((value): value is NonNullable<typeof value> => Boolean(value));
  const search = filters.search?.trim();
  const searchCategory = search && Object.values(BrainDecisionCategory).includes(search.toUpperCase() as BrainDecisionCategory)
    ? search.toUpperCase() as BrainDecisionCategory
    : null;
  const where: Prisma.BrainDecisionWhereInput = {
    ...(filters.branchId ? { branchId: filters.branchId } : {}),
    ...(filters.productId ? { productId: filters.productId } : {}),
    ...(filters.targetUserId ? { targetUserId: filters.targetUserId } : {}),
    ...(filters.category ? { category: filters.category } : categoryIn.length ? { category: { in: categoryIn } } : {}),
    ...(filters.severity ? { severity: filters.severity } : {}),
    ...(filters.status ? { status: filters.status } : {}),
    ...(filters.onlyCritical ? { severity: { in: ["CRITICAL", "HIGH"] } } : {}),
    ...(filters.onlyActionable ? { status: { in: ["OPEN", "APPROVED", "MANUAL_REVIEW", "FAILED"] } } : {}),
    ...(filters.onlyWithImpact ? { impactAmount: { gt: 0 } } : {}),
    ...(filters.onlyPendingApproval ? { status: "OPEN" } : {}),
    ...(filters.actionType ? { proposedActionType: { contains: filters.actionType, mode: "insensitive" } } : {}),
    ...(filters.onlyPricingMisconfiguration ? { proposedActionType: "PRICING_SCOPE_MISCONFIGURATION" } : {}),
    ...(since ? { createdAt: { gte: since } } : {}),
    ...((filters.dateFrom || filters.dateTo) ? { createdAt: { gte: filters.dateFrom, lte: filters.dateTo } } : {}),
    ...(search ? {
      OR: [
        { title: { contains: search, mode: "insensitive" } },
        { description: { contains: search, mode: "insensitive" } },
        { recommendation: { contains: search, mode: "insensitive" } },
        ...(searchCategory ? [{ category: searchCategory }] : []),
        { proposedActionType: { contains: search, mode: "insensitive" } },
        { product: { is: { sku: { contains: search, mode: "insensitive" } } } },
        { product: { is: { name: { contains: search, mode: "insensitive" } } } },
        { branch: { is: { code: { contains: search, mode: "insensitive" } } } },
        { branch: { is: { name: { contains: search, mode: "insensitive" } } } },
        { targetUser: { is: { username: { contains: search, mode: "insensitive" } } } },
        { targetUser: { is: { fullName: { contains: search, mode: "insensitive" } } } },
        { evidenceJson: { string_contains: search, mode: "insensitive" } },
        { sourceJson: { string_contains: search, mode: "insensitive" } },
        { proposedActionJson: { string_contains: search, mode: "insensitive" } },
      ],
    } : {}),
  };
  const limit = filters.limit ?? 50;
  const orderBy: Prisma.BrainDecisionOrderByWithRelationInput[] =
    filters.sort === "impact"
      ? [{ impactAmount: "desc" }, { createdAt: "desc" }]
      : filters.sort === "newest" || filters.sort === "date"
        ? [{ createdAt: "desc" }]
        : filters.sort === "oldest"
          ? [{ createdAt: "asc" }]
          : filters.sort === "branch"
            ? [{ branch: { code: "asc" } }, { priorityScore: "desc" }]
            : filters.sort === "category"
              ? [{ category: "asc" }, { priorityScore: "desc" }]
              : filters.sort === "severity"
                ? [{ severity: "asc" }, { priorityScore: "desc" }]
        : [{ priorityScore: "desc" }, { severity: "asc" }, { createdAt: "desc" }];

  const [decisions, kpis, totalDecisions, criticalCount, highRiskCount, impact, byCategory] = await Promise.all([
    prisma.brainDecision.findMany({
      where,
      include: includeDecisionRelations(),
      orderBy,
      take: limit + 1,
      ...(filters.cursor ? { cursor: { id: filters.cursor }, skip: 1 } : {}),
    }),
    getBrainSummary(),
    prisma.brainDecision.count({ where }),
    prisma.brainDecision.count({ where: { ...where, severity: "CRITICAL" } }),
    prisma.brainDecision.count({ where: { ...where, severity: { in: ["CRITICAL", "HIGH"] } } }),
    prisma.brainDecision.aggregate({ where, _sum: { impactAmount: true } }),
    prisma.brainDecision.groupBy({ by: ["category"], where, _count: { category: true } }),
  ]);

  const hasMore = decisions.length > limit;
  const page = hasMore ? decisions.slice(0, limit) : decisions;
  const enriched = page.map(enrichDecision);
  const categoriesBreakdown = Object.fromEntries(byCategory.map((row) => [row.category, row._count.category]));
  const executive = buildExecutiveSummary({
    totalDecisions,
    criticalCount,
    highRiskCount,
    estimatedImpactAmount: numberValue(impact._sum.impactAmount),
    categoriesBreakdown,
    decisions: enriched,
  });
  return {
    decisions: enriched,
    nextCursor: hasMore ? page.at(-1)?.id ?? null : null,
    kpis,
    ...executive,
  };
}

export async function getBrainDecision(id: string) {
  return prisma.brainDecision.findUniqueOrThrow({
    where: { id },
    include: includeDecisionRelations(),
  });
}

async function writeActionLog(input: {
  decisionId: string;
  actorUserId?: string | null;
  action: string;
  note?: string;
  metadataJson?: Prisma.InputJsonValue;
  beforeStatus?: string;
  afterStatus?: string;
}) {
  await prisma.brainDecisionActionLog.create({
    data: {
      decisionId: input.decisionId,
      actorUserId: input.actorUserId ?? null,
      action: input.action,
      note: input.note,
      metadataJson: input.metadataJson ?? Prisma.JsonNull,
    },
  });

  await prisma.auditLog.create({
    data: {
      actorUserId: input.actorUserId ?? null,
      module: "brain",
      action: input.action,
      entityType: "BrainDecision",
      entityId: input.decisionId,
      metadataJson: {
        note: input.note,
        beforeStatus: input.beforeStatus,
        afterStatus: input.afterStatus,
        metadataJson: input.metadataJson,
      },
    },
  });
}

export async function persistBrainDecisions(
  drafts: BrainDecisionDraft[],
  actorUserId?: string,
  options: { force?: boolean; dryRun?: boolean; scannedCategories?: BrainScanResult["scannedCategories"] } = {},
): Promise<BrainScanResult> {
  let created = 0;
  let updated = 0;
  let reopened = 0;
  let skipped = 0;
  const errors: BrainScanResult["errors"] = [];
  const byCategory: BrainScanResult["byCategory"] = {};
  const now = new Date();

  for (const draft of drafts) {
    byCategory[draft.category] = (byCategory[draft.category] ?? 0) + 1;
    const fingerprint = makeDecisionFingerprint(draft.fingerprintParts);
    const idempotencyKey = makeIdempotencyKey(["decision", ...draft.fingerprintParts]);

    try {
      const existing = await prisma.brainDecision.findUnique({ where: { fingerprint } });
      if (options.dryRun) {
        if (existing) updated++;
        else created++;
        continue;
      }

      if (!existing) {
        const decision = await prisma.brainDecision.create({ data: draftData(draft, fingerprint, idempotencyKey) });
        await writeActionLog({
          decisionId: decision.id,
          actorUserId,
          action: "CREATED",
          afterStatus: decision.status,
          metadataJson: { category: decision.category, fingerprint },
        });
        created++;
        continue;
      }

      const mayReopen = options.force
        || (terminalStatuses.includes(existing.status)
          && existing.resolvedAt
          && now.getTime() - existing.resolvedAt.getTime() > REOPEN_AFTER_DAYS * 24 * 60 * 60 * 1000);

      if (terminalStatuses.includes(existing.status) && !mayReopen) {
        skipped++;
        continue;
      }

      if (existing.status === "SNOOZED" && existing.expiresAt && existing.expiresAt > now && !options.force) {
        await prisma.brainDecision.update({ where: { id: existing.id }, data: { lastDetectedAt: now } });
        skipped++;
        continue;
      }

      const nextStatus: BrainDecisionStatus = mayReopen || existing.status === "SNOOZED" || existing.status === "FAILED"
        ? "OPEN"
        : existing.status;

      await prisma.brainDecision.update({
        where: { id: existing.id },
        data: {
          ...updateData(draft),
          status: nextStatus,
          resolvedAt: nextStatus === "OPEN" ? null : existing.resolvedAt,
          resolvedBy: nextStatus === "OPEN" ? { disconnect: true } : undefined,
        },
      });
      await writeActionLog({
        decisionId: existing.id,
        actorUserId,
        action: mayReopen ? "REOPENED" : "UPDATED",
        beforeStatus: existing.status,
        afterStatus: nextStatus,
        metadataJson: { fingerprint },
      });
      if (mayReopen) reopened++;
      else updated++;
    } catch (error) {
      errors.push({ message: error instanceof Error ? error.message : String(error) });
    }
  }

  let expired = 0;
  if (!options.dryRun) {
    const expiredRows = await prisma.brainDecision.updateMany({
      where: {
        status: { in: activeStatuses },
        expiresAt: { lt: now },
      },
      data: { status: "EXPIRED", resolvedAt: now },
    });
    expired = expiredRows.count;
  }

  if (actorUserId && !options.dryRun) {
    await prisma.auditLog.create({
      data: {
        actorUserId,
        module: "brain",
        action: "SCANNED",
        entityType: "BrainDecision",
        entityId: "scan",
        metadataJson: { total: drafts.length, created, updated, reopened, expired, skipped, errors, byCategory },
      },
    });
  }

  return {
    total: drafts.length,
    created,
    updated,
    reopened,
    expired,
    skipped,
    errors,
    scannedCategories: options.scannedCategories ?? [],
    byCategory,
  };
}

export async function approveBrainDecision(id: string, actorUserId: string, note?: string) {
  const decision = await prisma.brainDecision.findUnique({ where: { id } });
  if (!decision) throw new Error("NOT_FOUND");
  if (!["OPEN", "SNOOZED", "FAILED"].includes(decision.status)) throw new Error("INVALID_INPUT: Solo se pueden aprobar decisiones abiertas, fallidas o pospuestas.");

  const updated = await prisma.brainDecision.update({
    where: { id },
    data: { status: "APPROVED", resolvedAt: null, resolvedBy: { disconnect: true } },
    include: includeDecisionRelations(),
  });
  await writeActionLog({ decisionId: id, actorUserId, action: "APPROVED", note, beforeStatus: decision.status, afterStatus: "APPROVED" });
  return updated;
}

export async function dismissBrainDecision(id: string, actorUserId: string, note?: string) {
  const decision = await prisma.brainDecision.findUnique({ where: { id } });
  if (!decision) throw new Error("NOT_FOUND");
  if (decision.status === "EXECUTED") throw new Error("INVALID_INPUT: No se puede descartar una decision ejecutada.");

  const updated = await prisma.brainDecision.update({
    where: { id },
    data: { status: "DISMISSED", resolvedAt: new Date(), resolvedBy: { connect: { id: actorUserId } } },
    include: includeDecisionRelations(),
  });
  await writeActionLog({ decisionId: id, actorUserId, action: "DISMISSED", note, beforeStatus: decision.status, afterStatus: "DISMISSED" });
  return updated;
}

export async function snoozeBrainDecision(id: string, actorUserId: string, input: { note?: string; until?: Date; days?: number }) {
  const decision = await prisma.brainDecision.findUnique({ where: { id } });
  if (!decision) throw new Error("NOT_FOUND");
  if (decision.status === "EXECUTED" || decision.status === "DISMISSED") throw new Error("INVALID_INPUT: No se puede posponer una decision cerrada.");

  const expiresAt = input.until ?? new Date(Date.now() + (input.days ?? 7) * 24 * 60 * 60 * 1000);
  const updated = await prisma.brainDecision.update({
    where: { id },
    data: { status: "SNOOZED", expiresAt, resolvedAt: new Date(), resolvedBy: { connect: { id: actorUserId } } },
    include: includeDecisionRelations(),
  });
  await writeActionLog({ decisionId: id, actorUserId, action: "SNOOZED", note: input.note, beforeStatus: decision.status, afterStatus: "SNOOZED", metadataJson: { expiresAt: expiresAt.toISOString() } });
  return updated;
}

export async function markBrainDecisionManualReview(id: string, actorUserId: string, note?: string) {
  const decision = await prisma.brainDecision.findUnique({ where: { id } });
  if (!decision) throw new Error("NOT_FOUND");
  if (decision.status === "EXECUTED" || decision.status === "DISMISSED") throw new Error("INVALID_INPUT: No se puede marcar una decision cerrada.");

  const updated = await prisma.brainDecision.update({
    where: { id },
    data: { status: "MANUAL_REVIEW", resolvedAt: null },
    include: includeDecisionRelations(),
  });
  await writeActionLog({ decisionId: id, actorUserId, action: "MANUAL_REVIEW_REQUIRED", note, beforeStatus: decision.status, afterStatus: "MANUAL_REVIEW" });
  return updated;
}

export async function reopenBrainDecision(id: string, actorUserId: string, note?: string) {
  const decision = await prisma.brainDecision.findUnique({ where: { id } });
  if (!decision) throw new Error("NOT_FOUND");

  const updated = await prisma.brainDecision.update({
    where: { id },
    data: { status: "OPEN", resolvedAt: null, resolvedBy: { disconnect: true } },
    include: includeDecisionRelations(),
  });
  await writeActionLog({ decisionId: id, actorUserId, action: "REOPENED", note, beforeStatus: decision.status, afterStatus: "OPEN" });
  return updated;
}

export async function executeBrainDecision(id: string, actorUserId: string, note?: string) {
  const decision = await prisma.brainDecision.findUnique({ where: { id } });
  if (!decision) throw new Error("NOT_FOUND");
  if (decision.status === "EXECUTED" || decision.status === "MANUAL_REVIEW") {
    return prisma.brainDecision.findUniqueOrThrow({ where: { id }, include: includeDecisionRelations() });
  }
  if (decision.status !== "APPROVED") throw new Error("INVALID_INPUT: Primero debe aprobarse la decision.");

  await prisma.brainDecision.update({ where: { id }, data: { status: "EXECUTING" } });
  await writeActionLog({ decisionId: id, actorUserId, action: "EXECUTION_STARTED", note, beforeStatus: decision.status, afterStatus: "EXECUTING" });

  try {
    const result = await executeDecisionAction({
      decisionId: decision.id,
      idempotencyKey: decision.idempotencyKey ?? makeIdempotencyKey(["decision", decision.fingerprint]),
      proposedActionType: decision.proposedActionType,
      proposedActionJson: decision.proposedActionJson,
      actorUserId,
    });
    const nextStatus: BrainDecisionStatus = result.executed ? "EXECUTED" : "MANUAL_REVIEW";
    const updated = await prisma.brainDecision.update({
      where: { id },
      data: {
        status: nextStatus,
        resolvedAt: result.executed ? new Date() : null,
        resolvedBy: result.executed ? { connect: { id: actorUserId } } : undefined,
        executedEntityType: result.executedEntityType ?? null,
        executedEntityId: result.executedEntityId ?? null,
        actionResultJson: result as Prisma.InputJsonValue,
      },
      include: includeDecisionRelations(),
    });
    await writeActionLog({
      decisionId: id,
      actorUserId,
      action: result.executed ? "EXECUTED" : "MANUAL_REVIEW_REQUIRED",
      note,
      beforeStatus: "EXECUTING",
      afterStatus: nextStatus,
      metadataJson: result as Prisma.InputJsonValue,
    });
    return updated;
  } catch (error) {
    await prisma.brainDecision.update({
      where: { id },
      data: {
        status: "FAILED",
        actionResultJson: { error: error instanceof Error ? error.message : String(error) },
      },
    });
    await writeActionLog({
      decisionId: id,
      actorUserId,
      action: "FAILED",
      note,
      beforeStatus: "EXECUTING",
      afterStatus: "FAILED",
      metadataJson: { message: error instanceof Error ? error.message : String(error) },
    });
    throw error;
  }
}
