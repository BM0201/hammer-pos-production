import type { RoleCode } from "@prisma/client";
import type { Route } from "next";
import type { SessionPayload } from "@/types/auth";
import { canInAnyAssignedBranch, type Capability } from "@/modules/rbac/policies";
import { resolveRoleHome, isMasterOrAbove, isOwnerRole, isSystemAdminRole, isAccountantRole } from "@/modules/rbac/role-routing";
import {
  canUseBranchCapability,
  requireEffectiveBranchCapability,
  getBranchIdsWithEffectiveCapability,
} from "@/modules/rbac/effective-permissions";

export function isMaster(session: SessionPayload | null): boolean {
  return Boolean(session && isMasterOrAbove(session.roleCode as string, session.globalRoles as unknown as string[]));
}

export function isOwner(session: SessionPayload | null): boolean {
  return Boolean(
    session &&
      (isOwnerRole(session.roleCode as string, session.globalRoles as unknown as string[]) ||
        isSystemAdminRole(session.roleCode as string, session.globalRoles as unknown as string[])),
  );
}

export function isSystemAdmin(session: SessionPayload | null): boolean {
  return Boolean(session && isSystemAdminRole(session.roleCode as string, session.globalRoles as unknown as string[]));
}

/** Contador — rol global de solo-contabilidad. */
export function isAccountant(session: SessionPayload | null): boolean {
  return Boolean(session && isAccountantRole(session.roleCode as string, session.globalRoles as unknown as string[]));
}

/**
 * ¿Puede el usuario acceder al módulo de Finanzas & Contabilidad?
 * Verdadero para Master/Owner/SystemAdmin (control total) y para el Contador.
 */
export function isFinanceUser(session: SessionPayload | null): boolean {
  return isMaster(session) || isAccountant(session);
}

export function isPrivilegedGlobal(session: SessionPayload | null): boolean {
  return isMaster(session) || isOwner(session) || isSystemAdmin(session);
}

export function canInBranch(session: SessionPayload | null, branchId: string, capability: Capability): boolean {
  // Uses effective permissions (memberships already filtered by BranchRoleConfig at login)
  return canUseBranchCapability(session, branchId, capability);
}

export function requireBranchCapability(session: SessionPayload | null, branchId: string, capability: Capability): void {
  if (!session) throw new Error("FORBIDDEN_BRANCH");
  requireEffectiveBranchCapability(session, branchId, capability);
}

export function requireAnyBranchCapability(session: SessionPayload | null, capabilities: Capability[]): void {
  if (!session || capabilities.length === 0) {
    throw new Error("FORBIDDEN_CAPABILITY");
  }

  const allowed = capabilities.some((capability) => canInAnyAssignedBranch(session, capability));
  if (!allowed) {
    throw new Error("FORBIDDEN_CAPABILITY");
  }
}

export function getBranchIdsWithCapability(session: SessionPayload | null, capability: Capability): string[] {
  return getBranchIdsWithEffectiveCapability(session, capability);
}

export function hasCapabilityInAnyAssignedBranch(session: SessionPayload | null, capability: Capability): boolean {
  return canInAnyAssignedBranch(session, capability);
}

export function hasBranchAccess(session: SessionPayload | null, branchId: string): boolean {
  if (!session) return false;
  if (isPrivilegedGlobal(session)) return true;
  return session.branchMemberships.some((item) => item.branchId === branchId);
}

export function hasBranchRole(session: SessionPayload | null, branchId: string, allowedRoles: RoleCode[]): boolean {
  if (!session) return false;
  if (isPrivilegedGlobal(session)) return true;
  return session.branchMemberships.some((item) => item.branchId === branchId && allowedRoles.includes(item.roleCode));
}

export function hasAnyAssignedBranch(session: SessionPayload | null): boolean {
  if (!session) return false;
  if (isPrivilegedGlobal(session)) return true;
  return session.branchMemberships.length > 0;
}

export function getRoleAwareHome(roleCode: RoleCode, globalRoles?: RoleCode[]): Route {
  return resolveRoleHome(roleCode as string, (globalRoles as unknown as string[] | undefined) ?? []);
}
