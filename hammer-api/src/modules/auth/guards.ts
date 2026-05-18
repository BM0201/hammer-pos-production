import { redirect } from "next/navigation";
import { getCurrentSession } from "@/modules/auth/service";
import type { RoleCode } from "@prisma/client";
import { hasAnyAssignedBranch, hasBranchAccess, hasBranchRole, isMaster } from "@/modules/rbac/guards";
import { canInAnyAssignedBranch, canInBranch, type Capability } from "@/modules/rbac/policies";

export async function requireSession() {
  const session = await getCurrentSession();
  if (!session) {
    redirect("/login");
  }
  return session;
}

export async function requireMaster() {
  const session = await requireSession();
  if (!isMaster(session)) {
    redirect("/forbidden");
  }
  return session;
}

export async function requireBranchAccess(branchId: string) {
  const session = await requireSession();
  if (!hasBranchAccess(session, branchId)) {
    redirect("/forbidden");
  }
  return session;
}

export async function requireAnyAssignedBranch() {
  const session = await requireSession();
  if (!hasAnyAssignedBranch(session)) {
    redirect("/forbidden");
  }
  return session;
}

export async function requireBranchRole(branchId: string, allowedRoles: RoleCode[]) {
  const session = await requireSession();
  if (!hasBranchRole(session, branchId, allowedRoles)) {
    redirect("/forbidden");
  }
  return session;
}

export async function requireCapabilityInBranch(branchId: string, capability: Capability) {
  const session = await requireSession();
  if (!canInBranch(session, branchId, capability)) {
    redirect("/forbidden");
  }
  return session;
}

export async function requireCapabilityInAnyAssignedBranch(capability: Capability) {
  const session = await requireSession();
  if (!canInAnyAssignedBranch(session, capability)) {
    redirect("/forbidden");
  }
  return session;
}
