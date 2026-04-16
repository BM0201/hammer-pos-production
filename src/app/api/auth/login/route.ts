import { NextResponse } from "next/server";
import { z } from "zod";
import { authenticate, setSessionCookie } from "@/modules/auth/service";
import { MissingDatabaseUrlError, isDatabaseConnectionError } from "@/lib/prisma";
import { getRoleAwareHome } from "@/modules/rbac/guards";
import { checkRateLimit, recordLoginAttempt } from "@/modules/security/rate-limiter";

const loginSchema = z.object({
  username: z.string().min(1),
  password: z.string().min(1),
});

export async function POST(request: Request) {
  let payload: unknown;
  try {
    payload = await request.json();
  } catch {
    return NextResponse.json({ message: "Solicitud inválida." }, { status: 400 });
  }

  const parsed = loginSchema.safeParse(payload);

  if (!parsed.success) {
    return NextResponse.json({ message: "Solicitud inválida." }, { status: 400 });
  }

  const ip = request.headers.get("x-forwarded-for") ?? request.headers.get("x-real-ip") ?? "unknown";
  const rateLimitKey = `${parsed.data.username}:${ip}`;

  let rateLimit: Awaited<ReturnType<typeof checkRateLimit>>;
  try {
    rateLimit = await checkRateLimit(rateLimitKey);
  } catch (error) {
    if (error instanceof MissingDatabaseUrlError || isDatabaseConnectionError(error)) {
      return NextResponse.json(
        { message: "Base de datos no disponible o mal configurada. Verifica DATABASE_URL en Railway." },
        { status: 503 }
      );
    }

    console.error("[auth/login] Error verificando rate limit", error);
    return NextResponse.json({ message: "No fue posible iniciar sesión." }, { status: 500 });
  }

  if (!rateLimit.allowed) {
    return NextResponse.json(
      {
        message: `Demasiados intentos de inicio de sesión. Intenta de nuevo en ${Math.ceil((rateLimit.retryAfterSeconds ?? 900) / 60)} minutos.`,
        retryAfterSeconds: rateLimit.retryAfterSeconds,
      },
      {
        status: 429,
        headers: {
          "Retry-After": String(rateLimit.retryAfterSeconds ?? 900),
        },
      }
    );
  }

  try {
    const authResult = await authenticate(parsed.data.username, parsed.data.password);
    if (!authResult) {
      await recordLoginAttempt(rateLimitKey, false);
      return NextResponse.json(
        {
          message: "Usuario o contraseña inválidos.",
          remainingAttempts: rateLimit.remainingAttempts - 1,
        },
        { status: 401 }
      );
    }

    await recordLoginAttempt(rateLimitKey, true);
    await setSessionCookie(authResult.token);

    return NextResponse.json({
      ok: true,
      redirectTo: authResult.mustChangePassword ? "/app/change-password" : getRoleAwareHome(authResult.role),
      mustChangePassword: authResult.mustChangePassword,
    });
  } catch (error) {
    if (error instanceof Error && error.message === "FORBIDDEN_MASTER_ONLY") {
      return NextResponse.json({ message: "No tienes permisos para acceder." }, { status: 403 });
    }

    if (error instanceof MissingDatabaseUrlError || isDatabaseConnectionError(error)) {
      return NextResponse.json(
        { message: "Base de datos no disponible o mal configurada. Verifica DATABASE_URL en Railway." },
        { status: 503 }
      );
    }

    if (error instanceof Error && error.message === "AUTH_SESSION_SECRET_MISSING") {
      return NextResponse.json(
        { message: "El sistema no tiene AUTH_SESSION_SECRET configurada. Contacta al administrador." },
        { status: 503 }
      );
    }

    console.error("[auth/login] Error inesperado", error);
    return NextResponse.json({ message: "No fue posible iniciar sesión." }, { status: 500 });
  }
}
