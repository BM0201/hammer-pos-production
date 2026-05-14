import { createHash } from "node:crypto";
import { prisma, isDatabaseConfigured } from "@/lib/prisma";
import { logRuntimeEnvWarnings } from "@/lib/env";

function hashSessionToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

export async function revokeSessionToken(input: {
  token: string;
  userId: string;
  expiresAt: Date;
  reason: string;
}): Promise<void> {
  if (!isDatabaseConfigured()) {
    logRuntimeEnvWarnings();
    return;
  }

  const tokenHash = hashSessionToken(input.token);

  try {
    await prisma.revokedSession.create({
      data: {
        tokenHash,
        userId: input.userId,
        expiresAt: input.expiresAt,
        reason: input.reason,
      },
    });
  } catch {
    // Token might already be revoked (unique constraint), that's fine
  }
}

export async function isTokenRevoked(token: string): Promise<boolean> {
  if (!isDatabaseConfigured()) {
    return false;
  }

  const tokenHash = hashSessionToken(token);

  const revoked = await prisma.revokedSession.findFirst({
    where: { tokenHash },
  });

  return !!revoked;
}

export async function revokeAllUserSessions(userId: string, reason: string): Promise<void> {
  if (!isDatabaseConfigured()) {
    logRuntimeEnvWarnings();
    return;
  }

  // 1. Increment sessionVersion – this is the primary invalidation mechanism.
  //    All existing stateless tokens carry the old sessionVersion value and will
  //    be rejected by getCurrentSession() on the next request.
  await prisma.user.update({
    where: { id: userId },
    data: { sessionVersion: { increment: 1 } },
  });

  // 2. Also create an audit marker in the revocation table for traceability.
  await prisma.revokedSession.create({
    data: {
      tokenHash: `user_revoke_${userId}_${Date.now()}`,
      userId,
      expiresAt: new Date(Date.now() + 24 * 60 * 60 * 1000),
      reason,
    },
  });
}

// Cleanup expired revocations
export async function cleanupExpiredRevocations(): Promise<void> {
  if (!isDatabaseConfigured()) {
    logRuntimeEnvWarnings();
    return;
  }

  await prisma.revokedSession.deleteMany({
    where: { expiresAt: { lt: new Date() } },
  });
}
