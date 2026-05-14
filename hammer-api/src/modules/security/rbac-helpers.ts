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
import { isPrivilegedGlobal, isMaster, isOwner, isSystemAdmin, hasBranchAccess } from "@/modules/rbac/guards";

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

export function assertSystemAdmin(session: SessionPayload): void {
  if (!isSystemAdmin(session)) {
    throw new Error("FORBIDDEN_SYSTEM_ADMIN_ONLY");
  }
}

export function assertOwnerOrSystemAdmin(session: SessionPayload): void {
  if (!isOwner(session) && !isSystemAdmin(session)) {
    throw new Error("FORBIDDEN_OWNER_OR_SYSTEM_ADMIN_ONLY");
  }
}

export function assertBranchAccess(session: SessionPayload, branchId: string): void {
  if (!hasBranchAccess(session, branchId)) {
    throw new Error("FORBIDDEN_BRANCH");
  }
}

// ── Query helpers ──

/**
 * Returns the set of branchIds the user is allowed to see/operate on.
 *
 * - Global roles → returns `requestedBranchId` wrapped in an array (or empty
 *   array meaning "no filter") so callers can do `where: { branchId: { in: ids } }`.
 * - Branch-scoped users → returns only their assigned branchIds, optionally
 *   filtered to `requestedBranchId` (throws if they don't have access).
 */
export function getAllowedBranchIds(
  session: SessionPayload,
  requestedBranchId?: string | null,
): string[] {
  // Global roles have access to all branches
  if (isPrivilegedGlobal(session)) {
    return requestedBranchId ? [requestedBranchId] : []; // empty = no filter
  }

  const userBranchIds = session.branchMemberships.map((m) => m.branchId);

  if (requestedBranchId) {
    if (!userBranchIds.includes(requestedBranchId)) {
      throw new Error("FORBIDDEN_BRANCH");
    }
    return [requestedBranchId];
  }

  return userBranchIds;
}

/**
 * Checks whether a user can access a specific branch (boolean, no throw).
 */
export function canAccessBranch(session: SessionPayload, branchId: string): boolean {
  return hasBranchAccess(session, branchId);
}

/**
 * Returns true if the session has a global privileged role.
 */
export { isPrivilegedGlobal } from "@/modules/rbac/guards";
