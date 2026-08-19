import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { OPERATIONAL_TIMEZONE, businessDateFromNow } from "@/modules/operations/business-date";
import { sweepDayToAwaitingReviewTx } from "@/modules/operations/day-lifecycle";
import { refreshOperationalDaySummaryTx } from "@/modules/operations/day-summary";

const TIMEZONE = OPERATIONAL_TIMEZONE;

function toJsonValue(value: unknown): Prisma.InputJsonValue {
  return JSON.parse(JSON.stringify(value)) as Prisma.InputJsonValue;
}

/**
 * Devuelve el día operativo ACTIVE de HOY para la sucursal, creándolo si hace
 * falta. Contrato duro: esta función NUNCA lanza por causa del estado del día
 * operativo. Solo puede lanzar si la sucursal no existe o está inactiva — un
 * error de datos, no de flujo operativo.
 *
 * Reemplaza a ensureOpenOperationalDayTx (lanzaba OPERATIONAL_DAY_NOT_OPEN
 * cuando el auto-open estaba deshabilitado — el default de fábrica) y a
 * resolveOpenOperationalDayForOperationTx. Debe ejecutarse dentro de una transacción.
 */
export async function resolveOperationalDayForOperationTx(
  tx: Prisma.TransactionClient,
  branchId: string,
  actorUserId: string,
  occurredAt: Date = new Date(),
): Promise<{ dayId: string; created: boolean; sweptDayIds: string[] }> {
  // Serializa aperturas concurrentes contra @@unique([branchId, businessDate]).
  await tx.$queryRaw`SELECT id FROM "Branch" WHERE id = ${branchId} FOR UPDATE`;

  const branch = await tx.branch.findUnique({ where: { id: branchId }, select: { id: true, isActive: true } });
  if (!branch?.isActive) throw new Error("BRANCH_NOT_ACTIVE");

  const today = businessDateFromNow(occurredAt);

  // 1. Barrer TODO día ACTIVE de fecha pasada. Nunca bloquea, nunca finaliza:
  //    solo sale de ACTIVE y se queda en la cola de pendientes de confirmar.
  const staleDays = await tx.operationalDay.findMany({
    where: { branchId, lifecycle: "ACTIVE", businessDate: { lt: today } },
    select: { id: true, branchId: true, businessDate: true },
  });
  const sweptDayIds: string[] = [];
  for (const stale of staleDays) {
    await sweepDayToAwaitingReviewTx(tx, stale, { bySystem: true });
    sweptDayIds.push(stale.id);
  }

  // 2. ¿Existe ya el día de hoy? Se reutiliza en CUALQUIER lifecycle salvo
  //    CANCELLED. Si estaba en AWAITING_REVIEW o venía de un reviewStatus
  //    CONFIRMED, se reactiva y se audita — nunca se bloquea. Si estaba
  //    PENDING sigue PENDING; si ya estaba CONFIRMED, la reactivación revierte
  //    la firma a PENDING porque el día vuelve a moverse.
  const existing = await tx.operationalDay.findUnique({
    where: { branchId_businessDate: { branchId, businessDate: today } },
  });

  if (existing && existing.lifecycle !== "CANCELLED") {
    if (existing.lifecycle !== "ACTIVE") {
      const reviewReverted = existing.reviewStatus === "CONFIRMED";
      await tx.operationalDay.update({
        where: { id: existing.id },
        data: {
          lifecycle: "ACTIVE",
          sweptAt: null,
          sweptBySystem: false,
          sweptByUserId: null,
          ...(reviewReverted ? { reviewStatus: "PENDING", reviewedByUserId: null, reviewedAt: null } : {}),
        },
      });
      await tx.auditLog.create({
        data: {
          actorUserId: actorUserId === "SYSTEM" ? null : actorUserId,
          branchId,
          module: "operations",
          action: "OPERATIONAL_DAY_REACTIVATED",
          entityType: "OperationalDay",
          entityId: existing.id,
          metadataJson: toJsonValue({
            previousLifecycle: existing.lifecycle,
            reviewReverted,
            reason: "Operación nueva sobre un día de hoy que ya había salido de ACTIVE.",
          }),
        },
      });
    }
    return { dayId: existing.id, created: false, sweptDayIds };
  }

  // 3. Día cancelado de hoy: no se reutiliza tal cual (fue anulado a
  //    propósito), pero tampoco se bloquea la operación — se reactiva con
  //    auditoría de excepción (el @@unique impide crear una fila nueva).
  if (existing) {
    await tx.operationalDay.update({
      where: { id: existing.id },
      data: { lifecycle: "ACTIVE", reviewStatus: "PENDING", sweptAt: null, sweptBySystem: false, sweptByUserId: null },
    });
    await tx.auditLog.create({
      data: {
        actorUserId: actorUserId === "SYSTEM" ? null : actorUserId,
        branchId,
        module: "operations",
        action: "OPERATIONAL_DAY_REACTIVATED_FROM_CANCELLED",
        entityType: "OperationalDay",
        entityId: existing.id,
        metadataJson: toJsonValue({ severity: "REVIEW", reason: "Operación sobre un día anulado." }),
      },
    });
    return { dayId: existing.id, created: false, sweptDayIds };
  }

  // 4. No existe: se crea. Sin consultar ningún flag de auto-open — la
  //    primera operación del día siempre lo puede crear. openedByUserId exige
  //    un usuario real (FK a User) — este resolver solo crea días a partir de
  //    una operación real de caja/venta, nunca de un trigger "SYSTEM".
  const created = await tx.operationalDay.create({
    data: { branchId, businessDate: today, openedByUserId: actorUserId },
  });
  await tx.auditLog.create({
    data: {
      actorUserId: actorUserId === "SYSTEM" ? null : actorUserId,
      branchId,
      module: "operations",
      action: "OPERATIONAL_DAY_AUTO_OPENED",
      entityType: "OperationalDay",
      entityId: created.id,
      metadataJson: toJsonValue({ businessDate: today, trigger: "FIRST_OPERATION", timezone: TIMEZONE }),
    },
  });

  return { dayId: created.id, created: true, sweptDayIds };
}

export type CurrentOperationalDayState = "NO_DAY" | "ACTIVE_TODAY" | "AWAITING_REVIEW" | "CONFIRMED";

type OperationalDayStateInfo = {
  id: string;
  lifecycle: string;
  reviewStatus: string;
  businessDate: Date;
  reviewedAt: Date | null;
  openedAt: Date;
};

/** Estado del día operativo de HOY para una sucursal — lectura pura, sin efectos. */
export async function getCurrentOperationalDayState(branchId: string): Promise<{
  state: CurrentOperationalDayState;
  day: OperationalDayStateInfo | null;
}> {
  const today = businessDateFromNow();
  const day = await prisma.operationalDay.findUnique({
    where: { branchId_businessDate: { branchId, businessDate: today } },
    select: { id: true, lifecycle: true, reviewStatus: true, businessDate: true, reviewedAt: true, openedAt: true },
  });
  if (!day) return { state: "NO_DAY", day: null };

  const state: CurrentOperationalDayState =
    day.reviewStatus === "CONFIRMED" ? "CONFIRMED" : day.lifecycle === "ACTIVE" ? "ACTIVE_TODAY" : "AWAITING_REVIEW";
  return { state, day };
}

/** Vista completa del día de HOY (o null si aún no existe). Refresca el summary en vivo si sigue ACTIVE. */
export async function getCurrentOperationalDay(branchId: string) {
  const today = businessDateFromNow();
  const day = await prisma.operationalDay.findUnique({
    where: { branchId_businessDate: { branchId, businessDate: today } },
    include: { branch: true, openedBy: { select: { id: true, username: true, fullName: true } } },
  });
  if (!day) return null;

  if (day.lifecycle === "ACTIVE") {
    await prisma.$transaction((tx) => refreshOperationalDaySummaryTx(tx, day.id));
  }

  const full = await prisma.operationalDay.findUnique({
    where: { id: day.id },
    include: {
      branch: true,
      openedBy: { select: { id: true, username: true, fullName: true } },
      sweptBy: { select: { id: true, username: true, fullName: true } },
      reviewedBy: { select: { id: true, username: true, fullName: true } },
      cashSessions: {
        include: {
          physicalCashBox: true,
          openedBy: { select: { id: true, username: true, fullName: true } },
          reviewedBy: { select: { id: true, username: true, fullName: true } },
        },
        orderBy: { openedAt: "asc" },
      },
    },
  });
  if (!full) return null;

  // Ventas offline sincronizadas tras salir de ACTIVE, pendientes de revisión —
  // se calcula en vivo para que se vea aunque el snapshot no se haya regenerado.
  const lateOfflineSyncCount = full.sweptAt
    ? await prisma.saleOrder.count({
        where: { operationalDayId: full.id, offlineClientId: { not: null }, syncedAt: { gt: full.sweptAt } },
      })
    : 0;

  return { ...full, lateOfflineSyncCount };
}
