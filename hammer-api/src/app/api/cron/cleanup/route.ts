import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";

/**
 * Periodic cleanup job — invoked by Vercel Cron.
 *
 * Removes expired security artifacts:
 *  - CsrfToken rows past `expiresAt`
 *  - LoginAttempt rows older than 24h
 *  - RevokedSession rows whose original token would already have expired
 *
 * Auth: requires `Authorization: Bearer <CRON_SECRET>` header (Vercel Cron
 * injects this automatically when `CRON_SECRET` is set as an env var).
 */
export const runtime = "nodejs";

export async function GET(request: Request) {
  const authHeader = request.headers.get("authorization");
  const expected = process.env.CRON_SECRET;

  if (!expected) {
    return NextResponse.json(
      { error: "CRON_SECRET not configured on server" },
      { status: 500 },
    );
  }

  if (authHeader !== `Bearer ${expected}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const now = new Date();
  const dayAgo = new Date(now.getTime() - 24 * 60 * 60 * 1000);

  const [csrfDeleted, loginDeleted, revokedDeleted] = await Promise.all([
    prisma.csrfToken.deleteMany({ where: { expiresAt: { lt: now } } }),
    prisma.loginAttempt.deleteMany({ where: { attemptedAt: { lt: dayAgo } } }),
    prisma.revokedSession.deleteMany({ where: { expiresAt: { lt: now } } }),
  ]);

  return NextResponse.json({
    ok: true,
    timestamp: now.toISOString(),
    cleaned: {
      csrfTokens: csrfDeleted.count,
      loginAttempts: loginDeleted.count,
      revokedSessions: revokedDeleted.count,
    },
  });
}
