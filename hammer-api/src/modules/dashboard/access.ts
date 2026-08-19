import type { RoleCode } from "@prisma/client";
import type { SessionPayload } from "@/types/auth";
import { can, CAPABILITIES } from "@/modules/rbac/policies";
import { isPrivilegedGlobal } from "@/modules/rbac/guards";

export type BranchDashboardKind = "SALES" | "CASHIER" | "WAREHOUSE" | "BRANCH_ADMIN";

export type BranchDashboardModuleConfig = {
  enableCashier: boolean;
  enableDispatch: boolean;
};

export type BranchDashboardAccess = {
  branchId: string;
  kind: BranchDashboardKind;
};

const ROLE_VIEW_PRIORITY: Array<{ role: RoleCode; kind: BranchDashboardKind }> = [
  { role: "BRANCH_ADMIN", kind: "BRANCH_ADMIN" },
  { role: "SALES", kind: "SALES" },
  { role: "CASHIER", kind: "CASHIER" },
  { role: "WAREHOUSE", kind: "WAREHOUSE" },
];

function unique(values: string[]): string[] {
  return Array.from(new Set(values));
}

function assignedBranchIds(session: SessionPayload): string[] {
  return unique(session.branchMemberships.map((membership) => membership.branchId));
}

function getBranchRoles(session: SessionPayload, branchId: string): RoleCode[] {
  return session.branchMemberships
    .filter((membership) => membership.branchId === branchId)
    .map((membership) => membership.roleCode);
}

export function assertBranchDashboardModuleEnabled(
  kind: BranchDashboardKind,
  moduleConfig: BranchDashboardModuleConfig,
): void {
  if (kind === "CASHIER" && !moduleConfig.enableCashier) {
    throw new Error("FORBIDDEN_MODULE_DISABLED");
  }

  if (kind === "WAREHOUSE" && !moduleConfig.enableDispatch) {
    throw new Error("FORBIDDEN_MODULE_DISABLED");
  }
}

function deriveDashboardKindFromRoles(roles: RoleCode[]): BranchDashboardKind | null {
  for (const candidate of ROLE_VIEW_PRIORITY) {
    if (roles.includes(candidate.role) && can(candidate.role, CAPABILITIES.BRANCH_DASHBOARD_VIEW)) {
      return candidate.kind;
    }
  }

  return null;
}

export function resolveBranchDashboardAccess(input: {
  session: SessionPayload;
  requestedBranchId?: string;
  moduleConfig: BranchDashboardModuleConfig;
}): BranchDashboardAccess {
  const { session, requestedBranchId, moduleConfig } = input;
  const isGlobal = isPrivilegedGlobal(session);
  const sessionBranchIds = assignedBranchIds(session);
  const branchId = requestedBranchId ?? session.primaryBranchId ?? sessionBranchIds[0];

  if (!branchId) {
    throw new Error("FORBIDDEN_BRANCH");
  }

  if (isGlobal) {
    return { branchId, kind: "BRANCH_ADMIN" };
  }

  if (!sessionBranchIds.includes(branchId)) {
    throw new Error("FORBIDDEN_BRANCH");
  }

  const roles = getBranchRoles(session, branchId);
  const kind = deriveDashboardKindFromRoles(roles);

  if (!kind) {
    throw new Error("FORBIDDEN_CAPABILITY");
  }

  assertBranchDashboardModuleEnabled(kind, moduleConfig);

  return { branchId, kind };
}
