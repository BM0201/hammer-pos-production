// Frontend-local copy of policies (decoupled from @prisma/client).
// Must stay in sync with backend src/modules/rbac/policies.ts
import type { RoleCode, SessionPayload } from "@/types/auth";

export const CAPABILITIES = {
  SYSTEM_ADMIN_ACCESS: "system.admin.access",
  SYSTEM_ADMIN_ROLE_CONFIG: "system.admin.role.config",
  SYSTEM_ADMIN_SETTINGS: "system.admin.settings",
  MASTER_ACCESS: "master.access",
  MASTER_DASHBOARD_VIEW: "master.dashboard.view",
  MASTER_USERS_VIEW: "master.users.view",
  MASTER_USERS_MANAGE: "master.users.manage",
  MASTER_SESSIONS_VIEW: "master.sessions.view",
  MASTER_CASH_MONITOR_VIEW: "master.cash_monitor.view",
  MASTER_CATALOG_MANAGE: "master.catalog.manage",
  MASTER_INVENTORY_VIEW: "master.inventory.view",
  MASTER_SALES_VIEW: "master.sales.view",
  POS_VIEW: "pos.view",
  POS_SELL: "pos.sell",
  POS_PRINT: "pos.print",
  CASH_VIEW: "cash.view",
  CASH_OPEN: "cash.open",
  CASH_CHARGE: "cash.charge",
  CASH_CLOSE: "cash.close",
  CASH_SESSION_MANAGE: "cash.session.manage",
  WAREHOUSE_VIEW: "warehouse.view",
  INVENTORY_VIEW: "inventory.view",
  INVENTORY_ADJUST: "inventory.adjust",
  INVENTORY_OPENING_BALANCE: "inventory.opening_balance",
  INVENTORY_IMPORT: "inventory.import",
  PRICING_VIEW: "pricing.view",
  PRICING_EDIT_BRANCH: "pricing.edit.branch",
  PRICING_EDIT_GLOBAL: "pricing.edit.global",
  PURCHASES_VIEW: "purchases.view",
  PURCHASES_CREATE: "purchases.create",
  PURCHASES_APPROVE: "purchases.approve",
  PURCHASES_RECEIVE: "purchases.receive",
  TRANSFERS_VIEW: "transfers.view",
  TRANSFERS_CREATE: "transfers.create",
  TRANSFERS_APPROVE: "transfers.approve",
  TRANSFERS_DISPATCH: "transfers.dispatch",
  TRANSFERS_RECEIVE: "transfers.receive",
  PRODUCTION_VIEW: "production.view",
  PRODUCTION_RECIPES_MANAGE: "production.recipes.manage",
  BRAIN_VIEW: "brain.view",
  BRAIN_ACTIONS_MANAGE: "brain.actions.manage",
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
  CASH_REVIEW: "cash.review",
  CASH_AUTO_CLOSE_REVIEW: "cash.auto_close.review",
  OPERATIONS_VIEW: "operations.view",
  OPERATIONS_MANAGE: "operations.manage",
  OPERATIONAL_DAY_OPEN: "operations.day.open",
  OPERATIONAL_DAY_CLOSE: "operations.day.close",
  DISPATCH_VIEW: "dispatch.view",
  DISPATCH_MARK: "dispatch.mark",
  APPROVAL_REQUEST_CREATE: "approval.request.create",
  APPROVAL_REQUEST_REVIEW: "approval.request.review",
  AUDIT_VIEW: "audit.view",
  REPORTS_EXPORT: "reports.export",

  // Production
  PRODUCTION_RECIPES_VIEW: "production.recipes.view",
  PRODUCTION_RECIPES_CREATE: "production.recipes.create",
  PRODUCTION_RECIPES_EDIT: "production.recipes.edit",
  PRODUCTION_BATCHES_VIEW: "production.batches.view",
  PRODUCTION_BATCHES_CREATE: "production.batches.create",
  PRODUCTION_BATCHES_COMPLETE: "production.batches.complete",
  PRODUCTION_COST_VIEW: "production.cost.view",
  PRODUCTION_DASHBOARD_VIEW: "production.dashboard.view",

  // ── Documentos e Impresión (FASE 3) ──
  DOCUMENT_PRINT: "document.print",
  DOCUMENT_REPRINT: "document.reprint",
  DOCUMENT_SKIP_PRINT: "document.skip.print",
  DOCUMENT_TEMPLATE_MANAGE: "document.template.manage",
  MANUAL_INVOICE_REGISTER: "manual.invoice.register",
  MANUAL_INVOICE_CANCEL: "manual.invoice.cancel",
  PRINT_SETTINGS_MANAGE: "print.settings.manage",
  PRINT_LOG_VIEW: "print.log.view",
  SALES_HISTORY_VIEW: "sales.history.view",
  MASTER_HISTORY_VIEW: "master.history.view",
} as const;

export type Capability = (typeof CAPABILITIES)[keyof typeof CAPABILITIES];

const ALL_CAPABILITIES = Object.values(CAPABILITIES);

const ROLE_CAPABILITIES: Record<RoleCode, Capability[]> = {
  SYSTEM_ADMIN: ALL_CAPABILITIES.filter(c => !c.startsWith("production.")),
  OWNER: ALL_CAPABILITIES.filter(c => c !== CAPABILITIES.SYSTEM_ADMIN_ACCESS && c !== CAPABILITIES.SYSTEM_ADMIN_ROLE_CONFIG && c !== CAPABILITIES.SYSTEM_ADMIN_SETTINGS && !c.startsWith("production.")),
  MASTER: ALL_CAPABILITIES.filter(c => c !== CAPABILITIES.SYSTEM_ADMIN_ACCESS && c !== CAPABILITIES.SYSTEM_ADMIN_ROLE_CONFIG && c !== CAPABILITIES.SYSTEM_ADMIN_SETTINGS),
  BRANCH_ADMIN: [
    CAPABILITIES.POS_VIEW,
    CAPABILITIES.POS_SELL,
    CAPABILITIES.POS_PRINT,
    CAPABILITIES.BRANCH_DASHBOARD_VIEW,
    CAPABILITIES.BRANCH_CATALOG_VIEW,
    CAPABILITIES.BRANCH_INVENTORY_VIEW,
    CAPABILITIES.SALES_VIEW,
    CAPABILITIES.SALES_DRAFT_MANAGE,
    CAPABILITIES.SALES_SUBMIT_PAYMENT,
    CAPABILITIES.CASH_PAYMENTS_VIEW,
    CAPABILITIES.CASH_PAYMENTS_COLLECT,
    CAPABILITIES.CASH_SESSION_OPERATE,
    CAPABILITIES.CASH_REVIEW,
    CAPABILITIES.CASH_AUTO_CLOSE_REVIEW,
    CAPABILITIES.OPERATIONS_VIEW,
    CAPABILITIES.OPERATIONS_MANAGE,
    CAPABILITIES.OPERATIONAL_DAY_OPEN,
    CAPABILITIES.OPERATIONAL_DAY_CLOSE,
    CAPABILITIES.DISPATCH_VIEW,
    CAPABILITIES.APPROVAL_REQUEST_CREATE,
    CAPABILITIES.APPROVAL_REQUEST_REVIEW,
    CAPABILITIES.AUDIT_VIEW,
    CAPABILITIES.REPORTS_EXPORT,
    // ── Documentos e Impresión (FASE 3) ──
    CAPABILITIES.DOCUMENT_PRINT,
    CAPABILITIES.DOCUMENT_REPRINT,
    CAPABILITIES.DOCUMENT_SKIP_PRINT,
    CAPABILITIES.MANUAL_INVOICE_REGISTER,
    CAPABILITIES.MANUAL_INVOICE_CANCEL,
    CAPABILITIES.PRINT_LOG_VIEW,
    CAPABILITIES.SALES_HISTORY_VIEW,
  ],
  SALES: [
    CAPABILITIES.BRANCH_DASHBOARD_VIEW,
    CAPABILITIES.BRANCH_CATALOG_VIEW,
    CAPABILITIES.SALES_VIEW,
    CAPABILITIES.SALES_DRAFT_MANAGE,
    CAPABILITIES.SALES_SUBMIT_PAYMENT,
    CAPABILITIES.APPROVAL_REQUEST_CREATE,
    // ── Documentos e Impresión (FASE 3) ──
    CAPABILITIES.DOCUMENT_PRINT,
    CAPABILITIES.DOCUMENT_SKIP_PRINT,
    CAPABILITIES.SALES_HISTORY_VIEW,
  ],
  CASHIER: [
    CAPABILITIES.BRANCH_DASHBOARD_VIEW,
    CAPABILITIES.CASH_PAYMENTS_VIEW,
    CAPABILITIES.CASH_PAYMENTS_COLLECT,
    CAPABILITIES.CASH_SESSION_OPERATE,
    CAPABILITIES.OPERATIONS_VIEW,
    CAPABILITIES.APPROVAL_REQUEST_CREATE,
    // ── Documentos e Impresión (FASE 3) ──
    CAPABILITIES.DOCUMENT_PRINT,
    CAPABILITIES.DOCUMENT_REPRINT,
    CAPABILITIES.MANUAL_INVOICE_REGISTER,
    CAPABILITIES.PRINT_LOG_VIEW,
  ],
  WAREHOUSE: [
    CAPABILITIES.BRANCH_DASHBOARD_VIEW,
    CAPABILITIES.BRANCH_INVENTORY_VIEW,
    CAPABILITIES.INVENTORY_MOVEMENT_POST,
    CAPABILITIES.DISPATCH_VIEW,
    CAPABILITIES.DISPATCH_MARK,
    CAPABILITIES.OPERATIONS_VIEW,
    CAPABILITIES.APPROVAL_REQUEST_CREATE,
    // ── Documentos (FASE 3) ──
    CAPABILITIES.DOCUMENT_PRINT,
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
