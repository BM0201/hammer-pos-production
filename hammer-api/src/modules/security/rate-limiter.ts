import { prisma } from "@/lib/prisma";

const MAX_ATTEMPTS = 5;
const WINDOW_MINUTES = 15;

export async function checkRateLimit(identifier: string): Promise<{
  allowed: boolean;
  remainingAttempts: number;
  retryAfterSeconds: number | null;
}> {
  const windowStart = new Date(Date.now() - WINDOW_MINUTES * 60 * 1000);

  const recentAttempts = await prisma.loginAttempt.count({
    where: {
      identifier,
      attemptedAt: { gte: windowStart },
      success: false,
    },
  });

  if (recentAttempts >= MAX_ATTEMPTS) {
    // Find the oldest attempt in the window to calculate retry time
    const oldestAttempt = await prisma.loginAttempt.findFirst({
      where: {
        identifier,
        attemptedAt: { gte: windowStart },
        success: false,
      },
      orderBy: { attemptedAt: "asc" },
    });

    const retryAfterSeconds = oldestAttempt
      ? Math.ceil((oldestAttempt.attemptedAt.getTime() + WINDOW_MINUTES * 60 * 1000 - Date.now()) / 1000)
      : WINDOW_MINUTES * 60;

    return {
      allowed: false,
      remainingAttempts: 0,
      retryAfterSeconds: Math.max(0, retryAfterSeconds),
    };
  }

  return {
    allowed: true,
    remainingAttempts: MAX_ATTEMPTS - recentAttempts,
    retryAfterSeconds: null,
  };
}

export async function recordLoginAttempt(identifier: string, success: boolean): Promise<void> {
  await prisma.loginAttempt.create({
    data: { identifier, success },
  });

  // If successful, clear recent failed attempts
  if (success) {
    const windowStart = new Date(Date.now() - WINDOW_MINUTES * 60 * 1000);
    await prisma.loginAttempt.deleteMany({
      where: {
        identifier,
        attemptedAt: { gte: windowStart },
        success: false,
      },
    });
  }
}

// Cleanup old attempts (call periodically)
export async function cleanupOldAttempts(): Promise<void> {
  const cutoff = new Date(Date.now() - 24 * 60 * 60 * 1000); // 24 hours
  await prisma.loginAttempt.deleteMany({
    where: { attemptedAt: { lt: cutoff } },
  });
}
