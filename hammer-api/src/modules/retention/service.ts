/**
 * Sweep de retención de datos — ejecuta la política de docs/POLITICA-RETENCION-DATOS.md.
 *
 * Corre diario dentro de /api/cron/cleanup (3am Managua). Borra por lotes de IDs
 * (nunca deleteMany masivo sin límite) para acotar locks y caber en maxDuration;
 * si una tabla tiene más filas vencidas que el tope por corrida, el resto sale
 * en corridas siguientes (capped=true). Cada corrida con borrados reales queda
 * auditada en AuditLog (module "retention").
 *
 * IMPORTANTE: aquí solo entran tablas de clase ARCHIVO (auditoría/derivados).
 * Los datos transaccionales del negocio (ventas, pagos, inventario, caja,
 * compras, planilla…) NO se purgan jamás desde este módulo.
 */
import { AlertStatus, BrainDecisionStatus, ReorderAlertStatus } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { logAuditEvent } from "@/modules/audit/service";
import { ARCHIVE_RETENTION_DAYS, retentionCutoff } from "./policy";

const DEFAULT_BATCH_SIZE = 1000;
const DEFAULT_MAX_BATCHES_PER_TABLE = 20; // máx 20k filas/tabla/corrida

export type SweepRuleResult = {
  table: string;
  description: string;
  retentionDays: number;
  matched: number;
  deleted: number;
  capped: boolean;
};

export type RetentionSweepResult = {
  dryRun: boolean;
  cutoffIso: string;
  executedAt: string;
  totalDeleted: number;
  rules: SweepRuleResult[];
};

type SweepRule = {
  table: string;
  description: string;
  count: (cutoff: Date) => Promise<number>;
  /** Devuelve ids del siguiente lote a borrar. */
  findBatchIds: (cutoff: Date, take: number) => Promise<string[]>;
  /** Borra el lote. Debe encargarse de dependencias sin cascade. */
  deleteByIds: (ids: string[]) => Promise<number>;
};

// Estados "cerrados" — un registro abierto/en curso nunca se purga aunque sea viejo.
const BRAIN_CLOSED_STATUSES: BrainDecisionStatus[] = [
  BrainDecisionStatus.EXECUTED,
  BrainDecisionStatus.DISMISSED,
  BrainDecisionStatus.EXPIRED,
  BrainDecisionStatus.FAILED,
];
const SECURITY_ALERT_CLOSED: AlertStatus[] = [AlertStatus.RESOLVED, AlertStatus.DISMISSED];
const REORDER_CLOSED: ReorderAlertStatus[] = [
  ReorderAlertStatus.DISMISSED,
  ReorderAlertStatus.CONVERTED_TO_PURCHASE_ORDER,
  ReorderAlertStatus.CONVERTED_TO_TRANSFER,
];

function buildRules(): SweepRule[] {
  return [
    {
      table: "AuditLog",
      description: "Bitácora de auditoría (exportable a CSV vía /api/reports/audit antes de purgar)",
      count: (cutoff) => prisma.auditLog.count({ where: { occurredAt: { lt: cutoff } } }),
      findBatchIds: (cutoff, take) =>
        prisma.auditLog.findMany({ where: { occurredAt: { lt: cutoff } }, select: { id: true }, take, orderBy: { occurredAt: "asc" } })
          .then((rows) => rows.map((r) => r.id)),
      deleteByIds: (ids) => prisma.auditLog.deleteMany({ where: { id: { in: ids } } }).then((r) => r.count),
    },
    {
      table: "BrainDecision",
      description: "Decisiones Brain cerradas (ejecutadas/descartadas/expiradas/fallidas)",
      count: (cutoff) => prisma.brainDecision.count({
        where: { status: { in: BRAIN_CLOSED_STATUSES }, updatedAt: { lt: cutoff } },
      }),
      findBatchIds: (cutoff, take) =>
        prisma.brainDecision.findMany({
          where: { status: { in: BRAIN_CLOSED_STATUSES }, updatedAt: { lt: cutoff } },
          select: { id: true },
          take,
          orderBy: { updatedAt: "asc" },
        }).then((rows) => rows.map((r) => r.id)),
      deleteByIds: async (ids) => {
        // BrainDecisionActionLog no tiene onDelete: Cascade — borrar primero.
        // BrainDecisionOutcome sí cascadea.
        await prisma.brainDecisionActionLog.deleteMany({ where: { decisionId: { in: ids } } });
        return prisma.brainDecision.deleteMany({ where: { id: { in: ids } } }).then((r) => r.count);
      },
    },
    {
      table: "SecurityAlert",
      description: "Alertas de seguridad resueltas/descartadas",
      count: (cutoff) => prisma.securityAlert.count({
        where: { status: { in: SECURITY_ALERT_CLOSED }, createdAt: { lt: cutoff } },
      }),
      findBatchIds: (cutoff, take) =>
        prisma.securityAlert.findMany({
          where: { status: { in: SECURITY_ALERT_CLOSED }, createdAt: { lt: cutoff } },
          select: { id: true },
          take,
          orderBy: { createdAt: "asc" },
        }).then((rows) => rows.map((r) => r.id)),
      deleteByIds: (ids) => prisma.securityAlert.deleteMany({ where: { id: { in: ids } } }).then((r) => r.count),
    },
    {
      table: "ReorderAlert",
      description: "Alertas de reposición cerradas (descartadas o convertidas)",
      count: (cutoff) => prisma.reorderAlert.count({
        where: { status: { in: REORDER_CLOSED }, createdAt: { lt: cutoff } },
      }),
      findBatchIds: (cutoff, take) =>
        prisma.reorderAlert.findMany({
          where: { status: { in: REORDER_CLOSED }, createdAt: { lt: cutoff } },
          select: { id: true },
          take,
          orderBy: { createdAt: "asc" },
        }).then((rows) => rows.map((r) => r.id)),
      deleteByIds: (ids) => prisma.reorderAlert.deleteMany({ where: { id: { in: ids } } }).then((r) => r.count),
    },
    {
      table: "ProductPricing",
      description: "Snapshots históricos de cálculos de precio",
      count: (cutoff) => prisma.productPricing.count({ where: { calculatedAt: { lt: cutoff } } }),
      findBatchIds: (cutoff, take) =>
        prisma.productPricing.findMany({ where: { calculatedAt: { lt: cutoff } }, select: { id: true }, take, orderBy: { calculatedAt: "asc" } })
          .then((rows) => rows.map((r) => r.id)),
      deleteByIds: (ids) => prisma.productPricing.deleteMany({ where: { id: { in: ids } } }).then((r) => r.count),
    },
    {
      table: "ProductAnalytics",
      description: "Agregados mensuales ABC-XYZ (recalculables desde ventas)",
      count: (cutoff) => prisma.productAnalytics.count({ where: { month: { lt: cutoff } } }),
      findBatchIds: (cutoff, take) =>
        prisma.productAnalytics.findMany({ where: { month: { lt: cutoff } }, select: { id: true }, take, orderBy: { month: "asc" } })
          .then((rows) => rows.map((r) => r.id)),
      deleteByIds: (ids) => prisma.productAnalytics.deleteMany({ where: { id: { in: ids } } }).then((r) => r.count),
    },
    {
      table: "InventoryImportBatch",
      description: "Lotes de importación Excel (líneas cascadean)",
      count: (cutoff) => prisma.inventoryImportBatch.count({ where: { createdAt: { lt: cutoff } } }),
      findBatchIds: (cutoff, take) =>
        prisma.inventoryImportBatch.findMany({ where: { createdAt: { lt: cutoff } }, select: { id: true }, take, orderBy: { createdAt: "asc" } })
          .then((rows) => rows.map((r) => r.id)),
      deleteByIds: (ids) => prisma.inventoryImportBatch.deleteMany({ where: { id: { in: ids } } }).then((r) => r.count),
    },
    {
      table: "ReplenishmentDraft",
      description: "Borradores de reposición antiguos (ítems cascadean)",
      count: (cutoff) => prisma.replenishmentDraft.count({ where: { createdAt: { lt: cutoff } } }),
      findBatchIds: (cutoff, take) =>
        prisma.replenishmentDraft.findMany({ where: { createdAt: { lt: cutoff } }, select: { id: true }, take, orderBy: { createdAt: "asc" } })
          .then((rows) => rows.map((r) => r.id)),
      deleteByIds: (ids) => prisma.replenishmentDraft.deleteMany({ where: { id: { in: ids } } }).then((r) => r.count),
    },
    {
      table: "DocumentPrintLog",
      description: "Bitácora de impresión de documentos",
      count: (cutoff) => prisma.documentPrintLog.count({ where: { printedAt: { lt: cutoff } } }),
      findBatchIds: (cutoff, take) =>
        prisma.documentPrintLog.findMany({ where: { printedAt: { lt: cutoff } }, select: { id: true }, take, orderBy: { printedAt: "asc" } })
          .then((rows) => rows.map((r) => r.id)),
      deleteByIds: (ids) => prisma.documentPrintLog.deleteMany({ where: { id: { in: ids } } }).then((r) => r.count),
    },
  ];
}

export async function runRetentionSweep(input: {
  dryRun?: boolean;
  now?: Date;
  batchSize?: number;
  maxBatchesPerTable?: number;
  actorUserId?: string;
} = {}): Promise<RetentionSweepResult> {
  const now = input.now ?? new Date();
  const dryRun = Boolean(input.dryRun);
  const batchSize = Math.max(100, Math.min(input.batchSize ?? DEFAULT_BATCH_SIZE, 5000));
  const maxBatches = Math.max(1, Math.min(input.maxBatchesPerTable ?? DEFAULT_MAX_BATCHES_PER_TABLE, 100));
  const cutoff = retentionCutoff(ARCHIVE_RETENTION_DAYS, now);

  const results: SweepRuleResult[] = [];

  for (const rule of buildRules()) {
    const matched = await rule.count(cutoff);
    let deleted = 0;
    let capped = false;

    if (!dryRun && matched > 0) {
      for (let batch = 0; batch < maxBatches; batch++) {
        const ids = await rule.findBatchIds(cutoff, batchSize);
        if (ids.length === 0) break;
        deleted += await rule.deleteByIds(ids);
        if (ids.length < batchSize) break;
        if (batch === maxBatches - 1) capped = true;
      }
    }

    results.push({
      table: rule.table,
      description: rule.description,
      retentionDays: ARCHIVE_RETENTION_DAYS,
      matched,
      deleted,
      capped,
    });
  }

  const totalDeleted = results.reduce((sum, r) => sum + r.deleted, 0);

  if (!dryRun && totalDeleted > 0) {
    await logAuditEvent({
      actorUserId: input.actorUserId,
      module: "retention",
      action: "RETENTION_SWEEP_EXECUTED",
      entityType: "System",
      entityId: "retention-sweep",
      metadataJson: {
        cutoff: cutoff.toISOString(),
        retentionDays: ARCHIVE_RETENTION_DAYS,
        totalDeleted,
        byTable: Object.fromEntries(results.filter((r) => r.deleted > 0).map((r) => [r.table, r.deleted])),
        capped: results.filter((r) => r.capped).map((r) => r.table),
      },
    });
  }

  return {
    dryRun,
    cutoffIso: cutoff.toISOString(),
    executedAt: now.toISOString(),
    totalDeleted,
    rules: results,
  };
}
