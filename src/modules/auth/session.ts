import { createHmac, timingSafeEqual } from "node:crypto";
import type { SessionPayload } from "@/types/auth";
import { env, envStatus, logRuntimeEnvWarnings } from "@/lib/env";

const SESSION_COOKIE = "hammer_session";

function base64UrlEncode(input: string): string {
  return Buffer.from(input, "utf8").toString("base64url");
}

function base64UrlDecode(input: string): string {
  return Buffer.from(input, "base64url").toString("utf8");
}

function sign(payloadEncoded: string): string {
  if (envStatus.isUsingFallbackAuthSecret) {
    logRuntimeEnvWarnings();
  }

  return createHmac("sha256", env.AUTH_SESSION_SECRET).update(payloadEncoded).digest("base64url");
}

export function makeSessionCookieName(): string {
  return SESSION_COOKIE;
}

export function encodeSession(payload: SessionPayload): string {
  const encodedPayload = base64UrlEncode(JSON.stringify(payload));
  const signature = sign(encodedPayload);
  return `${encodedPayload}.${signature}`;
}

export function decodeSession(token: string): SessionPayload | null {
  const [encodedPayload, signature] = token.split(".");
  if (!encodedPayload || !signature) {
    return null;
  }

  const expected = sign(encodedPayload);
  const a = Buffer.from(signature);
  const b = Buffer.from(expected);

  if (a.length !== b.length || !timingSafeEqual(a, b)) {
    return null;
  }

  try {
    const parsed = JSON.parse(base64UrlDecode(encodedPayload)) as Partial<SessionPayload>;
    if (!parsed.exp || Date.now() > parsed.exp || !parsed.userId || !parsed.username || !parsed.roleCode) {
      return null;
    }

    const branchIds = Array.isArray(parsed.branchIds) ? parsed.branchIds : [];
    const branchMemberships = Array.isArray(parsed.branchMemberships)
      ? parsed.branchMemberships
      : branchIds.map((branchId) => ({ branchId, roleCode: parsed.roleCode! }));
    const globalRoles = Array.isArray(parsed.globalRoles)
      ? parsed.globalRoles
      : (parsed.roleCode === "MASTER" ? ["MASTER"] : []);
    const primaryBranchId = typeof parsed.primaryBranchId === "string"
      ? parsed.primaryBranchId
      : (branchMemberships[0]?.branchId ?? null);

    const sessionVersion = typeof parsed.sessionVersion === "number" ? parsed.sessionVersion : 0;

    return {
      userId: parsed.userId,
      username: parsed.username,
      roleCode: parsed.roleCode,
      branchIds,
      branchMemberships,
      globalRoles: globalRoles as any,
      primaryBranchId,
      sessionVersion,
      exp: parsed.exp,
    };
  } catch {
    return null;
  }
}

export function buildSessionPayload(input: Omit<SessionPayload, "exp">): SessionPayload {
  const expiresInMs = env.AUTH_SESSION_TTL_HOURS * 60 * 60 * 1000;
  return {
    ...input,
    exp: Date.now() + expiresInMs,
  };
}
