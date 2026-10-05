import { ApprovalStatus, ApprovalType, Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { logAuditEvent } from "@/modules/audit/service";
import type { CreateApprovalInput, ListApprovalInput, ResolveApprovalInput } from "@/modules/approvals/types";

export type ApprovalService = {
  createRequest: (input: CreateApprovalInput) => Promise<{ requestId: string; created: boolean }>;
  listRequests: (input: ListApprovalInput) => Promise<Awaited<ReturnType<typeof prisma.approvalRequest.findMany>>>;
  getRequestById: (requestId: string) => Promise<Awaited<ReturnType<typeof prisma.approvalRequest.findUnique>>>;
  resolveRequest: (input: ResolveApprovalInput) => Promise<{ requestId: string; status: ApprovalStatus }>;
};

export function assertNoSelfApproval(requestedByUserId: string, actorUserId: string) {
  if (requestedByUserId === actorUserId) {
    throw new Error("APPROVAL_SELF_REVIEW_FORBIDDEN");
  }
}

export const approvalService: ApprovalService = {
  async createRequest(input) {
    const existing = await prisma.approvalRequest.findFirst({
      where: {
        type: input.type as ApprovalType,
        branchId: input.branchId,
        referenceType: input.referenceType,
        referenceId: input.referenceId,
        status: { in: [ApprovalStatus.REQUESTED, ApprovalStatus.UNDER_REVIEW] },
      },
      orderBy: { createdAt: "desc" },
    });

    if (existing) {
      return { requestId: existing.id, created: false };
    }

    const request = await prisma.approvalRequest.create({
      data: {
        type: input.type as ApprovalType,
        status: ApprovalStatus.REQUESTED,
        branchId: input.branchId,
        referenceType: input.referenceType,
        referenceId: input.referenceId,
        reason: input.reason,
        payloadJson: input.payloadJson as any,
        requestedByUserId: input.requestedByUserId,
      },
    });

    await logAuditEvent({
      actorUserId: input.requestedByUserId,
      branchId: input.branchId,
      module: "approvals",
      action: "APPROVAL_REQUEST_CREATED",
      entityType: "ApprovalRequest",
      entityId: request.id,
      metadataJson: {
        type: input.type,
        referenceType: input.referenceType,
        referenceId: input.referenceId,
      },
    });

    return { requestId: request.id, created: true };
  },

  async listRequests(input) {
    return prisma.approvalRequest.findMany({
      where: {
        ...(input.branchId
          ? { branchId: input.branchId }
          : input.branchIds?.length
            ? { branchId: { in: input.branchIds } }
            : {}),
        ...(input.includeResolved
          ? {}
          : { status: { in: [ApprovalStatus.REQUESTED, ApprovalStatus.UNDER_REVIEW] } }),
        ...(input.status ? { status: input.status } : {}),
      },
      include: {
        branch: true,
        requestedBy: { select: { id: true, username: true, fullName: true } },
        resolvedBy: { select: { id: true, username: true, fullName: true } },
      },
      orderBy: { createdAt: "desc" },
      take: 200,
    });
  },

  async getRequestById(requestId) {
    return prisma.approvalRequest.findUnique({
      where: { id: requestId },
    });
  },

  async resolveRequest(input) {
    return prisma.$transaction((tx) => resolveRequestTx(tx, input));
  },
};

/**
 * prompt-seguridad-basica.md Fase 1, hallazgo del barrido — esta es la
 * compuerta GENÉRICA detrás de STOCK_ADJUSTMENT/DISPATCH_OVERRIDE/
 * RETAINED_CASH_EXPENSE/PRICE_OVERRIDE (ver app/api/approvals/[id]/route.ts):
 * antes leía fuera de transacción y actualizaba sin condición — un doble
 * click en "Aprobar" pasaba el chequeo de estado dos veces y la ruta
 * ejecutaba la acción real (ajuste de inventario, despacho forzado, gasto de
 * caja retenida, override de precio) DOS VECES, aunque esas funciones
 * downstream ya estuvieran endurecidas por su cuenta — el defecto estaba acá,
 * un nivel más arriba. Mismo patrón lock+CAS que el resto de este módulo.
 */
export async function resolveRequestTx(tx: Prisma.TransactionClient, input: ResolveApprovalInput) {
  await tx.$queryRaw`SELECT id FROM "ApprovalRequest" WHERE id = ${input.requestId} FOR UPDATE`;

  const request = await tx.approvalRequest.findUniqueOrThrow({
    where: { id: input.requestId },
  });

  try {
    assertNoSelfApproval(request.requestedByUserId, input.actorUserId);
  } catch (error) {
    await tx.auditLog.create({
      data: {
        actorUserId: input.actorUserId,
        branchId: request.branchId,
        module: "approvals",
        action: "APPROVAL_SELF_REVIEW_DENIED",
        entityType: "ApprovalRequest",
        entityId: request.id,
        metadataJson: { reason: "SELF_APPROVAL_BLOCKED" } as unknown as Prisma.InputJsonValue,
      },
    });
    throw error;
  }

  if (request.status !== ApprovalStatus.REQUESTED && request.status !== ApprovalStatus.UNDER_REVIEW) {
    throw new Error("APPROVAL_ALREADY_RESOLVED");
  }

  const nextStatus = input.decision === "APPROVE" ? ApprovalStatus.APPROVED : ApprovalStatus.REJECTED;
  const updateResult = await tx.approvalRequest.updateMany({
    where: { id: input.requestId, status: request.status },
    data: {
      status: nextStatus,
      resolvedByUserId: input.actorUserId,
      resolvedAt: new Date(),
      resolutionNotes: input.resolutionNotes ?? null,
    },
  });
  if (updateResult.count === 0) throw new Error("APPROVAL_ALREADY_RESOLVED");

  const updated = await tx.approvalRequest.findUniqueOrThrow({ where: { id: input.requestId } });

  await tx.auditLog.create({
    data: {
      actorUserId: input.actorUserId,
      branchId: updated.branchId,
      module: "approvals",
      action: "APPROVAL_REQUEST_RESOLVED",
      entityType: "ApprovalRequest",
      entityId: updated.id,
      metadataJson: {
        decision: input.decision,
        status: updated.status,
      } as unknown as Prisma.InputJsonValue,
    },
  });

  return { requestId: updated.id, status: updated.status };
}
