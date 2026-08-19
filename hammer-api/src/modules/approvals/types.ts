import type { ApprovalStatus } from "@prisma/client";
import { APPROVAL_DECISIONS, APPROVAL_REQUEST_TYPES } from "@/modules/approvals/constants";

export type ApprovalDomainType = (typeof APPROVAL_REQUEST_TYPES)[keyof typeof APPROVAL_REQUEST_TYPES];
export type ApprovalDecision = (typeof APPROVAL_DECISIONS)[keyof typeof APPROVAL_DECISIONS];

export type CreateApprovalInput = {
  branchId: string;
  requestedByUserId: string;
  referenceType: string;
  referenceId: string;
  reason: string;
  type: ApprovalDomainType;
  payloadJson?: Record<string, unknown>;
};

export type ResolveApprovalInput = {
  requestId: string;
  actorUserId: string;
  decision: ApprovalDecision;
  resolutionNotes?: string | null;
};

export type ListApprovalInput = {
  branchId?: string;
  branchIds?: string[];
  status?: ApprovalStatus;
  includeResolved?: boolean;
};
