import { ApprovalStatus, ApprovalType } from "@prisma/client";
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
    const request = await prisma.approvalRequest.findUniqueOrThrow({
      where: { id: input.requestId },
    });

    try {
      assertNoSelfApproval(request.requestedByUserId, input.actorUserId);
    } catch (error) {
      await logAuditEvent({
        actorUserId: input.actorUserId,
        branchId: request.branchId,
        module: "approvals",
        action: "APPROVAL_SELF_REVIEW_DENIED",
        entityType: "ApprovalRequest",
        entityId: request.id,
        metadataJson: {
          reason: "SELF_APPROVAL_BLOCKED",
        },
      });
      throw error;
    }

    if (request.status !== ApprovalStatus.REQUESTED && request.status !== ApprovalStatus.UNDER_REVIEW) {
      throw new Error("APPROVAL_ALREADY_RESOLVED");
    }

    const nextStatus = input.decision === "APPROVE" ? ApprovalStatus.APPROVED : ApprovalStatus.REJECTED;
    const updated = await prisma.approvalRequest.update({
      where: { id: input.requestId },
      data: {
        status: nextStatus,
        resolvedByUserId: input.actorUserId,
        resolvedAt: new Date(),
        resolutionNotes: input.resolutionNotes ?? null,
      },
    });

    await logAuditEvent({
      actorUserId: input.actorUserId,
      branchId: updated.branchId,
      module: "approvals",
      action: "APPROVAL_REQUEST_RESOLVED",
      entityType: "ApprovalRequest",
      entityId: updated.id,
      metadataJson: {
        decision: input.decision,
        status: updated.status,
      },
    });

    return { requestId: updated.id, status: updated.status };
  },
};
