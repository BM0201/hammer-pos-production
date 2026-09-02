/**
 * ── Centralized RBAC Helpers ──
 *
 * All role/branch assertions that API routes need, in one place.
 * Import these instead of writing manual `session.globalRoles.includes(…)` checks.
 *
 * Hierarchy (descending privilege):
 *  1. SYSTEM_ADMIN – full system access, manages platform config
 *  2. OWNER        – business owner, all operational access
 *  3. MASTER       – operational admin, all branches
 *  4. BRANCH_ADMIN – manager of assigned branch(es)
 *  5. SALES        – sales operations in assigned branch(es)
 *  6. CASHIER      – cash operations in assigned branch(es)
 *  7. WAREHOUSE    – warehouse/dispatch in assigned branch(es)
 *
 * Global roles (SYSTEM_ADMIN, OWNER, MASTER) bypass branch membership checks.
 */

import type { SessionPayload } from "@/types/auth";
import { isMaster, isOwner, isFinanceUser, hasBranchAccess } from "@/modules/rbac/guards";

// ── Assertion helpers (throw on failure) ──

export function assertOwner(session: SessionPayload): void {
  if (!isOwner(session)) {
    throw new Error("FORBIDDEN_OWNER_ONLY");
  }
}

export function assertMaster(session: SessionPayload): void {
  if (!isMaster(session)) {
    throw new Error("FORBIDDEN_MASTER_ONLY");
  }
}

export function assertFinanceAccess(session: SessionPayload): void {
  if (!isFinanceUser(session)) {
    throw new Error("FORBIDDEN_FINANCE_ONLY");
  }
}

export function assertBranchAccess(session: SessionPayload, branchId: string): void {
  if (!hasBranchAccess(session, branchId)) {
    throw new Error("FORBIDDEN_BRANCH");
  }
}

/**
 * Returns true if the session has a global privileged role.
 */
export { isPrivilegedGlobal } from "@/modules/rbac/guards";
