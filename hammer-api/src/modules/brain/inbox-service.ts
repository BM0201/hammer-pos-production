import { Prisma, type BrainDecisionSeverity, type BrainDecisionStatus } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { severityRank } from "@/modules/brain/scoring";
import { getDecisionCatalogEntry, getActionTypesForArea, formatEvidence, type DecisionArea } from "@/modules/brain/decision-catalog";

/**
 * prompt-brain-centro-decisiones.md Fase 2 — la bandeja agrupada. "área" no
 * es una columna de la base (es del catálogo, por tipo) — se filtra
 * traduciendo el área pedida a la lista de proposedActionType que caen ahí
 * (getActionTypesForArea) ANTES de consultar, nunca post-filtrando en JS
 * sobre todas las filas.
 *
 * Por qué NO `_max: { severity: true }` en el groupBy: Postgres ordena un
 * enum por el orden de declaración en el CREATE TYPE, no alfabético —
 * BrainDecisionSeverity se declaró CRITICAL primero, así que MAX() de
 * Postgres devolvería INFO (el último declarado), no CRITICAL. Agrupar
 * también por `severity` (una fila por tipo×severidad) y decidir "la más
 * grave" en JS con severityRank evita ese error sin tener que reordenar el
 * enum (que rompería el `orderBy: severity` que ya usa listBrainDecisions).
 */

type Db = Prisma.TransactionClient | typeof prisma;

export type InboxStatusView = "PENDING" | "SNOOZED" | "RESOLVED" | "DISMISSED";

const STATUS_VIEWS: Record<InboxStatusView, BrainDecisionStatus[]> = {
  PENDING: ["OPEN", "APPROVED", "MANUAL_REVIEW", "FAILED"],
  SNOOZED: ["SNOOZED"],
  RESOLVED: ["RESOLVED", "EXECUTED"],
  DISMISSED: ["DISMISSED"],
};

const RESOLVED_WINDOW_DAYS = 30;

export type InboxFilters = {
  branchId?: string;
  area?: DecisionArea;
  status?: InboxStatusView;
  q?: string;
  minSeverity?: BrainDecisionSeverity;
};

function severitiesAtOrAbove(min: BrainDecisionSeverity): BrainDecisionSeverity[] {
  const all: BrainDecisionSeverity[] = ["CRITICAL", "HIGH", "MEDIUM", "LOW", "INFO"];
  const minRank = severityRank(min);
  return all.filter((s) => severityRank(s) >= minRank);
}

function buildWhere(filters: InboxFilters): Prisma.BrainDecisionWhereInput {
  const view = filters.status ?? "PENDING";
  const where: Prisma.BrainDecisionWhereInput = {
    status: { in: STATUS_VIEWS[view] },
    ...(filters.branchId ? { branchId: filters.branchId } : {}),
    ...(filters.minSeverity ? { severity: { in: severitiesAtOrAbove(filters.minSeverity) } } : {}),
    ...(filters.area ? { proposedActionType: { in: getActionTypesForArea(filters.area) } } : {}),
    ...(view === "RESOLVED" ? { resolvedAt: { gte: new Date(Date.now() - RESOLVED_WINDOW_DAYS * 24 * 60 * 60 * 1000) } } : {}),
  };
  const q = filters.q?.trim();
  if (q) {
    where.OR = [
      { title: { contains: q, mode: "insensitive" } },
      { description: { contains: q, mode: "insensitive" } },
      { proposedActionType: { contains: q, mode: "insensitive" } },
      { product: { is: { sku: { contains: q, mode: "insensitive" } } } },
      { product: { is: { name: { contains: q, mode: "insensitive" } } } },
      { branch: { is: { code: { contains: q, mode: "insensitive" } } } },
      { branch: { is: { name: { contains: q, mode: "insensitive" } } } },
    ];
  }
  return where;
}

export type InboxGroup = {
  type: string;
  typeLabel: string;
  area: DecisionArea;
  cta: string;
  groupHref: string | null;
  severity: BrainDecisionSeverity;
  count: number;
  branches: Array<{ code: string; name: string }>;
  impactAmount: number;
  oldestDetectedAt: Date;
  hasReappeared: boolean;
};

export async function getBrainInbox(filters: InboxFilters, db: Db = prisma): Promise<{ groups: InboxGroup[]; areas: Array<{ area: DecisionArea; count: number; criticalCount: number }> }> {
  const where = buildWhere(filters);

  const [bySeverity, branchRows, reappearedRows] = await Promise.all([
    db.brainDecision.groupBy({
      by: ["proposedActionType", "severity"],
      where,
      _count: { _all: true },
      _sum: { impactAmount: true },
      _min: { createdAt: true },
    }),
    db.brainDecision.findMany({
      where,
      distinct: ["proposedActionType", "branchId"],
      select: { proposedActionType: true, branch: { select: { code: true, name: true } } },
    }),
    db.brainDecisionActionLog.findMany({
      where: { action: "REOPENED", decision: where },
      distinct: ["decisionId"],
      select: { decision: { select: { proposedActionType: true } } },
    }),
  ]);

  const reappearedTypes = new Set(reappearedRows.map((r) => r.decision.proposedActionType).filter((t): t is string => t != null));
  const branchesByType = new Map<string, Map<string, { code: string; name: string }>>();
  for (const row of branchRows) {
    const type = row.proposedActionType ?? "__UNKNOWN__";
    if (!row.branch) continue;
    const map = branchesByType.get(type) ?? new Map();
    map.set(row.branch.code, row.branch);
    branchesByType.set(type, map);
  }

  type Acc = { type: string; count: number; impactAmount: number; oldestDetectedAt: Date; bestSeverity: BrainDecisionSeverity; category: string | null };
  const byType = new Map<string, Acc>();
  for (const row of bySeverity) {
    const type = row.proposedActionType ?? "__UNKNOWN__";
    const existing = byType.get(type);
    const createdAt = row._min.createdAt ?? new Date();
    const impact = row._sum.impactAmount != null ? Number(row._sum.impactAmount) : 0;
    if (!existing) {
      byType.set(type, { type, count: row._count._all, impactAmount: impact, oldestDetectedAt: createdAt, bestSeverity: row.severity, category: null });
    } else {
      existing.count += row._count._all;
      existing.impactAmount += impact;
      if (createdAt < existing.oldestDetectedAt) existing.oldestDetectedAt = createdAt;
      if (severityRank(row.severity) > severityRank(existing.bestSeverity)) existing.bestSeverity = row.severity;
    }
  }

  const groups: InboxGroup[] = [...byType.values()]
    .filter((acc) => acc.type !== "__UNKNOWN__")
    .map((acc) => {
      const catalogEntry = getDecisionCatalogEntry(acc.type, acc.category ?? "SYSTEM");
      const branches = [...(branchesByType.get(acc.type)?.values() ?? [])];
      return {
        type: acc.type,
        typeLabel: catalogEntry.label,
        area: catalogEntry.area,
        cta: catalogEntry.cta,
        groupHref: catalogEntry.href({ branchId: filters.branchId ?? branches[0]?.code ?? null, productId: null, evidence: {}, action: {} }),
        severity: acc.bestSeverity,
        count: acc.count,
        branches,
        impactAmount: acc.impactAmount,
        oldestDetectedAt: acc.oldestDetectedAt,
        hasReappeared: reappearedTypes.has(acc.type),
      };
    })
    .sort((a, b) => severityRank(b.severity) - severityRank(a.severity) || b.impactAmount - a.impactAmount || b.count - a.count);

  const areaTotals = new Map<DecisionArea, { count: number; criticalCount: number }>();
  for (const group of groups) {
    const current = areaTotals.get(group.area) ?? { count: 0, criticalCount: 0 };
    current.count += group.count;
    if (group.severity === "CRITICAL") current.criticalCount += group.count;
    areaTotals.set(group.area, current);
  }

  return {
    groups,
    areas: [...areaTotals.entries()].map(([area, totals]) => ({ area, ...totals })),
  };
}

export type InboxItem = {
  id: string;
  entityLabel: string;
  branchLabel: string | null;
  description: string;
  href: string | null;
  detectedAgo: Date;
  status: BrainDecisionStatus;
  resolution: ReturnType<typeof getDecisionCatalogEntry>["resolution"];
  hasReappeared: boolean;
};

function entityLabelFor(decision: { product: { sku: string; name: string } | null; evidenceJson: unknown }): string {
  if (decision.product) return `${decision.product.sku} · ${decision.product.name}`;
  const evidence = formatEvidence(decision.evidenceJson);
  const cashSessionId = evidence.find((e) => e.key === "cashSessionId");
  if (cashSessionId) return `Caja ${String(cashSessionId.value)}`;
  const saleOrderId = evidence.find((e) => e.key === "saleOrderId" || e.key === "orderNumber");
  if (saleOrderId) return `Orden ${String(saleOrderId.value)}`;
  return "Sin entidad puntual";
}

export async function getBrainInboxItems(type: string, filters: InboxFilters, pagination: { cursor?: string; limit: number }) {
  const where: Prisma.BrainDecisionWhereInput = { ...buildWhere(filters), proposedActionType: type };

  const [reappearedIds, decisions] = await Promise.all([
    prisma.brainDecisionActionLog.findMany({ where: { action: "REOPENED", decision: where }, distinct: ["decisionId"], select: { decisionId: true } }),
    prisma.brainDecision.findMany({
      where,
      select: {
        id: true,
        status: true,
        category: true,
        proposedActionType: true,
        branchId: true,
        productId: true,
        evidenceJson: true,
        proposedActionJson: true,
        createdAt: true,
        branch: { select: { code: true, name: true } },
        product: { select: { sku: true, name: true } },
      },
      orderBy: { createdAt: "desc" },
      take: pagination.limit + 1,
      ...(pagination.cursor ? { cursor: { id: pagination.cursor }, skip: 1 } : {}),
    }),
  ]);

  const reappearedSet = new Set(reappearedIds.map((r) => r.decisionId));
  const hasMore = decisions.length > pagination.limit;
  const page = hasMore ? decisions.slice(0, pagination.limit) : decisions;

  const items: InboxItem[] = page.map((decision) => {
    const catalogEntry = getDecisionCatalogEntry(decision.proposedActionType, decision.category);
    return {
      id: decision.id,
      entityLabel: entityLabelFor(decision),
      branchLabel: decision.branch ? `${decision.branch.code} · ${decision.branch.name}` : null,
      description: catalogEntry.label,
      href: catalogEntry.href({ branchId: decision.branchId, productId: decision.productId, evidence: formatEvidence(decision.evidenceJson).reduce((acc, e) => ({ ...acc, [e.key]: e.value }), {}), action: (decision.proposedActionJson as Record<string, unknown>) ?? {} }),
      detectedAgo: decision.createdAt,
      status: decision.status,
      resolution: catalogEntry.resolution,
      hasReappeared: reappearedSet.has(decision.id),
    };
  });

  return { items, nextCursor: hasMore ? page.at(-1)?.id ?? null : null };
}

const PENDING_STATUSES: BrainDecisionStatus[] = ["OPEN", "APPROVED", "MANUAL_REVIEW", "FAILED"];
const SUMMARY_RESOLVED_WINDOW_DAYS = 7;
const SUMMARY_STALE_PENDING_DAYS = 7;

/**
 * Fase 2.4 — reemplaza buildExecutiveSummary (frases por palabra clave,
 * borrado en Fase 1). Solo números reales, nada de texto armado buscando
 * "cz"/"transfer"/"politica" en el título.
 */
export async function getBrainInboxSummary(filters: { branchId?: string }, db: Db = prisma) {
  const where: Prisma.BrainDecisionWhereInput = filters.branchId ? { branchId: filters.branchId } : {};
  const resolvedSince = new Date(Date.now() - SUMMARY_RESOLVED_WINDOW_DAYS * 24 * 60 * 60 * 1000);
  const staleSince = new Date(Date.now() - SUMMARY_STALE_PENDING_DAYS * 24 * 60 * 60 * 1000);

  const [criticalPending, totalPending, impact, resolvedBySource, pendingOverAWeek] = await Promise.all([
    db.brainDecision.count({ where: { ...where, status: { in: PENDING_STATUSES }, severity: "CRITICAL" } }),
    db.brainDecision.count({ where: { ...where, status: { in: PENDING_STATUSES } } }),
    db.brainDecision.aggregate({ where: { ...where, status: { in: PENDING_STATUSES } }, _sum: { impactAmount: true } }),
    db.brainDecision.groupBy({ by: ["resolutionSource"], where: { ...where, status: { in: ["RESOLVED", "EXECUTED"] }, resolvedAt: { gte: resolvedSince } }, _count: { _all: true } }),
    db.brainDecision.count({ where: { ...where, status: { in: PENDING_STATUSES }, createdAt: { lt: staleSince } } }),
  ]);

  const bySource = Object.fromEntries(resolvedBySource.map((r) => [r.resolutionSource ?? "UNKNOWN", r._count._all]));

  return {
    criticalPending,
    totalPending,
    estimatedImpactPending: impact._sum.impactAmount != null ? Number(impact._sum.impactAmount) : 0,
    resolvedLast7Days: {
      user: bySource.USER ?? 0,
      auto: bySource.AUTO ?? 0,
      execution: bySource.EXECUTION ?? 0,
    },
    pendingOverSevenDays: pendingOverAWeek,
  };
}
