/**
 * Security Alerts — generación y gestión de alertas de seguridad.
 *
 * Las alertas son de solo escritura desde el código de seguridad
 * y de solo lectura desde el Security Center.
 */

import { prisma } from "@/lib/prisma";
import type { AlertSeverity, AlertStatus } from "@prisma/client";
import { Prisma } from "@prisma/client";

export type CreateAlertInput = {
  severity: "CRITICAL" | "HIGH" | "MEDIUM" | "LOW";
  type: string;
  title: string;
  description: string;
  actorUserId?: string;
  branchId?: string;
  entityType?: string;
  entityId?: string;
  metadataJson?: Record<string, unknown>;
};

/** Crea una SecurityAlert. Nunca lanza — los errores se suprimen para no bloquear el flujo principal. */
export async function createSecurityAlert(input: CreateAlertInput): Promise<void> {
  try {
    await prisma.securityAlert.create({
      data: {
        severity: input.severity as AlertSeverity,
        type: input.type,
        title: input.title,
        description: input.description,
        actorUserId: input.actorUserId,
        branchId: input.branchId,
        entityType: input.entityType,
        entityId: input.entityId,
        metadataJson: input.metadataJson as Prisma.InputJsonValue ?? undefined,
      },
    });
  } catch {
    // No bloquear el flujo principal si la alerta falla
  }
}

export type ListAlertsOptions = {
  status?: AlertStatus;
  severity?: AlertSeverity;
  type?: string;
  limit?: number;
  offset?: number;
};

export async function listSecurityAlerts(opts: ListAlertsOptions = {}) {
  const { status, severity, type, limit = 50, offset = 0 } = opts;

  const [items, total] = await Promise.all([
    prisma.securityAlert.findMany({
      where: {
        ...(status && { status }),
        ...(severity && { severity }),
        ...(type && { type }),
      },
      orderBy: { createdAt: "desc" },
      take: limit,
      skip: offset,
      select: {
        id: true,
        severity: true,
        type: true,
        title: true,
        description: true,
        actorUserId: true,
        branchId: true,
        entityType: true,
        entityId: true,
        status: true,
        createdAt: true,
        acknowledgedBy: true,
        acknowledgedAt: true,
        resolvedBy: true,
        resolvedAt: true,
        note: true,
      },
    }),
    prisma.securityAlert.count({
      where: {
        ...(status && { status }),
        ...(severity && { severity }),
        ...(type && { type }),
      },
    }),
  ]);

  return { items, total };
}

export type UpdateAlertInput = {
  alertId: string;
  actorUserId: string;
  action: "ACKNOWLEDGE" | "RESOLVE" | "DISMISS";
  note?: string;
};

export async function updateAlertStatus(input: UpdateAlertInput): Promise<void> {
  const now = new Date();
  const { alertId, actorUserId, action, note } = input;

  const statusMap: Record<string, AlertStatus> = {
    ACKNOWLEDGE: "ACKNOWLEDGED",
    RESOLVE: "RESOLVED",
    DISMISS: "DISMISSED",
  };

  const updateData =
    action === "ACKNOWLEDGE"
      ? { status: "ACKNOWLEDGED" as AlertStatus, acknowledgedBy: actorUserId, acknowledgedAt: now, note }
      : action === "RESOLVE"
      ? { status: "RESOLVED" as AlertStatus, resolvedBy: actorUserId, resolvedAt: now, note }
      : { status: "DISMISSED" as AlertStatus, resolvedBy: actorUserId, resolvedAt: now, note };

  await prisma.securityAlert.update({
    where: { id: alertId },
    data: updateData,
  });
}

export async function getAlertCounts() {
  const rows = await prisma.securityAlert.groupBy({
    by: ["severity", "status"],
    _count: { id: true },
    where: { status: "OPEN" },
  });

  const result = { CRITICAL: 0, HIGH: 0, MEDIUM: 0, LOW: 0, total: 0 };
  for (const row of rows) {
    const key = row.severity as keyof typeof result;
    if (key in result) {
      const count = row._count.id;
      result[key] += count;
      result.total += count;
    }
  }
  return result;
}
