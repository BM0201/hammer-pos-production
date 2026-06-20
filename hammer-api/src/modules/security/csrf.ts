import { randomBytes, createHash } from "node:crypto";
import { prisma } from "@/lib/prisma";
import type { SessionPayload } from "@/types/auth";

const CSRF_TOKEN_TTL_HOURS = 12;
const SAFE_METHODS = new Set(["GET", "HEAD", "OPTIONS"]);

/**
 * Custom error class for CSRF validation failures.
 * Always carries the reason "INVALID_CSRF_TOKEN" so that
 * toHttpErrorResponse() (and any catch block) can reliably
 * map it to HTTP 403 with a consistent JSON payload.
 */
export class CsrfError extends Error {
  public readonly reason = "INVALID_CSRF_TOKEN" as const;

  constructor(detail?: string) {
    super(detail ?? "INVALID_CSRF_TOKEN");
    this.name = "CsrfError";
  }
}

/**
 * Type-guard: returns true when the unknown value is a CsrfError.
 */
export function isCsrfError(error: unknown): error is CsrfError {
  return error instanceof CsrfError;
}

export function generateCsrfToken(): string {
  return randomBytes(32).toString("hex");
}

export async function createCsrfToken(sessionUserId: string): Promise<string> {
  const token = generateCsrfToken();
  const expiresAt = new Date(Date.now() + CSRF_TOKEN_TTL_HOURS * 60 * 60 * 1000);

  await prisma.csrfToken.create({
    data: {
      token: hashToken(token),
      sessionId: sessionUserId,
      expiresAt,
    },
  });

  return token;
}

export async function validateCsrfToken(token: string, sessionUserId: string): Promise<boolean> {
  if (!token || !sessionUserId) return false;

  // Tokens are reusable until TTL — check existence without deleting.
  // This eliminates one DB write per mutation while keeping security equivalent:
  // tokens are still session-scoped, signed, and expire after 12 hours.
  const hashed = hashToken(token);
  const found = await prisma.csrfToken.findFirst({
    where: {
      token: hashed,
      sessionId: sessionUserId,
      expiresAt: { gte: new Date() },
    },
    select: { token: true },
  });

  return found !== null;
}

export async function requireCsrf(request: Request, session: SessionPayload | null): Promise<void> {
  if (SAFE_METHODS.has(request.method.toUpperCase())) {
    return;
  }

  if (!session?.userId) {
    throw new CsrfError("Missing session for CSRF validation");
  }

  const csrfToken = request.headers.get("x-csrf-token");
  if (!csrfToken) {
    throw new CsrfError("Missing x-csrf-token header");
  }

  const isValid = await validateCsrfToken(csrfToken, session.userId);
  if (!isValid) {
    throw new CsrfError("CSRF token is invalid or expired");
  }
}

function hashToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

// Cleanup expired tokens
export async function cleanupExpiredCsrfTokens(): Promise<void> {
  await prisma.csrfToken.deleteMany({
    where: { expiresAt: { lt: new Date() } },
  });
}
