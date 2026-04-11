import type { RoleCode } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { env } from "@/lib/env";
import { verifyPassword } from "@/modules/auth/password";
import { buildSessionPayload, decodeSession, encodeSession, makeSessionCookieName } from "@/modules/auth/session";
import { cookies } from "next/headers";
import type { SessionPayload } from "@/types/auth";
import { logAuditEvent } from "@/modules/audit/service";
import { isTokenRevoked } from "@/modules/security/token-revocation";

export async function authenticate(username: string, password: string): Promise<{ token: string; role: RoleCode; mustChangePassword: boolean } | null> {
  const user = await prisma.user.findUnique({
    where: { username },
    include: { userBranchRoles: { where: { isActive: true } } },
  });

  if (!user || !user.isActive) {
    await logAuditEvent({
      module: "auth",
      action: "LOGIN_FAILURE",
      entityType: "User",
      entityId: username,
      metadataJson: { reason: "USER_NOT_FOUND_OR_INACTIVE" },
    });
    return null;
  }

  const valid = verifyPassword(password, user.passwordHash);
  if (!valid) {
    await logAuditEvent({
      actorUserId: user.id,
      module: "auth",
      action: "LOGIN_FAILURE",
      entityType: "User",
      entityId: user.id,
      metadataJson: { reason: "INVALID_PASSWORD" },
    });
    return null;
  }

  const branchRoles = user.userBranchRoles;
  const sortedMemberships = [...branchRoles].sort((a, b) => a.assignedAt.getTime() - b.assignedAt.getTime());
  const branchMemberships = sortedMemberships.map((item) => ({
    branchId: item.branchId,
    roleCode: item.roleCode,
  }));
  const branchIds = Array.from(new Set(branchMemberships.map((item) => item.branchId)));
  const globalRoles = user.globalRole ? [user.globalRole] : [];
  const primaryBranchId = branchMemberships[0]?.branchId ?? null;
  const derivedRole = user.globalRole === "SYSTEM_ADMIN"
    ? "SYSTEM_ADMIN"
    : user.globalRole === "OWNER"
    ? "OWNER"
    : user.globalRole === "MASTER"
    ? "MASTER"
    : branchMemberships[0]?.roleCode;

  if (!derivedRole) {
    await logAuditEvent({
      actorUserId: user.id,
      module: "auth",
      action: "LOGIN_FAILURE",
      entityType: "User",
      entityId: user.id,
      metadataJson: { reason: "NO_ACTIVE_BRANCH_ROLE" },
    });
    return null;
  }

  const payload = buildSessionPayload({
    userId: user.id,
    username: user.username,
    globalRoles,
    branchMemberships,
    primaryBranchId,
    roleCode: derivedRole,
    branchIds,
  });

  const token = encodeSession(payload);

  await logAuditEvent({
    actorUserId: user.id,
    module: "auth",
    action: "LOGIN_SUCCESS",
    entityType: "User",
    entityId: user.id,
    metadataJson: { role: derivedRole },
  });

  return { token, role: derivedRole, mustChangePassword: user.mustChangePassword };
}

export async function setSessionCookie(token: string): Promise<void> {
  const store = await cookies();
  store.set(makeSessionCookieName(), token, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "strict",
    path: "/",
    maxAge: env.AUTH_SESSION_TTL_HOURS * 60 * 60, // Match token TTL
  });
}

export async function clearSessionCookie(): Promise<void> {
  const store = await cookies();
  store.set(makeSessionCookieName(), "", {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "strict",
    path: "/",
    maxAge: 0,
  });
}

export async function getCurrentSession(): Promise<SessionPayload | null> {
  const store = await cookies();
  const raw = store.get(makeSessionCookieName())?.value;
  if (!raw) {
    return null;
  }

  const session = decodeSession(raw);
  if (!session) {
    return null;
  }

  // Check token revocation
  const revoked = await isTokenRevoked(raw);
  if (revoked) {
    return null;
  }

  return session;
}

export function getRawSessionToken(): string | undefined {
  // Note: This is a sync helper for getting the raw token for revocation
  // Cannot use await cookies() here - callers should get the cookie value directly
  return undefined;
}
