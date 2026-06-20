import type { RoleCode } from "@prisma/client";
import { createHash } from "node:crypto";
import { prisma, MissingDatabaseUrlError } from "@/lib/prisma";
import { env, envStatus, logRuntimeEnvWarnings } from "@/lib/env";
import { verifyPassword } from "@/modules/auth/password";
import { buildSessionPayload, decodeSession, encodeSession, makeSessionCookieName } from "@/modules/auth/session";
import { cookies } from "next/headers";
import type { SessionPayload } from "@/types/auth";
import { logAuditEvent } from "@/modules/audit/service";
import { isTokenRevoked } from "@/modules/security/token-revocation";
import { getEffectiveBranchMemberships } from "@/modules/rbac/effective-permissions";
import { MFA_REQUIRED_ROLES, createMfaPendingToken } from "@/modules/auth/mfa-service";

function normalizeUsername(username: string) {
  return username.trim().toLowerCase();
}

type LoginAuditContext = {
  ipAddress?: string;
  userAgent?: string;
};

export type AuthenticateResult =
  | { mfaRequired: true; pendingToken: string; fullName: string }
  | { token: string; role: RoleCode; mustChangePassword: boolean; session: SessionPayload; fullName: string };

export async function authenticate(
  username: string,
  password: string,
  auditContext: LoginAuditContext = {},
): Promise<AuthenticateResult | null> {
  if (!envStatus.hasDatabaseUrl) {
    logRuntimeEnvWarnings();
    throw new MissingDatabaseUrlError();
  }

  if (!envStatus.hasAuthSessionSecret) {
    logRuntimeEnvWarnings();
    throw new Error("AUTH_SESSION_SECRET_MISSING");
  }

  const normalizedUsername = normalizeUsername(username);

  const user = await prisma.user.findFirst({
    where: {
      username: { equals: normalizedUsername, mode: "insensitive" },
      isActive: true,
      NOT: { username: { startsWith: "deleted-" } },
    },
    include: { userBranchRoles: { where: { isActive: true } } },
    orderBy: [{ username: "asc" }],
  });

  if (!user) {
    await logAuditEvent({
      module: "auth",
      action: "LOGIN_FAILURE",
      entityType: "User",
      entityId: normalizedUsername,
      metadataJson: { reason: "USER_NOT_FOUND_OR_INACTIVE" },
      ipAddress: auditContext.ipAddress,
      userAgent: auditContext.userAgent,
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
      ipAddress: auditContext.ipAddress,
      userAgent: auditContext.userAgent,
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
      ipAddress: auditContext.ipAddress,
      userAgent: auditContext.userAgent,
    });
    return null;
  }

  // MFA check — roles críticos con MFA activo deben completar el challenge antes de crear sesión
  const userMfaData = await prisma.user.findUnique({
    where: { id: user.id },
    select: { mfaEnabled: true },
  });

  const needsMfa =
    userMfaData?.mfaEnabled &&
    user.globalRole &&
    MFA_REQUIRED_ROLES.has(user.globalRole);

  if (needsMfa) {
    await logAuditEvent({
      actorUserId: user.id,
      module: "auth",
      action: "MFA_CHALLENGE_ISSUED",
      entityType: "User",
      entityId: user.id,
      metadataJson: { role: derivedRole },
      ipAddress: auditContext.ipAddress,
      userAgent: auditContext.userAgent,
    });
    const pendingToken = await createMfaPendingToken(user.id);
    return { mfaRequired: true, pendingToken, fullName: user.fullName };
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
    ipAddress: auditContext.ipAddress,
    userAgent: auditContext.userAgent,
  });

  return { token, role: derivedRole, mustChangePassword: user.mustChangePassword, session: payload, fullName: user.fullName };
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

// ── In-memory session cache ────────────────────────────────────────────────
// Avoids 2 DB reads (isTokenRevoked + sessionVersion) on every API request.
// TTL: 30 seconds — sessions revoked via sessionVersion increment are detected
// within one cache window (acceptable industry-standard tradeoff).
// Key: SHA-256 hash of the raw cookie token (never store raw tokens in memory).
const SESSION_CACHE_TTL_MS = 30_000;

type SessionCacheEntry = { payload: SessionPayload; expiresAt: number };
const _sessionCache = new Map<string, SessionCacheEntry>();

function _hashTokenForCache(raw: string): string {
  return createHash("sha256").update(raw).digest("hex");
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

  const cacheKey = _hashTokenForCache(raw);
  const cached = _sessionCache.get(cacheKey);
  if (cached && cached.expiresAt > Date.now()) {
    return cached.payload;
  }

  // Check token revocation and sessionVersion when DB is available.
  // If DB is unavailable, degrade gracefully instead of crashing pages.
  try {
    const revoked = await isTokenRevoked(raw);
    if (revoked) {
      _sessionCache.delete(cacheKey);
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
      _sessionCache.delete(cacheKey);
      return null; // User deleted
    }

    if (!user.isActive) {
      _sessionCache.delete(cacheKey);
      return null; // User deactivated or deleted
    }

    if ((session.sessionVersion ?? 0) !== (user.sessionVersion ?? 0)) {
      _sessionCache.delete(cacheKey);
      return null; // Session invalidated by version mismatch
    }
  } catch {
    logRuntimeEnvWarnings();
  }

  _sessionCache.set(cacheKey, { payload: session, expiresAt: Date.now() + SESSION_CACHE_TTL_MS });
  return session;
}

export function getRawSessionToken(): string | undefined {
  // Note: This is a sync helper for getting the raw token for revocation
  // Cannot use await cookies() here - callers should get the cookie value directly
  return undefined;
}

/**
 * Crea una sesión completa para un usuario que ya pasó el challenge MFA.
 * Sólo debe llamarse desde el endpoint `/api/auth/mfa/verify` tras verificar el código.
 */
export async function createSessionAfterMfa(
  userId: string,
  auditContext: LoginAuditContext = {},
): Promise<{ token: string; role: RoleCode; mustChangePassword: boolean; session: SessionPayload; fullName: string } | null> {
  const user = await prisma.user.findUnique({
    where: { id: userId, isActive: true },
    include: { userBranchRoles: { where: { isActive: true } } },
  });

  if (!user) return null;

  const branchMemberships = await getEffectiveBranchMemberships(userId);
  const branchIds = Array.from(new Set(branchMemberships.map((m) => m.branchId)));
  const globalRoles = user.globalRole ? [user.globalRole] : [];
  const primaryBranchId = branchMemberships[0]?.branchId ?? null;
  const roleCode =
    user.globalRole === "SYSTEM_ADMIN"
      ? "SYSTEM_ADMIN"
      : user.globalRole === "OWNER"
      ? "OWNER"
      : user.globalRole === "MASTER"
      ? "MASTER"
      : branchMemberships[0]?.roleCode;

  if (!roleCode) return null;

  const payload = buildSessionPayload({
    userId: user.id,
    username: user.username,
    globalRoles,
    branchMemberships,
    primaryBranchId,
    roleCode,
    branchIds,
    sessionVersion: user.sessionVersion ?? 0,
  });

  const token = encodeSession(payload);

  await logAuditEvent({
    actorUserId: user.id,
    module: "auth",
    action: "MFA_LOGIN_COMPLETE",
    entityType: "User",
    entityId: user.id,
    metadataJson: { role: roleCode },
    ipAddress: auditContext.ipAddress,
    userAgent: auditContext.userAgent,
  });

  return { token, role: roleCode, mustChangePassword: user.mustChangePassword, session: payload, fullName: user.fullName };
}
