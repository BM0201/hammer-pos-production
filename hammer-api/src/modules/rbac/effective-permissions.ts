/**
 * ════════════════════════════════════════════════════════════════
 * EFFECTIVE PERMISSIONS MODULE
 *
 * Makes BranchRoleConfig the real permission gate for branch-scoped roles.
 * Global roles (SYSTEM_ADMIN, OWNER, MASTER) bypass these checks.
 *
 * Rules:
 * - SYSTEM_ADMIN, OWNER, MASTER retain global access always.
 * - Branch roles (BRANCH_ADMIN, SALES, CASHIER, WAREHOUSE) must:
 *   1. Be an authenticated user
 *   2. Have an active UserBranchRole
 *   3. BranchRoleConfig enabled for that branch+role
 *   4. Capability allowed by policy
 * - If no BranchRoleConfig row exists → default: enabled (backward compat)
 * ════════════════════════════════════════════════════════════════
 */

import type { RoleCode } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import type { SessionPayload, BranchMembership } from "@/types/auth";
import { can, type Capability } from "@/modules/rbac/policies";

/** Global roles that bypass BranchRoleConfig checks */
const GLOBAL_ROLES: ReadonlySet<string> = new Set(["SYSTEM_ADMIN", "OWNER", "MASTER"]);

/** Branch-scoped roles that can be governed by BranchRoleConfig */
const BRANCH_SCOPED_ROLES: ReadonlySet<string> = new Set(["BRANCH_ADMIN", "SALES", "CASHIER", "WAREHOUSE"]);

function isGlobalRole(session: SessionPayload): boolean {
  return session.globalRoles.some((r) => GLOBAL_ROLES.has(r));
}

// ─── DB Queries ─────────────────────────────────────────────────

/**
 * Check if a specific branch+role combo is enabled via BranchRoleConfig.
 * Returns true if no config row exists (default: enabled for backward compat).
 */
export async function isBranchRoleEnabled(branchId: string, roleCode: RoleCode): Promise<boolean> {
  if (!BRANCH_SCOPED_ROLES.has(roleCode)) return true;

  const config = await prisma.branchRoleConfig.findUnique({
    where: { branchId_role: { branchId, role: roleCode } },
    select: { enabled: true },
  });

  return config?.enabled ?? true; // default: enabled
}

/**
 * Get all effective (filtered by BranchRoleConfig) branch memberships for a user.
 * Used at login to filter disabled roles out of the session token.
 */
export async function getEffectiveBranchMemberships(userId: string): Promise<BranchMembership[]> {
  const userBranchRoles = await prisma.userBranchRole.findMany({
    where: { userId, isActive: true },
    select: { branchId: true, roleCode: true },
  });

  if (userBranchRoles.length === 0) return [];

  // Fetch all relevant BranchRoleConfig rows in one query
  const branchIds = [...new Set(userBranchRoles.map((r) => r.branchId))];
  const configs = await prisma.branchRoleConfig.findMany({
    where: { branchId: { in: branchIds } },
    select: { branchId: true, role: true, enabled: true },
  });

  const configMap = new Map<string, boolean>();
  for (const c of configs) {
    configMap.set(`${c.branchId}:${c.role}`, c.enabled);
  }

  return userBranchRoles.filter((ubr) => {
    if (!BRANCH_SCOPED_ROLES.has(ubr.roleCode)) return true;
    const key = `${ubr.branchId}:${ubr.roleCode}`;
    return configMap.get(key) ?? true; // default: enabled
  }).map((ubr) => ({
    branchId: ubr.branchId,
    roleCode: ubr.roleCode,
  }));
}

// ─── Session-Based Checks (sync, use session.branchMemberships) ────

/**
 * Can the session use a specific role in a specific branch?
 * Checks session memberships (already filtered at login) + capability policy.
 */
export function canUseBranchRole(
  session: SessionPayload | null,
  branchId: string,
  roleCode: RoleCode,
): boolean {
  if (!session) return false;
  if (isGlobalRole(session)) return true;

  return session.branchMemberships.some(
    (m) => m.branchId === branchId && m.roleCode === roleCode,
  );
}

/**
 * Can the session use a specific capability in a specific branch?
 * Integrates BranchRoleConfig awareness through filtered memberships.
 */
export function canUseBranchCapability(
  session: SessionPayload | null,
  branchId: string,
  capability: Capability,
): boolean {
  if (!session) return false;
  if (isGlobalRole(session)) {
    // Global roles always have all capabilities
    return can("SYSTEM_ADMIN", capability);
  }

  return session.branchMemberships
    .filter((m) => m.branchId === branchId)
    .some((m) => can(m.roleCode, capability));
}

/**
 * Throws FORBIDDEN_CAPABILITY if the session cannot use the capability in the given branch.
 */
export function requireEffectiveBranchCapability(
  session: SessionPayload | null,
  branchId: string,
  capability: Capability,
): void {
  if (!canUseBranchCapability(session, branchId, capability)) {
    throw new Error("FORBIDDEN_CAPABILITY");
  }
}

/**
 * Get branch IDs where the session has an effective capability.
 * Returns empty array for global roles (meaning "all branches").
 */
export function getBranchIdsWithEffectiveCapability(
  session: SessionPayload | null,
  capability: Capability,
): string[] {
  if (!session) return [];
  if (isGlobalRole(session)) return []; // empty = no filter (all branches)

  return session.branchMemberships
    .filter((m) => can(m.roleCode, capability))
    .map((m) => m.branchId);
}
