/**
 * ════════════════════════════════════════════════════════════════
 * PRODUCTION PERMISSION GUARD
 *
 * Checks granular production permissions combining:
 * 1. Role-based permissions (from RBAC policies)
 * 2. User-level overrides (from UserPermission table)
 *
 * Usage in API routes:
 *   await assertProductionPermission(session, "production.recipes.view");
 * ════════════════════════════════════════════════════════════════
 */

import type { RoleCode } from "@prisma/client";
import type { SessionPayload } from "@/types/auth";
import { prisma } from "@/lib/prisma";
import { getPermissionsForRole, type PermissionKey } from "@/modules/rbac/permissions";

/** Production permission string type */
export type ProductionPermission =
  | "production.recipes.view"
  | "production.recipes.create"
  | "production.recipes.edit"
  | "production.batches.view"
  | "production.batches.create"
  | "production.batches.complete"
  | "production.cost.view"
  | "production.dashboard.view";

/** All valid production permission strings */
export const PRODUCTION_PERMISSIONS: readonly ProductionPermission[] = [
  "production.recipes.view",
  "production.recipes.create",
  "production.recipes.edit",
  "production.batches.view",
  "production.batches.create",
  "production.batches.complete",
  "production.cost.view",
  "production.dashboard.view",
] as const;

function isProductionMaster(session: SessionPayload): boolean {
  return session.roleCode === "MASTER" || session.globalRoles.includes("MASTER");
}

/**
 * Check if a user has a specific production permission.
 *
 * Resolution order:
 * 1. Check UserPermission table for explicit grant/revoke
 * 2. Fall back to role-based permission from RBAC policies
 */
export async function hasProductionPermission(
  session: SessionPayload | null,
  permission: ProductionPermission,
): Promise<boolean> {
  if (!session) return false;
  if (!isProductionMaster(session)) return false;

  // 1. Check user-level override in DB
  const userOverride = await prisma.userPermission.findUnique({
    where: { userId_permission: { userId: session.userId, permission } },
    select: { granted: true },
  });

  if (userOverride !== null) {
    return userOverride.granted;
  }

  // 2. Fall back to role-based permission
  const roleCode = session.roleCode as RoleCode;
  const rolePerms = getPermissionsForRole(roleCode);
  return rolePerms.includes(permission as PermissionKey);
}

/**
 * Assert that the current user has a production permission.
 * Throws "FORBIDDEN_PRODUCTION" if not authorized.
 */
export async function assertProductionPermission(
  session: SessionPayload | null,
  permission: ProductionPermission,
): Promise<void> {
  const allowed = await hasProductionPermission(session, permission);
  if (!allowed) {
    const error = new Error(
      `FORBIDDEN_PRODUCTION: Missing permission "${permission}"`,
    );
    error.name = "FORBIDDEN_PRODUCTION";
    throw error;
  }
}

/**
 * Get all production permissions for a user (combining role + overrides).
 * Useful for sending to frontend to show/hide UI elements.
 */
export async function getUserProductionPermissions(
  session: SessionPayload | null,
): Promise<Record<ProductionPermission, boolean>> {
  const result: Record<string, boolean> = {};

  if (!session || !isProductionMaster(session)) {
    for (const p of PRODUCTION_PERMISSIONS) result[p] = false;
    return result as Record<ProductionPermission, boolean>;
  }

  // Get role-based defaults
  const roleCode = session.roleCode as RoleCode;
  const rolePerms = getPermissionsForRole(roleCode);

  for (const p of PRODUCTION_PERMISSIONS) {
    result[p] = rolePerms.includes(p as PermissionKey);
  }

  // Apply user-level overrides
  const overrides = await prisma.userPermission.findMany({
    where: {
      userId: session.userId,
      permission: { in: [...PRODUCTION_PERMISSIONS] },
    },
    select: { permission: true, granted: true },
  });

  for (const o of overrides) {
    result[o.permission] = o.granted;
  }

  return result as Record<ProductionPermission, boolean>;
}
