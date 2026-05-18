import type { RoleCode } from "@prisma/client";
import { prisma, MissingDatabaseUrlError } from "@/lib/prisma";
import { env, envStatus, logRuntimeEnvWarnings } from "@/lib/env";
import { verifyPassword } from "@/modules/auth/password";
import { buildSessionPayload, decodeSession, encodeSession, makeSessionCookieName } from "@/modules/auth/session";
import { cookies } from "next/headers";
import type { SessionPayload } from "@/types/auth";
import { logAuditEvent } from "@/modules/audit/service";
import { isTokenRevoked } from "@/modules/security/token-revocation";
import { getEffectiveBranchMemberships } from "@/modules/rbac/effective-permissions";

export async function authenticate(username: string, password: string): Promise<{ token: string; role: RoleCode; mustChangePassword: boolean } | null> {
  if (!envStatus.hasDatabaseUrl) {
    logRuntimeEnvWarnings();
    throw new MissingDatabaseUrlError();
  }

  if (!envStatus.hasAuthSessionSecret) {
    logRuntimeEnvWarnings();
    throw new Error("AUTH_SESSION_SECRET_MISSING");
  }

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

  // Filter memberships through BranchRoleConfig (disabled roles are excluded)
  const branchMemberships = await getEffectiveBranchMemberships(user.id);
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
    sessionVersion: user.sessionVersion ?? 0,
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
    sameSite: "lax",
    path: "/",
    maxAge: env.AUTH_SESSION_TTL_HOURS * 60 * 60, // Match token TTL
  });
}

export async function clearSessionCookie(): Promise<void> {
  const store = await cookies();
  store.set(makeSessionCookieName(), "", {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
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

  // Check token revocation and sessionVersion when DB is available.
  // If DB is unavailable, degrade gracefully instead of crashing pages.
  try {
    const revoked = await isTokenRevoked(raw);
    if (revoked) {
      return null;
    }

    // ── sessionVersion check ──
    // Verify the token's sessionVersion matches the current DB value.
    // If the user changed password, roles were modified, or an admin
    // explicitly revoked sessions, sessionVersion will have been
    // incremented and this token becomes invalid.
    const user = await prisma.user.findUnique({
      where: { id: session.userId },
      select: { sessionVersion: true, isActive: true },
    });

    if (!user) {
      return null; // User deleted
    }

    if (!user.isActive) {
      return null; // User deactivated
    }

    if ((session.sessionVersion ?? 0) !== (user.sessionVersion ?? 0)) {
      return null; // Session invalidated by version mismatch
    }
  } catch {
    logRuntimeEnvWarnings();
  }

  return session;
}

export function getRawSessionToken(): string | undefined {
  // Note: This is a sync helper for getting the raw token for revocation
  // Cannot use await cookies() here - callers should get the cookie value directly
  return undefined;
}
