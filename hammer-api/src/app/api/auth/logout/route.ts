import { NextResponse } from "next/server";
import { clearSessionCookie, getCurrentSession } from "@/modules/auth/service";
import { logAuditEvent } from "@/modules/audit/service";
import { revokeSessionToken } from "@/modules/security/token-revocation";
import { makeSessionCookieName } from "@/modules/auth/session";
import { cookies } from "next/headers";
import { requireCsrf, isCsrfError } from "@/modules/security/csrf";
import { fail } from "@/lib/api/response";
import { markUserOffline } from "@/modules/auth/presence-service";

export async function POST(request: Request) {
  try {
    const session = await getCurrentSession();

    if (session) {
      await requireCsrf(request, session);

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

      try {
        await markUserOffline(session.userId);
      } catch (presenceError) {
        console.error("[auth/logout] No fue posible cerrar presencia", presenceError);
      }
    }
  } catch (error) {
    // CSRF errors must surface as 403, never be swallowed
    if (isCsrfError(error) || (error instanceof Error && error.message === "INVALID_CSRF_TOKEN")) {
      return fail("FORBIDDEN", "CSRF inválido", 403);
    }
    console.error("[auth/logout] failed during logout flow", error);
  } finally {
    try {
      await clearSessionCookie();
    } catch (cookieError) {
      console.error("[auth/logout] failed to clear session cookie", cookieError);
    }
  }

  return NextResponse.redirect(new URL("/login", request.url), { status: 303 });
}
