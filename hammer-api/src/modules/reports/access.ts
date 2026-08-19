import type { SessionPayload } from "@/types/auth";
import { isMaster } from "@/modules/rbac/guards";
import { can, canInAnyAssignedBranch, canInBranch, CAPABILITIES } from "@/modules/rbac/policies";

export function canExportReports(session: SessionPayload): boolean {
  return canInAnyAssignedBranch(session, CAPABILITIES.REPORTS_EXPORT);
}

export function resolveReportBranchScope(session: SessionPayload, requestedBranchId?: string) {
  if (isMaster(session)) {
    return requestedBranchId ? [requestedBranchId] : undefined;
  }

  const allowedBranchIds = session.branchMemberships
    .filter((membership) => can(membership.roleCode, CAPABILITIES.REPORTS_EXPORT))
    .map((membership) => membership.branchId);

  if (requestedBranchId) {
    if (!canInBranch(session, requestedBranchId, CAPABILITIES.REPORTS_EXPORT)) {
      throw new Error("FORBIDDEN_BRANCH");
    }
    return [requestedBranchId];
  }

  return allowedBranchIds;
}
