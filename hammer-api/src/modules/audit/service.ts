import { prisma } from "@/lib/prisma";
import { Prisma } from "@prisma/client";

type AuditInput = {
  actorUserId?: string;
  branchId?: string;
  module: string;
  action: string;
  entityType: string;
  entityId: string;
  metadataJson?: Record<string, unknown>;
  ipAddress?: string;
  userAgent?: string;
};

export async function logAuditEvent(input: AuditInput): Promise<void> {
  try {
    let actorUserId = input.actorUserId ?? undefined;
    let branchId = input.branchId ?? undefined;

    // Validate FK references exist before inserting
    if (actorUserId) {
      const userExists = await prisma.user.findUnique({
        where: { id: actorUserId },
        select: { id: true },
      });
      if (!userExists) {
        console.warn(`[audit] User ${actorUserId} not found – logging without actor`);
        actorUserId = undefined;
      }
    }

    if (branchId) {
      const branchExists = await prisma.branch.findUnique({
        where: { id: branchId },
        select: { id: true },
      });
      if (!branchExists) {
        console.warn(`[audit] Branch ${branchId} not found – logging without branch`);
        branchId = undefined;
      }
    }

    await prisma.auditLog.create({
      data: {
        actorUserId,
        branchId,
        module: input.module,
        action: input.action,
        entityType: input.entityType,
        entityId: input.entityId,
        metadataJson: input.metadataJson as any,
        ipAddress: input.ipAddress,
        userAgent: input.userAgent,
      },
    });
  } catch (error) {
    // Never break the main flow because of an audit log failure
    console.error("[audit] Failed to create audit log:", error);
  }
}

export type AuditQueryInput = {
  dateFrom?: Date;
  dateTo?: Date;
  branchId?: string;
  allowedBranchIds?: string[];
  module?: string;
  action?: string;
  actorUsername?: string;
  result?: string;
  limit?: number;
};

export async function listAuditLogs(input: AuditQueryInput) {
  const take = Math.min(Math.max(input.limit ?? 100, 1), 200);

  const where: Prisma.AuditLogWhereInput = {
    ...(input.dateFrom || input.dateTo
      ? {
          occurredAt: {
            ...(input.dateFrom ? { gte: input.dateFrom } : {}),
            ...(input.dateTo ? { lte: input.dateTo } : {}),
          },
        }
      : {}),
    ...(input.branchId
      ? { branchId: input.branchId }
      : input.allowedBranchIds?.length
        ? { branchId: { in: input.allowedBranchIds } }
        : {}),
    ...(input.module ? { module: input.module } : {}),
    ...(input.action ? { action: input.action } : {}),
    ...(input.actorUsername
      ? { actor: { username: { contains: input.actorUsername } } }
      : {}),
  };

  const rows = await prisma.auditLog.findMany({
    where,
    include: {
      branch: { select: { id: true, code: true, name: true } },
      actor: { select: { id: true, username: true, fullName: true } },
    },
    orderBy: { occurredAt: "desc" },
    take,
  });

  if (!input.result) return rows;

  return rows.filter((row) => {
    const metadata = (row.metadataJson ?? {}) as Record<string, unknown>;
    const reason = typeof metadata.reason === "string" ? metadata.reason : "";
    const status = typeof metadata.status === "string" ? metadata.status : "";
    return reason.toLowerCase().includes(input.result!.toLowerCase()) || status.toLowerCase().includes(input.result!.toLowerCase());
  });
}
