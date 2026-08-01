import { OperationalDayStatus, Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import {
  openOperationalDay,
  closeOperationalDay,
  businessDateFromNow,
  computeApprovalBlockers,
  calculateOperationalSummaryTx,
  buildChecklist,
  flagOperationalDayAutoCloseSkippedTx,
} from "@/modules/operations/service";
import {
  getOperationalDayAutoConfig,
  type OperationalDayAutoConfig,
  DEFAULT_OPERATIONAL_DAY_AUTO_CONFIG,
} from "@/modules/operations/auto-day-config";
import { getApprovalPolicy } from "@/modules/operations/approve-policy-config";
import { getCashToleranceConfig, resolveCashToleranceForBranch } from "@/modules/operations/cash-tolerance-config";
import { isHardOperationalDayCloseBlocker } from "@/modules/operations/close-policy";

function n(value: Prisma.Decimal | number | string | null | undefined): number {
  return Number(value ?? 0);
}

function toJsonValue(value: unknown): Prisma.InputJsonValue {
  return JSON.parse(JSON.stringify(value)) as Prisma.InputJsonValue;
}

const DEFAULT_TIMEZONE = "America/Managua";

type LocalParts = { weekday: string; hour: number; minute: number };

function localParts(now: Date, timezone = DEFAULT_TIMEZONE): LocalParts {
  const formatter = new Intl.DateTimeFormat("en-US", {
    timeZone: timezone,
    weekday: "long",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  });
  const parts = formatter.formatToParts(now);
  const byType = new Map(parts.map((p) => [p.type, p.value]));
  return {
    // Bug corregido (2026-07-30): Intl.DateTimeFormat con "en-US" devuelve el
    // weekday CAPITALIZADO ("Saturday"/"Sunday"), pero todas las comparaciones
    // de este archivo (resolveTimeForDay, getOperationalDayOpenDeadline,
    // getOperationalDayCloseDeadline) comparaban contra "saturday"/"sunday" en
    // minúscula — NUNCA coincidían. En la práctica esto significaba que los
    // horarios de sábado/domingo (incluyendo "sundayCloseTime: null" para
    // desactivar el domingo) jamás se aplicaban: el sistema siempre usaba el
    // horario de lunes-a-viernes, los 7 días de la semana. Se normaliza acá,
    // en el origen, para que ningún comparador futuro repita el mismo error
    // (auto-close-service.ts ya lo hacía bien, pero con un .toLowerCase() en
    // cada call site en vez de en la fuente — más frágil).
    weekday: (byType.get("weekday") ?? "Sunday").toLowerCase(),
    hour: Number(byType.get("hour") ?? 0),
    minute: Number(byType.get("minute") ?? 0),
  };
}

function resolveTimeForDay(
  weekday: string,
  config: Pick<OperationalDayAutoConfig, "weekdayOpenTime" | "saturdayOpenTime" | "sundayOpenTime">,
): string | null;
function resolveTimeForDay(
  weekday: string,
  config: Pick<OperationalDayAutoConfig, "weekdayCloseTime" | "saturdayCloseTime" | "sundayCloseTime">,
): string | null;
function resolveTimeForDay(weekday: string, config: Record<string, string | null>): string | null {
  if (weekday === "saturday") return config["saturdayOpenTime"] ?? config["saturdayCloseTime"] ?? null;
  if (weekday === "sunday") return config["sundayOpenTime"] ?? config["sundayCloseTime"] ?? null;
  return config["weekdayOpenTime"] ?? config["weekdayCloseTime"] ?? null;
}

function hasTimePassed(targetTime: string, parts: LocalParts): boolean {
  const [h, m] = targetTime.split(":").map(Number);
  return parts.hour * 60 + parts.minute >= h * 60 + m;
}

export function getOperationalDayOpenDeadline(
  now: Date,
  config: OperationalDayAutoConfig = DEFAULT_OPERATIONAL_DAY_AUTO_CONFIG,
) {
  const timezone = config.timezone || DEFAULT_TIMEZONE;
  if (!config.autoOpenEnabled) return { enabled: false, timezone, openTime: null, passed: false };

  const parts = localParts(now, timezone);
  const openTime = parts.weekday === "saturday"
    ? config.saturdayOpenTime
    : parts.weekday === "sunday"
      ? config.sundayOpenTime
      : config.weekdayOpenTime;

  if (!openTime) return { enabled: false, timezone, openTime: null, passed: false };
  return { enabled: true, timezone, openTime, passed: hasTimePassed(openTime, parts) };
}

export function getOperationalDayCloseDeadline(
  now: Date,
  config: OperationalDayAutoConfig = DEFAULT_OPERATIONAL_DAY_AUTO_CONFIG,
) {
  const timezone = config.timezone || DEFAULT_TIMEZONE;
  if (!config.autoCloseEnabled) return { enabled: false, timezone, closeTime: null, passed: false };

  const parts = localParts(now, timezone);
  const closeTime = parts.weekday === "saturday"
    ? config.saturdayCloseTime
    : parts.weekday === "sunday"
      ? config.sundayCloseTime
      : config.weekdayCloseTime;

  if (!closeTime) return { enabled: false, timezone, closeTime: null, passed: false };
  return { enabled: true, timezone, closeTime, passed: hasTimePassed(closeTime, parts) };
}

type AutoDayResult = {
  scanned: number;
  opened: number;
  closed: number;
  approved?: number;
  skipped: number;
  errors: Array<{ branchId: string; message: string }>;
};

export async function autoOpenOperationalDays(input: { now?: Date; dryRun?: boolean } = {}): Promise<AutoDayResult> {
  const now = input.now ?? new Date();
  const dryRun = Boolean(input.dryRun);

  const config = await getOperationalDayAutoConfig();
  const deadline = getOperationalDayOpenDeadline(now, config);

  const result: AutoDayResult = { scanned: 0, opened: 0, closed: 0, skipped: 0, errors: [] };

  if (!deadline.enabled || !deadline.passed) return result;

  const branches = await prisma.branch.findMany({
    where: { isActive: true },
    select: { id: true },
  });

  result.scanned = branches.length;
  const todayBizDate = businessDateFromNow(now);

  for (const branch of branches) {
    try {
      const existing = await prisma.operationalDay.findFirst({
        where: { branchId: branch.id, businessDate: todayBizDate },
        select: { id: true, status: true },
      });

      if (existing) {
        result.skipped++;
        continue;
      }

      // No pre-check for a stale OPEN day from a previous businessDate here:
      // openOperationalDay() (Fase 5) already sweeps it to PENDING_CLOSE and
      // keeps going. Skipping here used to silently defer opening today's day
      // to the next cron tick (up to 10 min later, or indefinitely if a human
      // opens manually first and hits the same stale day) for no reason — the
      // sweep is safe and instantaneous.
      if (!dryRun) {
        await openOperationalDay({ branchId: branch.id, actorUserId: "SYSTEM", notes: "Apertura automática por horario." });
      }
      result.opened++;
    } catch (err) {
      result.errors.push({ branchId: branch.id, message: err instanceof Error ? err.message : String(err) });
    }
  }

  return result;
}

/**
 * Día Operativo v2 Fase 5.3 — auto-cierre de HOY al pasar la hora de corte
 * configurada (`autoCloseEnabled`, opt-in — default false). Antes esta misma
 * función también "manejaba" los días stale (fecha pasada) empujando un
 * error `STALE_OPEN_OPERATIONAL_DAY:...` en cada corrida sin resolverlos
 * nunca — eso ahora es responsabilidad exclusiva de
 * `sweepStaleOperationalDaysToPendingClose` (operations/service.ts), que
 * corre aparte y jamás finaliza un día, solo lo saca de "abierto". Esta
 * función solo toca el día de HOY, y solo si `autoCloseEnabled` sigue
 * habilitado — en el modelo pendiente puro (recomendado) queda desactivada.
 *
 * Bug corregido (2026-07-30): antes, si el día tenía un bloqueante duro
 * (típicamente una caja `AUTO_CLOSED_PENDING_REVIEW` — el propio auto-cierre
 * de cajas, `cashAutoClose`, corre ANTES en el mismo cron y genera
 * justamente ese bloqueante), el catch de `OPERATIONAL_DAY_HAS_HARD_BLOCKERS`
 * solo incrementaba `result.skipped` — sin auditoría, sin alerta, sin badge.
 * En la práctica esto significa que activar `autoCloseEnabled` fallaba en
 * silencio TODOS los días, indefinidamente, sin que nadie se enterara nunca.
 * Ahora se revisa el checklist ANTES de intentar cerrar (para saber
 * exactamente cuál bloqueante es) y, si hay alguno duro, se deja un rastro
 * persistente vía `flagOperationalDayAutoCloseSkippedTx` (decisión de Brain +
 * auditoría) — visible en el Brain, en `criticalBrainDecisions` del Centro de
 * Comando, y resuelto solo cuando el día efectivamente cierra.
 */
export async function autoCloseTodaysOperationalDaysAtDeadline(input: { now?: Date; dryRun?: boolean } = {}): Promise<AutoDayResult> {
  const now = input.now ?? new Date();
  const dryRun = Boolean(input.dryRun);

  const config = await getOperationalDayAutoConfig();
  const deadline = getOperationalDayCloseDeadline(now, config);

  const result: AutoDayResult = { scanned: 0, opened: 0, closed: 0, skipped: 0, errors: [] };

  if (!deadline.enabled || !deadline.passed) return result;

  const todayBizDate = businessDateFromNow(now);
  const openDays = await prisma.operationalDay.findMany({
    where: { status: OperationalDayStatus.OPEN, businessDate: todayBizDate },
    select: { id: true, branchId: true },
  });

  result.scanned = openDays.length;

  for (const day of openDays) {
    try {
      const hardBlockers = await prisma.$transaction(async (tx) => {
        const fullDay = await tx.operationalDay.findUniqueOrThrow({ where: { id: day.id } });
        const summary = await calculateOperationalSummaryTx(tx, fullDay);
        const toleranceConfig = await getCashToleranceConfig();
        const cashDifferenceToleranceAmount = resolveCashToleranceForBranch(toleranceConfig, fullDay.branchId);
        const preview = buildChecklist(summary, fullDay.status, cashDifferenceToleranceAmount);
        return preview.blockers.filter((item) => isHardOperationalDayCloseBlocker(item.key));
      });

      if (hardBlockers.length > 0) {
        if (!dryRun) {
          await prisma.$transaction((tx) => flagOperationalDayAutoCloseSkippedTx(tx, day, hardBlockers));
        }
        result.skipped++;
        continue;
      }

      if (!dryRun) {
        await closeOperationalDay({
          id: day.id,
          actorUserId: "SYSTEM",
          note: "Cierre automático por horario operativo.",
          forceClose: true,
          isMaster: true,
        });
      }
      result.closed++;
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      if (msg === "OPERATIONAL_DAY_HAS_HARD_BLOCKERS") {
        // Carrera rarísima: pasó de "sin bloqueantes" a "con bloqueantes" entre
        // el pre-check y el intento de cierre (ej. se abrió una caja justo en
        // el medio). Se cuenta como skip, igual que antes — el próximo tick
        // del cron lo va a detectar y registrar correctamente.
        result.skipped++;
      } else {
        result.errors.push({ branchId: day.branchId, message: msg });
      }
    }
  }

  return result;
}

export async function autoApproveOperationalDays(
  input: { now?: Date; dryRun?: boolean } = {},
): Promise<AutoDayResult> {
  const now = input.now ?? new Date();
  const dryRun = Boolean(input.dryRun);

  const result: AutoDayResult = { scanned: 0, opened: 0, closed: 0, approved: 0, skipped: 0, errors: [] };

  const policy = await getApprovalPolicy();
  if (!policy.autoApproveEnabled) return result;

  const cutoffTime = new Date(now.getTime() - policy.autoApproveAfterHours * 3600_000);

  const candidates = await prisma.operationalDay.findMany({
    where: {
      status: OperationalDayStatus.CLOSED,
      approvedAt: null,
      closedAt: { lte: cutoffTime },
    },
    select: { id: true, branchId: true },
    take: 100,
  });

  result.scanned = candidates.length;

  for (const candidate of candidates) {
    try {
      await prisma.$transaction(async (tx) => {
        await tx.$queryRaw`SELECT id FROM "OperationalDay" WHERE id = ${candidate.id} FOR UPDATE`;
        const day = await tx.operationalDay.findUnique({ where: { id: candidate.id } });

        // Idempotency / state re-check after acquiring the lock.
        if (!day || day.status !== OperationalDayStatus.CLOSED || day.approvedAt) {
          result.skipped++;
          return;
        }

        const { blockers } = await computeApprovalBlockers(tx, day);
        if (blockers.length > 0) {
          result.skipped++;
          return;
        }

        // F: recalcular el summary ANTES de auto-aprobar (no usar el cashDifferenceTotal viejo).
        const summary = await calculateOperationalSummaryTx(tx, day);

        // No auto-aprobar si la fuente es MIXED (legacy fallback crítico: parte por
        // operationalDayId, parte por ventana) — requiere revisión Master.
        if (summary.sourceMode === "MIXED") {
          result.skipped++;
          return;
        }

        // No auto-aprobar si hay ventas offline sincronizadas tras el cierre (pendientes de revisión).
        if (summary.lateOfflineSyncCount > 0) {
          result.skipped++;
          return;
        }

        if (Math.abs(n(summary.cashDifferenceTotal)) > policy.autoApproveMaxCashDifference) {
          result.skipped++;
          return;
        }

        if (dryRun) {
          result.approved!++;
          return;
        }

        await tx.operationalDay.update({
          where: { id: day.id },
          data: {
            approvedByMasterId: "SYSTEM",
            approvedAt: new Date(),
            // Snapshot RECALCULADO al momento de aprobar (no el viejo summaryJson).
            summaryJson: toJsonValue(summary),
            approvalSummaryJson: toJsonValue(summary),
            salesTotal: new Prisma.Decimal(summary.salesTotal),
            paidOrdersTotal: new Prisma.Decimal(summary.paidOrdersTotal),
            pendingPaymentTotal: new Prisma.Decimal(summary.pendingPaymentTotal),
            expectedCashTotal: new Prisma.Decimal(summary.expectedCashTotal),
            countedCashTotal: new Prisma.Decimal(summary.countedCashTotal),
            cashDifferenceTotal: new Prisma.Decimal(summary.cashDifferenceTotal),
          },
        });

        await tx.auditLog.create({
          data: {
            actorUserId: "SYSTEM",
            branchId: day.branchId,
            module: "operations",
            action: "OPERATIONAL_DAY_AUTO_APPROVED",
            entityType: "OperationalDay",
            entityId: day.id,
            metadataJson: toJsonValue({
              policy: {
                autoApproveAfterHours: policy.autoApproveAfterHours,
                autoApproveMaxCashDifference: policy.autoApproveMaxCashDifference,
              },
              sourceMode: summary.sourceMode,
              cashDifferenceTotal: n(summary.cashDifferenceTotal),
            }),
          },
        });

        result.approved!++;
      });
    } catch (err) {
      result.errors.push({
        branchId: candidate.branchId,
        message: err instanceof Error ? err.message : String(err),
      });
    }
  }

  return result;
}

// Re-export for use by resolveTimeForDay consumers
export { resolveTimeForDay };
