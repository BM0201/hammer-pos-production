import { prisma } from "@/lib/prisma";
import { ok, fail } from "@/lib/api/response";

/**
 * Periodic cleanup job — invoked by Vercel Cron.
 *
 * Removes expired security artifacts:
 *  - CsrfToken rows past `expiresAt`
 *  - LoginAttempt rows older than 24h
 *  - RevokedSession rows whose original token would already have expired
 */
export const runtime = "nodejs";

export async function GET(request: Request) {
  const authHeader = request.headers.get("authorization");
  const expected = process.env.CRON_SECRET;

  if (!expected) {
    return fail("INTERNAL_ERROR", "CRON_SECRET not configured on server", 500);
  }

  if (authHeader !== `Bearer ${expected}`) {
    return fail("UNAUTHENTICATED", "Unauthorized", 401);
  }

  const now = new Date();
  const dayAgo = new Date(now.getTime() - 24 * 60 * 60 * 1000);

  const [csrfDeleted, loginDeleted, revokedDeleted] = await Promise.all([
    prisma.csrfToken.deleteMany({ where: { expiresAt: { lt: now } } }),
    prisma.loginAttempt.deleteMany({ where: { attemptedAt: { lt: dayAgo } } }),
    prisma.revokedSession.deleteMany({ where: { expiresAt: { lt: now } } }),
  ]);

  return ok({
    timestamp: now.toISOString(),
    cleaned: {
      csrfTokens: csrfDeleted.count,
      loginAttempts: loginDeleted.count,
      revokedSessions: revokedDeleted.count,
    },
  });
}
