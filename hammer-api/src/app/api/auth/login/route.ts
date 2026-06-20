import { NextResponse } from "next/server";
import { z } from "zod";
import { authenticate, setSessionCookie } from "@/modules/auth/service";
import { MissingDatabaseUrlError, isDatabaseConnectionError } from "@/lib/prisma";
import { getRoleAwareHome } from "@/modules/rbac/guards";
import { checkLoginRateLimit, recordLoginAttempt } from "@/modules/security/rate-limiter";
import { ok, fail } from "@/lib/api/response";
import { markUserOnline } from "@/modules/auth/presence-service";

const loginSchema = z.object({
  username: z.string().trim().toLowerCase().min(1),
  password: z.string().min(1),
});

function getClientIp(request: Request): string {
  const forwardedFor = request.headers.get("x-forwarded-for");
  const forwardedIp = forwardedFor?.split(",")[0]?.trim();
  if (forwardedIp) return forwardedIp;

  const realIp = request.headers.get("x-real-ip")?.trim();
  return realIp || "unknown";
}

export async function POST(request: Request) {
  let payload: unknown;
  try {
    payload = await request.json();
  } catch {
    return fail("VALIDATION_ERROR", "Solicitud inválida.", 400);
  }

  const parsed = loginSchema.safeParse(payload);
  if (!parsed.success) {
    return fail("VALIDATION_ERROR", "Solicitud inválida.", 400);
  }

  const ip = getClientIp(request);
  const userAgent = request.headers.get("user-agent") ?? "unknown";
  const { username } = parsed.data;

  let rateLimit: Awaited<ReturnType<typeof checkLoginRateLimit>>;
  try {
    rateLimit = await checkLoginRateLimit(username, ip);
  } catch (error) {
    if (error instanceof MissingDatabaseUrlError || isDatabaseConnectionError(error)) {
      return fail("SERVICE_UNAVAILABLE", "Base de datos no disponible o mal configurada. Verifica DATABASE_URL en el entorno de despliegue.", 503);
    }
    console.error("[auth/login] Error verificando rate limit", error);
    return fail("INTERNAL_ERROR", "No fue posible iniciar sesión.", 500);
  }

  if (!rateLimit.allowed) {
    const retryAfter = rateLimit.retryAfterSeconds ?? 900;
    return NextResponse.json(
      {
        ok: false,
        error: {
          code: "RATE_LIMIT",
          message: `Demasiados intentos de inicio de sesión. Intenta de nuevo en ${Math.ceil(retryAfter / 60)} minutos.`,
          details: { retryAfterSeconds: retryAfter },
        },
      },
      {
        status: 429,
        headers: { "Retry-After": String(retryAfter) },
      },
    );
  }

  try {
    const authResult = await authenticate(username, parsed.data.password, {
      ipAddress: ip,
      userAgent,
    });
    if (!authResult) {
      await recordLoginAttempt(username, ip, false);
      return fail("UNAUTHENTICATED", "Usuario o contraseña inválidos.", 401);
    }

    await recordLoginAttempt(username, ip, true);

    // MFA challenge — no crear sesión todavía
    if ("mfaRequired" in authResult) {
      return ok({ mfaRequired: true, pendingToken: authResult.pendingToken, fullName: authResult.fullName });
    }

    await setSessionCookie(authResult.token);
    try {
      await markUserOnline({
        session: authResult.session,
        branchId: authResult.session.primaryBranchId,
        currentModule: "login",
        ipAddress: ip,
        userAgent,
      });
    } catch (presenceError) {
      console.error("[auth/login] No fue posible registrar presencia", presenceError);
    }

    return ok({
      redirectTo: authResult.mustChangePassword ? "/app/change-password" : getRoleAwareHome(authResult.role),
      mustChangePassword: authResult.mustChangePassword,
      fullName: authResult.fullName,
    });
  } catch (error) {
    if (error instanceof Error && error.message === "FORBIDDEN_MASTER_ONLY") {
      return fail("FORBIDDEN", "No tienes permisos para acceder.", 403);
    }

    if (error instanceof MissingDatabaseUrlError || isDatabaseConnectionError(error)) {
      return fail("SERVICE_UNAVAILABLE", "Base de datos no disponible o mal configurada. Verifica DATABASE_URL en el entorno de despliegue.", 503);
    }

    if (error instanceof Error && error.message === "AUTH_SESSION_SECRET_MISSING") {
      return fail("SERVICE_UNAVAILABLE", "El sistema no tiene AUTH_SESSION_SECRET configurada. Contacta al administrador.", 503);
    }

    console.error("[auth/login] Error inesperado", error);
    return fail("INTERNAL_ERROR", "No fue posible iniciar sesión.", 500);
  }
}
