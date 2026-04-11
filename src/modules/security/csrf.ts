import { randomBytes, createHash } from "node:crypto";
import { prisma } from "@/lib/prisma";

const CSRF_TOKEN_TTL_HOURS = 12;

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
  if (!token) return false;

  const hashed = hashToken(token);
  const record = await prisma.csrfToken.findFirst({
    where: {
      token: hashed,
      sessionId: sessionUserId,
      expiresAt: { gte: new Date() },
    },
  });

  return !!record;
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
