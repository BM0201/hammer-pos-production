import { NextResponse } from "next/server";
import { clearSessionCookie, getCurrentSession } from "@/modules/auth/service";
import { logAuditEvent } from "@/modules/audit/service";
import { revokeSessionToken } from "@/modules/security/token-revocation";
import { makeSessionCookieName } from "@/modules/auth/session";
import { cookies } from "next/headers";

export async function POST(request: Request) {
  try {
    const session = await getCurrentSession();

    if (session) {
      // Revoke the session token
      const store = await cookies();
      const rawToken = store.get(makeSessionCookieName())?.value;
      if (rawToken) {
        await revokeSessionToken({
          token: rawToken,
          userId: session.userId,
          expiresAt: new Date(session.exp),
          reason: "LOGOUT",
        });
      }

      await logAuditEvent({
        actorUserId: session.userId,
        module: "auth",
        action: "LOGOUT",
        entityType: "User",
        entityId: session.userId,
      });
    }
  } finally {
    await clearSessionCookie();
  }

  return NextResponse.redirect(new URL("/login", request.url), { status: 303 });
}
