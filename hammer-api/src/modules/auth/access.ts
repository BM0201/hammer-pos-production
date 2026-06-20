import type { SessionPayload } from "@/types/auth";
import { hasBranchAccess, isMaster, isOwner, isSystemAdmin } from "@/modules/rbac/guards";

export function assertAuthenticated(session: SessionPayload | null): asserts session is SessionPayload {
  if (!session) {
    throw new Error("UNAUTHENTICATED");
  }
}

export function assertBranchAccess(session: SessionPayload, branchId: string): void {
  if (!hasBranchAccess(session, branchId)) {
    throw new Error("FORBIDDEN_BRANCH");
  }
}

export function assertMaster(session: SessionPayload): void {
  if (!isMaster(session)) {
    throw new Error("FORBIDDEN_MASTER_ONLY");
  }
}

export function assertOwner(session: SessionPayload): void {
  if (!isOwner(session)) {
    throw new Error("FORBIDDEN_OWNER_ONLY");
  }
}

export function assertSystemAdmin(session: SessionPayload): void {
  if (!isSystemAdmin(session)) {
    throw new Error("FORBIDDEN_SYSTEM_ADMIN_ONLY");
  }
}
