import { BrainDecisionCategory, BrainDecisionStatus, Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { executeDecisionAction } from "@/modules/brain/actions/execute-decision";
import {
  makeDecisionFingerprint,
  makeIdempotencyKey,
  normalizeConfidence,
  priorityScoreFor,
  riskScoreFor,
  severityRank,
} from "@/modules/brain/scoring";
import { getDecisionCatalogEntry, formatEvidence, labelForActionLog } from "@/modules/brain/decision-catalog";
import { KNOWN_DETECTOR_KEYS } from "@/modules/brain/detector-registry";
import type { BrainDecisionDraft, BrainDecisionFilters, BrainScanResult, BrainDetectorLimits, BrainScanScope } from "@/modules/brain/types";

/**
 * prompt-brain-centro-decisiones.md Fase 1 — mismo patrón que
 * category-policy-service.ts (`db: Prisma.TransactionClient | typeof prisma
 * = prisma`): cada función que escribe acepta un cliente inyectable para
 * poder probarse con un fake-db en memoria, sin tocar la DB real. El
 * default sigue siendo el singleton global — ningún llamador existente
 * tiene que cambiar.
 */
type Db = Prisma.TransactionClient | typeof prisma;

// RESOLVED/EXECUTED/DISMISSED son "cerradas" — no se barren por inactividad
// (ver expireStaleBrainDecisions, que ahora es solo red de seguridad).
const activeStatuses: BrainDecisionStatus[] = ["OPEN", "APPROVED", "MANUAL_REVIEW", "SNOOZED", "FAILED"];
const STALE_EXECUTING_MINUTES = 10;
// prompt-brain-centro-decisiones.md Fase 1.4 — antes 7 días y era la ÚNICA
// forma de cerrar algo que dejó de verse; ahora el SCHEDULED_SCAN por hora
// cierra eso solo (autoResolveNotRedetected) en cuanto termina CADA scan, así
// que esto queda como red de seguridad para detectorKey null/desconocido —
// 30 días da margen de sobra para notar un detector roto antes de barrer.
const STALE_DETECTION_DAYS = 30;
// Fase 1.5 — un EXECUTED que se re-detecta no reabre inmediato: le da tiempo
// al efecto de la ejecución a reflejarse antes de que el Brain vuelva a quejarse.
const EXECUTED_REOPEN_GRACE_HOURS = 24;

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

/**
 * prompt-brain-centro-decisiones.md Fase 1.2 — reemplaza enteramente a
 * nextBestActionFor/buildExecutiveSummary/AUTO_EXECUTABLE_ACTION_TYPES
 * (borrados): toda etiqueta/área/CTA/enlace/evidencia sale del catálogo
 * único, nunca de matchear palabras en el título o la descripción.
 */
function enrichDecision(decision: DecisionWithRelations) {
  const catalogEntry = getDecisionCatalogEntry(decision.proposedActionType, decision.category);
  const href = catalogEntry.href({
    branchId: decision.branchId,
    productId: decision.productId,
    evidence: recordValue(decision.evidenceJson),
    action: recordValue(decision.proposedActionJson),
  });

  return {
    ...decision,
    typeLabel: catalogEntry.label,
    area: catalogEntry.area,
    resolution: catalogEntry.resolution,
    cta: catalogEntry.cta,
    href,
    evidence: formatEvidence(decision.evidenceJson),
    // Fase 2.5/3.5 — historial en español, no el código crudo (REOPENED, etc).
    history: decision.actionLogs.map((log) => ({
      id: log.id,
      action: log.action,
      actionLabel: labelForActionLog(log.action),
      note: log.note,
      actorName: log.actor?.fullName ?? log.actor?.username ?? null,
      createdAt: log.createdAt,
    })),
  };
}

function normalizeDraft(draft: BrainDecisionDraft) {
  const confidenceScore = draft.confidenceScore === null ? null : normalizeConfidence(draft.confidenceScore);
  const riskScore = draft.riskScore ?? riskScoreFor(draft.severity, confidenceScore ?? 75);
  const priorityScore = draft.priorityScore ?? priorityScoreFor({
    severity: draft.severity,
    riskScore,
    confidenceScore: confidenceScore ?? 75,
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
    confidenceScore: scores.confidenceScore === null ? null : decimal(scores.confidenceScore),
    impactAmount: decimal(draft.impactAmount),
    riskScore: decimal(scores.riskScore),
    priorityScore: decimal(scores.priorityScore),
    proposedActionType: draft.proposedActionType ?? null,
    proposedActionJson: json(draft.proposedActionJson),
    evidenceJson: json(draft.evidenceJson),
    sourceJson: json(draft.sourceJson),
    detectorKey: draft.detectorKey ?? null,
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
    confidenceScore: scores.confidenceScore === null ? null : decimal(scores.confidenceScore),
    impactAmount: decimal(draft.impactAmount),
    riskScore: decimal(scores.riskScore),
    priorityScore: decimal(scores.priorityScore),
    proposedActionType: draft.proposedActionType ?? null,
    proposedActionJson: json(draft.proposedActionJson),
    evidenceJson: json(draft.evidenceJson),
    sourceJson: json(draft.sourceJson),
    detectorKey: draft.detectorKey ?? null,
    lastDetectedAt: new Date(),
    expiresAt: draft.expiresAt ?? null,
  };
}

export async function getBrainSummary(baseWhere?: Prisma.BrainDecisionWhereInput) {
  const w = baseWhere ?? {};
  const [openCritical, highRisk, impact, reorderSuggested, cashRisks, lowMargin, lateDispatch, manualReview] = await Promise.all([
    prisma.brainDecision.count({ where: { ...w, status: "OPEN", severity: "CRITICAL" } }),
    prisma.brainDecision.count({ where: { ...w, status: "OPEN", severity: { in: ["CRITICAL", "HIGH"] } } }),
    prisma.brainDecision.aggregate({ where: { ...w, status: { in: ["OPEN", "APPROVED", "MANUAL_REVIEW"] } }, _sum: { impactAmount: true } }),
    prisma.brainDecision.count({ where: { ...w, status: "OPEN", category: "REORDER" } }),
    prisma.brainDecision.count({ where: { ...w, status: "OPEN", category: "CASH", severity: { in: ["CRITICAL", "HIGH"] } } }),
    prisma.brainDecision.count({ where: { ...w, status: "OPEN", category: "PRICING", severity: { in: ["CRITICAL", "HIGH"] } } }),
    prisma.brainDecision.count({ where: { ...w, status: "OPEN", category: "DISPATCH", severity: { in: ["CRITICAL", "HIGH", "MEDIUM"] } } }),
    prisma.brainDecision.count({ where: { ...w, status: "MANUAL_REVIEW" } }),
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
  const searchOR: Prisma.BrainDecisionWhereInput["OR"] = search ? [
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
    { evidenceJson: { string_contains: search } },
    { sourceJson: { string_contains: search } },
    { proposedActionJson: { string_contains: search } },
  ] : undefined;

  const whereBase: Prisma.BrainDecisionWhereInput = {
    ...(filters.branchId ? { branchId: filters.branchId } : {}),
    ...(filters.productId ? { productId: filters.productId } : {}),
    ...(filters.targetUserId ? { targetUserId: filters.targetUserId } : {}),
    ...(filters.category ? { category: filters.category } : categoryIn.length ? { category: { in: categoryIn } } : {}),
    ...(filters.severity ? { severity: filters.severity } : {}),
    ...(filters.onlyCritical ? { severity: { in: ["CRITICAL", "HIGH"] } } : {}),
    ...(filters.onlyActionable ? { status: { in: ["OPEN", "APPROVED", "MANUAL_REVIEW", "FAILED"] } } : {}),
    ...(filters.onlyWithImpact ? { impactAmount: { gt: 0 } } : {}),
    ...(filters.onlyPendingApproval ? { status: "OPEN" } : {}),
    ...(filters.actionType ? { proposedActionType: { contains: filters.actionType, mode: "insensitive" } } : {}),
    ...(filters.onlyPricingMisconfiguration ? { proposedActionType: "PRICING_SCOPE_MISCONFIGURATION" } : {}),
    ...(since ? { createdAt: { gte: since } } : {}),
    ...((filters.dateFrom || filters.dateTo) ? { createdAt: { gte: filters.dateFrom, lte: filters.dateTo } } : {}),
    ...(searchOR ? { OR: searchOR } : {}),
  };

  const where: Prisma.BrainDecisionWhereInput = {
    ...whereBase,
    ...(filters.status ? { status: filters.status } : {}),
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

  const kpiWhere: Prisma.BrainDecisionWhereInput = {
    ...(filters.branchId ? { branchId: filters.branchId } : {}),
  };

  const [decisions, kpis, totalDecisions, byStatus] = await Promise.all([
    prisma.brainDecision.findMany({
      where,
      include: includeDecisionRelations(),
      orderBy,
      take: limit + 1,
      ...(filters.cursor ? { cursor: { id: filters.cursor }, skip: 1 } : {}),
    }),
    getBrainSummary(kpiWhere),
    prisma.brainDecision.count({ where }),
    prisma.brainDecision.groupBy({ by: ["status"], where: whereBase, _count: { status: true } }),
  ]);

  const hasMore = decisions.length > limit;
  const page = hasMore ? decisions.slice(0, limit) : decisions;
  const enriched = page.map(enrichDecision);
  const statusCounts = Object.fromEntries(byStatus.map((row) => [row.status, row._count.status]));

  return {
    decisions: enriched,
    nextCursor: hasMore ? page.at(-1)?.id ?? null : null,
    kpis,
    statusCounts,
    totalDecisions,
  };
}

export async function getBrainDecision(id: string) {
  const decision = await prisma.brainDecision.findUniqueOrThrow({
    where: { id },
    include: includeDecisionRelations(),
  });
  return enrichDecision(decision);
}

export async function writeActionLog(input: {
  decisionId: string;
  actorUserId?: string | null;
  action: string;
  note?: string;
  metadataJson?: Prisma.InputJsonValue;
  beforeStatus?: string;
  afterStatus?: string;
}, db: Db = prisma) {
  await db.brainDecisionActionLog.create({
    data: {
      decisionId: input.decisionId,
      actorUserId: input.actorUserId ?? null,
      action: input.action,
      note: input.note,
      metadataJson: input.metadataJson ?? Prisma.JsonNull,
    },
  });

  await db.auditLog.create({
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

// Candado de BrainScanRun — si el que tiene el candado lleva más de esto
// corriendo, se considera colgado (un deploy interrumpido a mitad de scan,
// por ejemplo) y se libera solo en vez de bloquear el escaneo para siempre.
const STALE_SCAN_LOCK_MINUTES = 10;

/**
 * Fase 1.3 — "el motor". Única fila con runningLock:"brain" a la vez (índice
 * único; Postgres trata cada NULL como distinto, así que las filas YA
 * terminadas con runningLock:null conviven sin problema). Un P2002 acá
 * significa "ya hay un escaneo corriendo" — salvo que ese run lleve más de
 * STALE_SCAN_LOCK_MINUTES sin terminar, en cuyo caso se considera colgado,
 * se libera y se toma.
 */
export async function acquireScanRunLockTx(db: Db, input: { mode: string; trigger: string; branchId?: string; actorUserId?: string }): Promise<string> {
  try {
    const run = await db.brainScanRun.create({
      data: { mode: input.mode, trigger: input.trigger, branchId: input.branchId ?? null, actorUserId: input.actorUserId ?? null, runningLock: "brain" },
    });
    return run.id;
  } catch (error) {
    if (!(error instanceof Prisma.PrismaClientKnownRequestError) || error.code !== "P2002") throw error;

    const running = await db.brainScanRun.findUnique({ where: { runningLock: "brain" } });
    const staleThreshold = new Date(Date.now() - STALE_SCAN_LOCK_MINUTES * 60 * 1000);
    if (running && running.startedAt < staleThreshold) {
      await db.brainScanRun.update({ where: { id: running.id }, data: { status: "FAILED", finishedAt: new Date(), runningLock: null } });
      const run = await db.brainScanRun.create({
        data: { mode: input.mode, trigger: input.trigger, branchId: input.branchId ?? null, actorUserId: input.actorUserId ?? null, runningLock: "brain" },
      });
      return run.id;
    }
    throw new Error("BRAIN_SCAN_RUNNING");
  }
}

/**
 * Red de seguridad (Fase 1.4) — lo normal (detector vivo) ya se cierra solo
 * en cada SCHEDULED_SCAN vía autoResolveNotRedetected. Esto es solo para
 * decisiones de un detectorKey que ya no existe en el motor (o que nunca
 * tuvo detectorKey, datos de antes de esta migración) y que por lo tanto
 * ningún escaneo futuro puede volver a tocar ni cerrar.
 */
export async function expireStaleBrainDecisions(now: Date = new Date(), db: Db = prisma): Promise<number> {
  // Los snoozes vencidos se DESPIERTAN (vuelven a OPEN) — no se expiran. Si
  // la condición real ya no está, el próximo SCHEDULED_SCAN la cierra sola.
  await db.brainDecision.updateMany({
    where: { status: "SNOOZED", expiresAt: { lt: now } },
    data: { status: "OPEN", resolvedAt: null },
  });

  const staleDetectionThreshold = new Date(now.getTime() - STALE_DETECTION_DAYS * 24 * 60 * 60 * 1000);
  const targets = await db.brainDecision.findMany({
    where: {
      status: { in: [...activeStatuses, "SNOOZED"] },
      lastDetectedAt: { lt: staleDetectionThreshold },
      OR: [{ detectorKey: null }, { detectorKey: { notIn: [...KNOWN_DETECTOR_KEYS] } }],
    },
    select: { id: true, status: true },
  });
  if (targets.length === 0) return 0;

  await db.brainDecision.updateMany({
    where: { id: { in: targets.map((t) => t.id) } },
    data: { status: "EXPIRED", resolvedAt: now },
  });
  await db.brainDecisionActionLog.createMany({
    data: targets.map((t) => ({
      decisionId: t.id,
      action: "EXPIRED",
      metadataJson: {
        reason: "Detector inexistente o sin detectorKey, sin re-detección en el plazo de seguridad",
        staleDetectionDays: STALE_DETECTION_DAYS,
        beforeStatus: t.status,
        afterStatus: "EXPIRED",
      },
    })),
  }).catch(() => {
    // Bitácora es no-crítica: no fallar la expiración por un error de log.
  });
  return targets.length;
}

/**
 * Fase 1.4 — pura, para que "qué detectores disparan el cierre automático"
 * se pueda probar sin tener que correr un scan real. Solo SCHEDULED_SCAN
 * cierra algo (QUICK/ENTITY/DEEP/REPAIR ven un pedazo, no alcanza para
 * decidir que algo "ya no está"); un detector con error o que llegó al
 * tope (capped) tampoco — no se puede confiar en que vio todo.
 */
export function shouldAutoCloseAfterScan(mode: string, summary: { ok: boolean; capped: boolean }): boolean {
  return mode === "SCHEDULED_SCAN" && summary.ok && !summary.capped;
}

/**
 * Fase 1.4 — llamado desde engine.ts al final de un SCHEDULED_SCAN, una vez
 * por cada detector con ok && !capped. Cierra lo que ESE detector ya no
 * re-detectó en ESTA corrida (lastDetectedAt sigue siendo de ANTES de que
 * el scan empezara). Nunca toca SNOOZED (se respeta hasta su fecha).
 */
export async function autoResolveNotRedetected(input: { detectorKey: string; branchId?: string; scanStartedAt: Date }, db: Db = prisma): Promise<number> {
  const activeNonSnoozed: BrainDecisionStatus[] = ["OPEN", "APPROVED", "MANUAL_REVIEW", "FAILED"];
  const where: Prisma.BrainDecisionWhereInput = {
    detectorKey: input.detectorKey,
    status: { in: activeNonSnoozed },
    lastDetectedAt: { lt: input.scanStartedAt },
    ...(input.branchId ? { branchId: input.branchId } : {}),
  };
  const targets = await db.brainDecision.findMany({ where, select: { id: true } });
  if (targets.length === 0) return 0;

  const result = await db.brainDecision.updateMany({
    where: { id: { in: targets.map((t) => t.id) }, status: { in: activeNonSnoozed } },
    data: { status: "RESOLVED", resolvedAt: new Date(), resolvedByUserId: null, resolutionSource: "AUTO", resolutionNote: "La condición ya no se detecta" },
  });
  await db.brainDecisionActionLog.createMany({
    data: targets.map((t) => ({ decisionId: t.id, action: "RESOLVED", metadataJson: { reason: "AUTO", detectorKey: input.detectorKey } })),
  }).catch(() => {});
  return result.count;
}

/**
 * Fase 1.5 — qué hacer cuando un fingerprint ya existente se vuelve a
 * detectar, según su estado actual. Pura (sin DB) a propósito — es la
 * pieza que el doc pide probar explícitamente (RESOLVED siempre reabre,
 * DISMISSED solo si sube la severidad, EXECUTED solo pasadas 24h), y así
 * se prueba sola sin tener que montar un fake de persistBrainDecisions
 * completo.
 */
export function reopenDecisionOnRedetect(
  existing: Pick<DecisionWithRelations, "status" | "resolvedAt" | "dismissedSeverity">,
  newSeverity: BrainDecisionDraft["severity"],
  now: Date,
): { skip: boolean; reopen: boolean } {
  switch (existing.status) {
    case "RESOLVED":
      return { skip: false, reopen: true };
    case "EXECUTED": {
      const elapsedMs = existing.resolvedAt ? now.getTime() - existing.resolvedAt.getTime() : Infinity;
      const pastGrace = elapsedMs > EXECUTED_REOPEN_GRACE_HOURS * 60 * 60 * 1000;
      return { skip: !pastGrace, reopen: pastGrace };
    }
    case "DISMISSED": {
      const severityIncreased = existing.dismissedSeverity ? severityRank(newSeverity) > severityRank(existing.dismissedSeverity) : true;
      return { skip: !severityIncreased, reopen: severityIncreased };
    }
    case "SNOOZED":
    case "FAILED":
    case "EXPIRED":
      return { skip: false, reopen: true };
    default:
      return { skip: false, reopen: false };
  }
}

export async function persistBrainDecisions(
  drafts: BrainDecisionDraft[],
  actorUserId?: string,
  options: {
    force?: boolean;
    dryRun?: boolean;
    scannedCategories?: BrainScanResult["scannedCategories"];
    scope?: BrainScanScope;
    limits?: BrainDetectorLimits;
  } = {},
  db: Db = prisma,
): Promise<BrainScanResult> {
  let created = 0;
  let updated = 0;
  let reopened = 0;
  let skipped = 0;
  const errors: BrainScanResult["errors"] = [];
  const byCategory: BrainScanResult["byCategory"] = {};
  const now = new Date();

  const fingerprintByDraft = new Map<BrainDecisionDraft, string>();
  const fingerprints: string[] = [];
  for (const draft of drafts) {
    const fingerprint = makeDecisionFingerprint(draft.fingerprintParts);
    fingerprintByDraft.set(draft, fingerprint);
    fingerprints.push(fingerprint);
  }
  // D.1 — UN findMany en vez de un findUnique por draft (N+1): con cientos
  // de hallazgos por scan esto era la consulta más repetida de todo Brain.
  const existingDecisions = fingerprints.length > 0
    ? await db.brainDecision.findMany({ where: { fingerprint: { in: fingerprints } } })
    : [];
  const existingByFingerprint = new Map(existingDecisions.map((d) => [d.fingerprint, d]));

  for (const draft of drafts) {
    byCategory[draft.category] = (byCategory[draft.category] ?? 0) + 1;
    const fingerprint = fingerprintByDraft.get(draft) as string;
    const idempotencyKey = makeIdempotencyKey(["decision", ...draft.fingerprintParts]);

    try {
      const existing = existingByFingerprint.get(fingerprint);
      if (options.dryRun) {
        if (existing) updated++;
        else created++;
        continue;
      }

      if (!existing) {
        const decision = await db.brainDecision.create({ data: draftData(draft, fingerprint, idempotencyKey) });
        await writeActionLog({
          decisionId: decision.id,
          actorUserId,
          action: "CREATED",
          afterStatus: decision.status,
          metadataJson: { category: decision.category, fingerprint },
        }, db);
        created++;
        continue;
      }

      if (existing.status === "SNOOZED" && existing.expiresAt && existing.expiresAt > now && !options.force) {
        await db.brainDecision.update({ where: { id: existing.id }, data: { lastDetectedAt: now } });
        skipped++;
        continue;
      }

      const redetect = options.force ? { skip: false, reopen: true } : reopenDecisionOnRedetect(existing, draft.severity, now);
      if (redetect.skip) {
        // p.ej. EXECUTED todavía dentro de la ventana de gracia de 24h.
        await db.brainDecision.update({ where: { id: existing.id }, data: { lastDetectedAt: now } });
        skipped++;
        continue;
      }

      const nextStatus: BrainDecisionStatus = redetect.reopen ? "OPEN" : existing.status;
      const isReopened = redetect.reopen && existing.status !== "OPEN";
      const reopenFields: Prisma.BrainDecisionUpdateInput = isReopened
        ? { resolvedAt: null, resolvedBy: { disconnect: true }, resolutionSource: null, resolutionNote: null, dismissedSeverity: null }
        : {};

      await db.brainDecision.update({
        where: { id: existing.id },
        data: { ...updateData(draft), status: nextStatus, ...reopenFields },
      });

      const severityUnchanged = existing.severity === draft.severity;
      if (!isReopened && severityUnchanged) {
        // D.2 — re-detectada SIN cambios relevantes: nada de bitácora ni
        // auditoría. Antes cada scan escribía un "UPDATED" por cada
        // decisión re-detectada, sin importar si algo había cambiado.
        updated++;
        continue;
      }

      await writeActionLog({
        decisionId: existing.id,
        actorUserId,
        action: isReopened ? "REOPENED" : "UPDATED",
        beforeStatus: existing.status,
        afterStatus: nextStatus,
        metadataJson: { fingerprint, severityBefore: existing.severity, severityAfter: draft.severity },
      }, db);
      if (isReopened) reopened++;
      else updated++;
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") {
        skipped++;
      } else {
        errors.push({ message: error instanceof Error ? error.message : String(error) });
      }
    }
  }

  if (!options.dryRun) {
    const staleThreshold = new Date(now.getTime() - STALE_EXECUTING_MINUTES * 60 * 1000);
    await db.brainDecision.updateMany({
      where: { status: "EXECUTING", updatedAt: { lt: staleThreshold } },
      data: { status: "FAILED", actionResultJson: { error: "STALE_EXECUTING: proceso interrumpido" } },
    });
  }

  let expired = 0;
  if (!options.dryRun) {
    expired = await expireStaleBrainDecisions(now, db);
  }

  if (actorUserId && !options.dryRun) {
    await db.auditLog.create({
      data: {
        actorUserId,
        module: "brain",
        action: "SCANNED",
        entityType: "BrainDecision",
        entityId: "scan",
        metadataJson: { total: drafts.length, created, updated, reopened, expired, skipped, errors, byCategory, scope: options.scope, limits: options.limits },
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
    scope: options.scope,
    limits: options.limits,
  };
}

/* ── Acciones humanas — todas atómicas (updateMany condicionado al estado), Fase 1.6 ──
 * Cada una es un núcleo "Tx" (recibe `db`, nunca llama a getBrainDecision)
 * más un envoltorio delgado sin parámetro `db` (usa el prisma global y
 * devuelve la decisión ya enriquecida) — mismo patrón de xTx que el resto
 * de la sesión, para poder probar el núcleo con un fake-db en memoria.
 */

export async function resolveBrainDecisionTx(db: Db, id: string, actorUserId: string, note?: string): Promise<void> {
  const result = await db.brainDecision.updateMany({
    where: { id, status: { in: ["OPEN", "APPROVED", "MANUAL_REVIEW", "FAILED", "SNOOZED"] } },
    data: { status: "RESOLVED", resolvedAt: new Date(), resolvedByUserId: actorUserId, resolutionSource: "USER", resolutionNote: note ?? null },
  });
  if (result.count === 0) throw new Error("ALREADY_PROCESSED");
  await writeActionLog({ decisionId: id, actorUserId, action: "RESOLVED", note, afterStatus: "RESOLVED" }, db);
}

export async function resolveBrainDecision(id: string, actorUserId: string, note?: string) {
  await resolveBrainDecisionTx(prisma, id, actorUserId, note);
  return getBrainDecision(id);
}

export async function dismissBrainDecisionTx(db: Db, id: string, actorUserId: string, note: string): Promise<void> {
  const trimmed = note?.trim() ?? "";
  if (trimmed.length < 3) throw new Error("VALIDATION_ERROR: El motivo es obligatorio para descartar (mínimo 3 caracteres).");

  const current = await db.brainDecision.findUnique({ where: { id }, select: { severity: true } });
  if (!current) throw new Error("NOT_FOUND");

  const result = await db.brainDecision.updateMany({
    where: { id, status: { in: ["OPEN", "APPROVED", "MANUAL_REVIEW", "FAILED", "SNOOZED"] } },
    data: { status: "DISMISSED", resolvedAt: new Date(), resolvedByUserId: actorUserId, dismissedSeverity: current.severity, resolutionNote: trimmed },
  });
  if (result.count === 0) throw new Error("ALREADY_PROCESSED");
  await writeActionLog({ decisionId: id, actorUserId, action: "DISMISSED", note: trimmed, afterStatus: "DISMISSED" }, db);
}

export async function dismissBrainDecision(id: string, actorUserId: string, note: string) {
  await dismissBrainDecisionTx(prisma, id, actorUserId, note);
  return getBrainDecision(id);
}

export async function snoozeBrainDecisionTx(db: Db, id: string, actorUserId: string, input: { note?: string; until?: Date; days?: number }): Promise<void> {
  const expiresAt = input.until ?? new Date(Date.now() + (input.days ?? 7) * 24 * 60 * 60 * 1000);
  const result = await db.brainDecision.updateMany({
    where: { id, status: { in: ["OPEN", "APPROVED", "MANUAL_REVIEW", "FAILED"] } },
    data: { status: "SNOOZED", expiresAt },
  });
  if (result.count === 0) throw new Error("ALREADY_PROCESSED");
  await writeActionLog({ decisionId: id, actorUserId, action: "SNOOZED", note: input.note, afterStatus: "SNOOZED", metadataJson: { expiresAt: expiresAt.toISOString() } }, db);
}

export async function snoozeBrainDecision(id: string, actorUserId: string, input: { note?: string; until?: Date; days?: number }) {
  await snoozeBrainDecisionTx(prisma, id, actorUserId, input);
  return getBrainDecision(id);
}

export async function reopenBrainDecisionTx(db: Db, id: string, actorUserId: string, note?: string): Promise<void> {
  const result = await db.brainDecision.updateMany({
    where: { id, status: { in: ["RESOLVED", "DISMISSED", "EXPIRED", "SNOOZED"] } },
    data: { status: "OPEN", resolvedAt: null, resolvedByUserId: null, resolutionSource: null, resolutionNote: null, dismissedSeverity: null, expiresAt: null },
  });
  if (result.count === 0) throw new Error("ALREADY_PROCESSED");
  await writeActionLog({ decisionId: id, actorUserId, action: "REOPENED", note, afterStatus: "OPEN" }, db);
}

export async function reopenBrainDecision(id: string, actorUserId: string, note?: string) {
  await reopenBrainDecisionTx(prisma, id, actorUserId, note);
  return getBrainDecision(id);
}

type ExecuteFn = typeof executeDecisionAction;

/** Reemplaza al par aprobar→ejecutar: un solo paso, solo para tipos EXECUTABLE del catálogo. `executeFn` inyectable para poder probar el flujo completo sin que execute-decision.ts toque módulos reales (compras/transferencias/caja). */
export async function runBrainDecisionTx(db: Db, id: string, actorUserId: string, note?: string, executeFn: ExecuteFn = executeDecisionAction): Promise<void> {
  const decision = await db.brainDecision.findUnique({ where: { id } });
  if (!decision) throw new Error("NOT_FOUND");

  const catalogEntry = getDecisionCatalogEntry(decision.proposedActionType, decision.category);
  if (catalogEntry.resolution !== "EXECUTABLE") {
    throw new Error("VALIDATION_ERROR: Este tipo de decisión no se ejecuta automáticamente.");
  }

  const claimed = await db.brainDecision.updateMany({
    where: { id, status: { in: ["OPEN", "APPROVED", "FAILED"] } },
    data: { status: "EXECUTING" },
  });
  if (claimed.count === 0) throw new Error("ALREADY_PROCESSED");

  await writeActionLog({ decisionId: id, actorUserId, action: "EXECUTION_STARTED", note, beforeStatus: decision.status, afterStatus: "EXECUTING" }, db);

  try {
    const result = await executeFn({
      decisionId: decision.id,
      idempotencyKey: decision.idempotencyKey ?? makeIdempotencyKey(["decision", decision.fingerprint]),
      proposedActionType: decision.proposedActionType,
      proposedActionJson: decision.proposedActionJson,
      actorUserId,
    });

    if (!result.executed) {
      // Vuelve a OPEN (no MANUAL_REVIEW): ya pasó el catálogo como
      // EXECUTABLE, así que si no se pudo ejecutar fue por datos puntuales
      // faltantes, no porque el tipo no sea ejecutable.
      await db.brainDecision.update({ where: { id }, data: { status: "OPEN", actionResultJson: result as Prisma.InputJsonValue } });
      await writeActionLog({ decisionId: id, actorUserId, action: "EXECUTION_INCOMPLETE", note, beforeStatus: "EXECUTING", afterStatus: "OPEN", metadataJson: result as Prisma.InputJsonValue }, db);
      return;
    }

    await db.brainDecision.update({
      where: { id },
      data: {
        status: "EXECUTED",
        resolvedAt: new Date(),
        resolvedByUserId: actorUserId,
        resolutionSource: "USER",
        executedEntityType: result.executedEntityType ?? null,
        executedEntityId: result.executedEntityId ?? null,
        actionResultJson: result as Prisma.InputJsonValue,
      },
    });
    await writeActionLog({
      decisionId: id,
      actorUserId,
      action: "EXECUTED",
      note,
      beforeStatus: "EXECUTING",
      afterStatus: "EXECUTED",
      metadataJson: result as Prisma.InputJsonValue,
    }, db);
    // Fase 1.7 — NO se crea un BrainDecisionOutcome acá (antes: successScore:50
    // fijo). evaluateExecutedDecisions (outcomes.ts) es quien mide impacto
    // real más adelante; crearlo acá dejaba su propio filtro sin nada que
    // evaluar jamás.
  } catch (error) {
    await db.brainDecision.update({
      where: { id },
      data: { status: "FAILED", actionResultJson: { error: error instanceof Error ? error.message : String(error) } },
    });
    await writeActionLog({
      decisionId: id,
      actorUserId,
      action: "FAILED",
      note,
      beforeStatus: "EXECUTING",
      afterStatus: "FAILED",
      metadataJson: { message: error instanceof Error ? error.message : String(error) },
    }, db);
    throw error;
  }
}

export async function runBrainDecision(id: string, actorUserId: string, note?: string) {
  await runBrainDecisionTx(prisma, id, actorUserId, note);
  return getBrainDecision(id);
}

export type BulkBrainAction = "resolve" | "dismiss" | "snooze";

/** Fase 1.6 — POST /bulk: cada id con su propio updateMany condicionado; uno ya procesado se salta, no rompe el lote. */
export async function bulkUpdateBrainDecisions(
  ids: string[],
  action: BulkBrainAction,
  actorUserId: string,
  input: { note?: string; days?: number } = {},
): Promise<{ done: number; skipped: number }> {
  if (ids.length === 0) return { done: 0, skipped: 0 };
  if (ids.length > 200) throw new Error("VALIDATION_ERROR: Máximo 200 decisiones por lote.");

  let done = 0;
  let skipped = 0;
  for (const id of ids) {
    try {
      if (action === "resolve") await resolveBrainDecision(id, actorUserId, input.note);
      else if (action === "dismiss") await dismissBrainDecision(id, actorUserId, input.note ?? "");
      else await snoozeBrainDecision(id, actorUserId, { note: input.note, days: input.days });
      done++;
    } catch (error) {
      if (error instanceof Error && (error.message === "ALREADY_PROCESSED" || error.message === "NOT_FOUND")) {
        skipped++;
        continue;
      }
      throw error;
    }
  }
  return { done, skipped };
}

/* ── Legacy — approve/manual-review/execute: se mantienen por compatibilidad (Fase 1.6), la pantalla nueva ya no los usa (usa resolve/dismiss/snooze/reopen/run). ── */

export async function approveBrainDecision(id: string, actorUserId: string, note?: string) {
  const decision = await prisma.brainDecision.findUnique({ where: { id } });
  if (!decision) throw new Error("NOT_FOUND");
  if (!["OPEN", "SNOOZED", "FAILED", "MANUAL_REVIEW"].includes(decision.status)) throw new Error("INVALID_INPUT: Solo se pueden aprobar decisiones abiertas, fallidas, pospuestas o en revision manual.");

  const updated = await prisma.brainDecision.update({
    where: { id },
    data: { status: "APPROVED", resolvedAt: null, resolvedBy: { disconnect: true } },
    include: includeDecisionRelations(),
  });
  await writeActionLog({ decisionId: id, actorUserId, action: "APPROVED", note, beforeStatus: decision.status, afterStatus: "APPROVED" });
  return enrichDecision(updated);
}

export async function markBrainDecisionManualReview(id: string, actorUserId: string, note?: string) {
  const decision = await prisma.brainDecision.findUnique({ where: { id } });
  if (!decision) throw new Error("NOT_FOUND");
  if (decision.status === "EXECUTED" || decision.status === "DISMISSED" || decision.status === "RESOLVED") throw new Error("INVALID_INPUT: No se puede marcar una decision cerrada.");

  const updated = await prisma.brainDecision.update({
    where: { id },
    data: { status: "MANUAL_REVIEW", resolvedAt: null },
    include: includeDecisionRelations(),
  });
  await writeActionLog({ decisionId: id, actorUserId, action: "MANUAL_REVIEW_REQUIRED", note, beforeStatus: decision.status, afterStatus: "MANUAL_REVIEW" });
  return enrichDecision(updated);
}

export async function executeBrainDecision(id: string, actorUserId: string, note?: string) {
  const claimed = await prisma.brainDecision.updateMany({
    where: { id, status: "APPROVED" },
    data: { status: "EXECUTING" },
  });

  if (claimed.count === 0) {
    const decision = await prisma.brainDecision.findUnique({ where: { id } });
    if (!decision) throw new Error("NOT_FOUND");
    if (decision.status === "EXECUTED" || decision.status === "MANUAL_REVIEW") {
      return enrichDecision(await prisma.brainDecision.findUniqueOrThrow({ where: { id }, include: includeDecisionRelations() }));
    }
    if (decision.status === "EXECUTING") throw new Error("CONFLICT: Esta decision ya esta siendo ejecutada por otro proceso.");
    throw new Error("INVALID_INPUT: Primero debe aprobarse la decision.");
  }

  const decision = await prisma.brainDecision.findUniqueOrThrow({ where: { id } });
  await writeActionLog({ decisionId: id, actorUserId, action: "EXECUTION_STARTED", note, beforeStatus: "APPROVED", afterStatus: "EXECUTING" });

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
        resolutionSource: result.executed ? "USER" : undefined,
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

    return enrichDecision(updated);
  } catch (error) {
    await prisma.brainDecision.update({
      where: { id },
      data: { status: "FAILED", actionResultJson: { error: error instanceof Error ? error.message : String(error) } },
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
