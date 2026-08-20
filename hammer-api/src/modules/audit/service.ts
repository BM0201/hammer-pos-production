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

/**
 * prompt-auditoria-rechazos-y-cierre-de-costos.md A-0 — tx.auditLog.create()
 * dentro de un prisma.$transaction seguido de throw en el MISMO camino se
 * revierte junto con todo lo demás: Prisma deshace la transacción entera,
 * incluida la fila de auditoría que iba a explicar el rechazo. Confirmado en
 * producción — SALE_ORDER_LINE_MUTATION_DENIED tenía cero filas después de
 * 24k+ eventos de auditoría reales.
 *
 * Patrón de arreglo: dentro de la transacción, en vez de escribir la fila,
 * se adjunta el payload al error con attachAuditToError. La función pública
 * que abre la $transaction la envuelve en try/catch y llama a
 * writePendingAuditFromError ANTES de relanzar — ya fuera de la transacción
 * revertida. logAuditEvent ya tiene su propio try/catch (nunca rompe el
 * flujo principal), así que un fallo al auditar jamás convierte un 409 en 500.
 */
type AuditableError = Error & { auditPayload?: AuditInput };

export function attachAuditToError<E extends Error>(error: E, payload: AuditInput): E {
  (error as AuditableError).auditPayload = payload;
  return error;
}

export async function writePendingAuditFromError(error: unknown): Promise<void> {
  const payload = (error as AuditableError | null | undefined)?.auditPayload;
  if (payload) await logAuditEvent(payload);
}

export async function logAuditEvent(input: AuditInput): Promise<void> {
  try {
    let actorUserId = input.actorUserId ?? undefined;
    let branchId = input.branchId ?? undefined;

    // Validate FK references in parallel to avoid sequential round-trips
    if (actorUserId || branchId) {
      const [userExists, branchExists] = await Promise.all([
        actorUserId ? prisma.user.findUnique({ where: { id: actorUserId }, select: { id: true } }) : Promise.resolve(null),
        branchId ? prisma.branch.findUnique({ where: { id: branchId }, select: { id: true } }) : Promise.resolve(null),
      ]);
      if (actorUserId && !userExists) actorUserId = undefined;
      if (branchId && !branchExists) branchId = undefined;
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
  actorUserId?: string;
  entityType?: string;
  entityId?: string;
  result?: string;
  search?: string;
  limit?: number;
  offset?: number;
};

export async function listAuditLogs(input: AuditQueryInput) {
  const take = Math.min(Math.max(input.limit ?? 100, 1), 200);
  const skip = Math.max(input.offset ?? 0, 0);

  // Filtros combinables por OR (result y search) se acumulan en AND para que
  // ninguno pise al otro si algún consumidor futuro llega a mandar ambos.
  const orClauses: Prisma.AuditLogWhereInput[] = [];
  if (input.result) {
    orClauses.push({
      OR: [
        { metadataJson: { path: ["reason"], string_contains: input.result } },
        { metadataJson: { path: ["status"], string_contains: input.result } },
        { metadataJson: { path: ["action"], string_contains: input.result } },
      ],
    });
  }
  if (input.search) {
    orClauses.push({
      OR: [
        { actor: { username: { contains: input.search, mode: "insensitive" } } },
        { actor: { fullName: { contains: input.search, mode: "insensitive" } } },
        { branch: { name: { contains: input.search, mode: "insensitive" } } },
        { branch: { code: { contains: input.search, mode: "insensitive" } } },
        { metadataJson: { path: ["reason"], string_contains: input.search } },
        { metadataJson: { path: ["status"], string_contains: input.search } },
      ],
    });
  }

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
    ...(input.action ? { action: { contains: input.action, mode: "insensitive" } } : {}),
    ...(input.actorUserId ? { actorUserId: input.actorUserId } : {}),
    ...(input.entityType ? { entityType: input.entityType } : {}),
    ...(input.entityId ? { entityId: input.entityId } : {}),
    ...(input.actorUsername
      ? { actor: { username: { contains: input.actorUsername, mode: "insensitive" } } }
      : {}),
    ...(orClauses.length > 0 ? { AND: orClauses } : {}),
  };

  const [rows, total] = await Promise.all([
    prisma.auditLog.findMany({
      where,
      include: {
        branch: { select: { id: true, code: true, name: true } },
        actor: { select: { id: true, username: true, fullName: true } },
      },
      orderBy: { occurredAt: "desc" },
      take,
      skip,
    }),
    prisma.auditLog.count({ where }),
  ]);

  return { rows, total };
}
