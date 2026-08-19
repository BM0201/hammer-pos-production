import { clearSessionCookie, getCurrentSession } from "@/modules/auth/service";
import { logAuditEvent } from "@/modules/audit/service";
import { revokeSessionToken } from "@/modules/security/token-revocation";
import { makeSessionCookieName } from "@/modules/auth/session";
import { cookies } from "next/headers";
import { requireCsrf, isCsrfError } from "@/modules/security/csrf";
import { fail, ok } from "@/lib/api/response";
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

  // Devolvemos JSON 200 (no un redirect server-side). El cliente ya navega a /login
  // tras el fetch. Un redirect a `request.url` apuntaría al dominio del backend
  // (hammer-api.vercel.app/login), que el fetch intentaría seguir cross-origin y la
  // CSP `connect-src 'self'` del frontend bloquearía. Eso rompía el logout.
  return ok({ loggedOut: true });
}
