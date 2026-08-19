/**
 * Sweep de retención de datos — ejecuta la política de docs/POLITICA-RETENCION-DATOS.md.
 *
 * Corre diario dentro de /api/cron/cleanup (3am Managua). Borra por lotes de IDs
 * (nunca deleteMany masivo sin límite) para acotar locks y caber en maxDuration;
 * si una tabla tiene más filas vencidas que el tope por corrida, el resto sale
 * en corridas siguientes (capped=true). Cada corrida con borrados reales queda
 * auditada en AuditLog (module "retention").
 *
 * IMPORTANTE: aquí entran tablas de clase ARCHIVO (auditoría/derivados, 3 años)
 * y de clase OBSOLETO OPERATIVO (borradores de nómina abandonados, préstamos
 * cancelados sin historial, gastos automáticos desactivados — ventanas cortas).
 * Los datos transaccionales del negocio (ventas, pagos, inventario, caja,
 * compras, planilla POSTEADA…) NO se purgan jamás desde este módulo.
 */
import { AlertStatus, BrainDecisionStatus, ReorderAlertStatus } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { logAuditEvent } from "@/modules/audit/service";
import {
  ARCHIVE_RETENTION_DAYS,
  CANCELLED_LOAN_RETENTION_DAYS,
  INACTIVE_AUTO_EXPENSE_RETENTION_DAYS,
  STALE_PAYROLL_DRAFT_RETENTION_DAYS,
  retentionCutoff,
} from "./policy";

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
  /** Ventana de retención propia de la regla (ARCHIVO = 3 años; OBSOLETO = corta). */
  retentionDays: number;
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
  // Clase ARCHIVO: todas comparten la ventana de 3 años.
  const archiveRules: Array<Omit<SweepRule, "retentionDays">> = [
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

  // Clase OBSOLETO OPERATIVO: basura que el flujo dejó atrás, ventana corta
  // propia por regla. Un registro abierto o con historial financiero real
  // (deducciones/abonos, liga a caja, desembolso pagado) JAMÁS se purga aquí.
  const staleRules: SweepRule[] = [
    {
      table: "PayrollRun (DRAFT)",
      description: "Borradores de nómina abandonados — nunca posteados y sin actividad",
      retentionDays: STALE_PAYROLL_DRAFT_RETENTION_DAYS,
      count: (cutoff) => prisma.payrollRun.count({ where: { status: "DRAFT", updatedAt: { lt: cutoff } } }),
      findBatchIds: (cutoff, take) =>
        prisma.payrollRun.findMany({
          where: { status: "DRAFT", updatedAt: { lt: cutoff } },
          select: { id: true },
          take,
          orderBy: { updatedAt: "asc" },
        }).then((rows) => rows.map((r) => r.id)),
      deleteByIds: async (ids) => {
        // Guards defensivos: un DRAFT no debería tener desembolsos PAGADOS ni
        // cuotas de préstamo ligadas (eso pasa al postear) — si los tiene, se
        // conserva y que lo revise un humano.
        const [paid, withInstallments] = await Promise.all([
          prisma.payrollDisbursement.findMany({
            where: { payrollRunId: { in: ids }, status: "PAID" },
            select: { payrollRunId: true },
          }),
          prisma.employeeLoanInstallment.findMany({
            where: { payrollRunId: { in: ids } },
            select: { payrollRunId: true },
          }),
        ]);
        const blocked = new Set([...paid.map((p) => p.payrollRunId), ...withInstallments.map((i) => i.payrollRunId)]);
        const safe = ids.filter((id) => !blocked.has(id));
        if (safe.length === 0) return 0;
        await prisma.payrollDisbursement.deleteMany({ where: { payrollRunId: { in: safe } } });
        await prisma.payrollLine.deleteMany({ where: { payrollRunId: { in: safe } } });
        return prisma.payrollRun.deleteMany({ where: { id: { in: safe } } }).then((r) => r.count);
      },
    },
    {
      table: "EmployeeLoan (CANCELLED)",
      description: "Préstamos cancelados sin deducciones ni abonos reales",
      retentionDays: CANCELLED_LOAN_RETENTION_DAYS,
      count: (cutoff) => prisma.employeeLoan.count({ where: { status: "CANCELLED", updatedAt: { lt: cutoff } } }),
      findBatchIds: (cutoff, take) =>
        prisma.employeeLoan.findMany({
          where: { status: "CANCELLED", updatedAt: { lt: cutoff } },
          select: { id: true },
          take,
          orderBy: { updatedAt: "asc" },
        }).then((rows) => rows.map((r) => r.id)),
      deleteByIds: async (ids) => {
        // Guard: si el préstamo llegó a tener deducción de nómina o abono
        // manual (DEDUCTED/PAID), es historial financiero — se conserva.
        const withHistory = await prisma.employeeLoanInstallment.findMany({
          where: { loanId: { in: ids }, status: { in: ["DEDUCTED", "PAID"] } },
          select: { loanId: true },
        });
        const blocked = new Set(withHistory.map((i) => i.loanId));
        const safe = ids.filter((id) => !blocked.has(id));
        if (safe.length === 0) return 0;
        await prisma.employeeLoanInstallment.deleteMany({ where: { loanId: { in: safe } } });
        return prisma.employeeLoan.deleteMany({ where: { id: { in: safe } } }).then((r) => r.count);
      },
    },
    {
      table: "OperatingExpense (auto, inactivo)",
      description: "Gastos automáticos desactivados sin liga a caja (p. ej. duplicados de quincena apagados)",
      retentionDays: INACTIVE_AUTO_EXPENSE_RETENTION_DAYS,
      count: (cutoff) =>
        prisma.operatingExpense.count({
          where: { isActive: false, isAutoCalculated: true, cashMovementId: null, updatedAt: { lt: cutoff } },
        }),
      findBatchIds: (cutoff, take) =>
        prisma.operatingExpense.findMany({
          where: { isActive: false, isAutoCalculated: true, cashMovementId: null, updatedAt: { lt: cutoff } },
          select: { id: true },
          take,
          orderBy: { updatedAt: "asc" },
        }).then((rows) => rows.map((r) => r.id)),
      deleteByIds: (ids) => prisma.operatingExpense.deleteMany({ where: { id: { in: ids } } }).then((r) => r.count),
    },
  ];

  return [
    ...archiveRules.map((rule) => ({ ...rule, retentionDays: ARCHIVE_RETENTION_DAYS })),
    ...staleRules,
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
    // Cada regla usa SU ventana: ARCHIVO (3 años) u OBSOLETO OPERATIVO (corta).
    const ruleCutoff = retentionCutoff(rule.retentionDays, now);
    const matched = await rule.count(ruleCutoff);
    let deleted = 0;
    let capped = false;

    if (!dryRun && matched > 0) {
      for (let batch = 0; batch < maxBatches; batch++) {
        const ids = await rule.findBatchIds(ruleCutoff, batchSize);
        if (ids.length === 0) break;
        const deletedInBatch = await rule.deleteByIds(ids);
        deleted += deletedInBatch;
        // Si los guards bloquearon todo el lote, cortar: reintentar traería
        // los mismos ids indefinidamente.
        if (deletedInBatch === 0 || ids.length < batchSize) break;
        if (batch === maxBatches - 1) capped = true;
      }
    }

    results.push({
      table: rule.table,
      description: rule.description,
      retentionDays: rule.retentionDays,
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
