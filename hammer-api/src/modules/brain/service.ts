import { BrainDecisionStatus, Prisma } from "@prisma/client";
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
  const where: Prisma.BrainDecisionWhereInput = {
    ...(filters.branchId ? { branchId: filters.branchId } : {}),
    ...(filters.productId ? { productId: filters.productId } : {}),
    ...(filters.targetUserId ? { targetUserId: filters.targetUserId } : {}),
    ...(filters.category ? { category: filters.category } : {}),
    ...(filters.severity ? { severity: filters.severity } : {}),
    ...(filters.status ? { status: filters.status } : {}),
    ...(filters.onlyCritical ? { severity: { in: ["CRITICAL", "HIGH"] } } : {}),
    ...(since ? { createdAt: { gte: since } } : {}),
    ...((filters.dateFrom || filters.dateTo) ? { createdAt: { gte: filters.dateFrom, lte: filters.dateTo } } : {}),
    ...(filters.search ? {
      OR: [
        { title: { contains: filters.search, mode: "insensitive" } },
        { description: { contains: filters.search, mode: "insensitive" } },
        { recommendation: { contains: filters.search, mode: "insensitive" } },
      ],
    } : {}),
  };
  const limit = filters.limit ?? 50;
  const orderBy: Prisma.BrainDecisionOrderByWithRelationInput[] =
    filters.sort === "impact"
      ? [{ impactAmount: "desc" }, { createdAt: "desc" }]
      : filters.sort === "date"
        ? [{ createdAt: "desc" }]
        : [{ priorityScore: "desc" }, { severity: "asc" }, { createdAt: "desc" }];

  const [decisions, kpis] = await Promise.all([
    prisma.brainDecision.findMany({
      where,
      include: includeDecisionRelations(),
      orderBy,
      take: limit + 1,
      ...(filters.cursor ? { cursor: { id: filters.cursor }, skip: 1 } : {}),
    }),
    getBrainSummary(),
  ]);

  const hasMore = decisions.length > limit;
  const page = hasMore ? decisions.slice(0, limit) : decisions;
  return {
    decisions: page,
    nextCursor: hasMore ? page.at(-1)?.id ?? null : null,
    kpis,
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
