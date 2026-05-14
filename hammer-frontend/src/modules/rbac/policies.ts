// Frontend-local copy of policies (decoupled from @prisma/client).
// Must stay in sync with backend src/modules/rbac/policies.ts
import type { RoleCode, SessionPayload } from "@/types/auth";

export const CAPABILITIES = {
  SYSTEM_ADMIN_ACCESS: "system.admin.access",
  SYSTEM_ADMIN_ROLE_CONFIG: "system.admin.role.config",
  SYSTEM_ADMIN_SETTINGS: "system.admin.settings",
  MASTER_ACCESS: "master.access",
  MASTER_USERS_MANAGE: "master.users.manage",
  MASTER_CATALOG_MANAGE: "master.catalog.manage",
  MASTER_INVENTORY_VIEW: "master.inventory.view",
  MASTER_SALES_VIEW: "master.sales.view",
  BRANCH_DASHBOARD_VIEW: "branch.dashboard.view",
  BRANCH_CATALOG_VIEW: "branch.catalog.view",
  BRANCH_INVENTORY_VIEW: "branch.inventory.view",
  INVENTORY_MOVEMENT_POST: "inventory.movement.post",
  SALES_VIEW: "sales.view",
  SALES_DRAFT_MANAGE: "sales.draft.manage",
  SALES_SUBMIT_PAYMENT: "sales.submit.payment",
  CASH_PAYMENTS_VIEW: "cash.payments.view",
  CASH_PAYMENTS_COLLECT: "cash.payments.collect",
  CASH_SESSION_OPERATE: "cash.session.operate",
  DISPATCH_VIEW: "dispatch.view",
  DISPATCH_MARK: "dispatch.mark",
  APPROVAL_REQUEST_CREATE: "approval.request.create",
  APPROVAL_REQUEST_REVIEW: "approval.request.review",
  AUDIT_VIEW: "audit.view",
  REPORTS_EXPORT: "reports.export",
} as const;

export type Capability = (typeof CAPABILITIES)[keyof typeof CAPABILITIES];

const ALL_CAPABILITIES = Object.values(CAPABILITIES);

const ROLE_CAPABILITIES: Record<RoleCode, Capability[]> = {
  SYSTEM_ADMIN: ALL_CAPABILITIES,
  OWNER: ALL_CAPABILITIES.filter(c => c !== CAPABILITIES.SYSTEM_ADMIN_ACCESS && c !== CAPABILITIES.SYSTEM_ADMIN_ROLE_CONFIG && c !== CAPABILITIES.SYSTEM_ADMIN_SETTINGS),
  MASTER: ALL_CAPABILITIES.filter(c => c !== CAPABILITIES.SYSTEM_ADMIN_ACCESS && c !== CAPABILITIES.SYSTEM_ADMIN_ROLE_CONFIG && c !== CAPABILITIES.SYSTEM_ADMIN_SETTINGS),
  BRANCH_ADMIN: [
    CAPABILITIES.BRANCH_DASHBOARD_VIEW,
    CAPABILITIES.BRANCH_CATALOG_VIEW,
    CAPABILITIES.BRANCH_INVENTORY_VIEW,
    CAPABILITIES.SALES_VIEW,
    CAPABILITIES.CASH_PAYMENTS_VIEW,
    CAPABILITIES.DISPATCH_VIEW,
    CAPABILITIES.APPROVAL_REQUEST_CREATE,
    CAPABILITIES.APPROVAL_REQUEST_REVIEW,
    CAPABILITIES.AUDIT_VIEW,
    CAPABILITIES.REPORTS_EXPORT,
  ],
  SALES: [
    CAPABILITIES.BRANCH_DASHBOARD_VIEW,
    CAPABILITIES.BRANCH_CATALOG_VIEW,
    CAPABILITIES.SALES_VIEW,
    CAPABILITIES.SALES_DRAFT_MANAGE,
    CAPABILITIES.SALES_SUBMIT_PAYMENT,
    CAPABILITIES.APPROVAL_REQUEST_CREATE,
  ],
  CASHIER: [
    CAPABILITIES.BRANCH_DASHBOARD_VIEW,
    CAPABILITIES.CASH_PAYMENTS_VIEW,
    CAPABILITIES.CASH_PAYMENTS_COLLECT,
    CAPABILITIES.CASH_SESSION_OPERATE,
    CAPABILITIES.APPROVAL_REQUEST_CREATE,
  ],
  WAREHOUSE: [
    CAPABILITIES.BRANCH_DASHBOARD_VIEW,
    CAPABILITIES.BRANCH_INVENTORY_VIEW,
    CAPABILITIES.INVENTORY_MOVEMENT_POST,
    CAPABILITIES.DISPATCH_VIEW,
    CAPABILITIES.DISPATCH_MARK,
    CAPABILITIES.APPROVAL_REQUEST_CREATE,
  ],
};

export function can(roleCode: RoleCode, capability: Capability): boolean {
  return ROLE_CAPABILITIES[roleCode]?.includes(capability) ?? false;
}

type CapabilitySession = Pick<SessionPayload, "globalRoles" | "branchMemberships"> | null;

export function canInBranch(session: CapabilitySession, branchId: string, capability: Capability): boolean {
  if (!session || !branchId) return false;
  if (session.globalRoles.includes("SYSTEM_ADMIN")) return can("SYSTEM_ADMIN", capability);
  if (session.globalRoles.includes("OWNER")) return can("OWNER", capability);
  if (session.globalRoles.includes("MASTER")) return can("MASTER", capability);

  return session.branchMemberships
    .filter((membership) => membership.branchId === branchId)
    .some((membership) => can(membership.roleCode, capability));
}

export function canInAnyAssignedBranch(session: CapabilitySession, capability: Capability): boolean {
  if (!session) return false;
  if (session.globalRoles.includes("SYSTEM_ADMIN")) return can("SYSTEM_ADMIN", capability);
  if (session.globalRoles.includes("OWNER")) return can("OWNER", capability);
  if (session.globalRoles.includes("MASTER")) return can("MASTER", capability);

  return session.branchMemberships.some((membership) => can(membership.roleCode, capability));
}
