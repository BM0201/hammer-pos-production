import { NextResponse } from "next/server";
import { z } from "zod";
import { getCurrentSession } from "@/modules/auth/service";
import { assertAuthenticated } from "@/modules/auth/access";
import { requireCsrf } from "@/modules/security/csrf";
import { prisma } from "@/lib/prisma";
import { verifyPassword } from "@/modules/auth/password";
import { checkReauthRateLimit, recordReauthAttempt } from "@/modules/security/rate-limiter";
import { logAuditEvent } from "@/modules/audit/service";
import { toHttpErrorResponse } from "@/lib/http";
import { ok, fail } from "@/lib/api/response";
import { getClientIp } from "@/lib/client-ip";

const verifySchema = z.object({
  password: z.string().min(1),
});

/**
 * Re-autenticación del usuario YA logueado (desbloqueo por inactividad en
 * terminales POS). Solo confirma la contraseña de la sesión activa:
 * - NO crea ni rota la cookie de sesión.
 * - NO pasa por el rate limiter del login ni por el challenge de Turnstile
 *   (la sesión ya probó identidad al iniciarse); tiene su propio límite
 *   (5 fallos / 15 min por usuario) para frenar adivinanza en la terminal.
 */
export async function POST(request: Request) {
  try {
    const session = await getCurrentSession();
    assertAuthenticated(session);
    await requireCsrf(request, session);

    const parsed = verifySchema.safeParse(await request.json().catch(() => null));
    if (!parsed.success) {
      return fail("VALIDATION_ERROR", "Solicitud inválida.", 400);
    }

    const rate = await checkReauthRateLimit(session!.userId);
    if (!rate.allowed) {
      return NextResponse.json(
        {
          ok: false,
          error: {
            code: "RATE_LIMIT",
            message: `Demasiados intentos. Intenta de nuevo en ${Math.ceil(rate.retryAfterSeconds / 60)} minutos.`,
            details: { retryAfterSeconds: rate.retryAfterSeconds },
          },
        },
        { status: 429, headers: { "Retry-After": String(rate.retryAfterSeconds) } },
      );
    }

    const user = await prisma.user.findUnique({
      where: { id: session!.userId },
      select: { passwordHash: true, isActive: true, username: true },
    });
    if (!user || !user.isActive) {
      return fail("UNAUTHENTICATED", "Sesión inválida.", 401);
    }

    const valid = verifyPassword(parsed.data.password, user.passwordHash);
    await recordReauthAttempt(session!.userId, valid);
    await logAuditEvent({
      actorUserId: session!.userId,
      module: "auth",
      action: valid ? "REAUTH_SUCCESS" : "REAUTH_FAILURE",
      entityType: "User",
      entityId: session!.userId,
      metadataJson: { context: "idle-lock", username: user.username },
      ipAddress: getClientIp(request),
      userAgent: request.headers.get("user-agent") ?? "unknown",
    });

    if (!valid) {
      return fail("UNAUTHENTICATED", "Contraseña incorrecta.", 401);
    }

    return ok({ verified: true });
  } catch (error) {
    return toHttpErrorResponse(error);
  }
}
