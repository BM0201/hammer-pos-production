import { NextResponse } from "next/server";
import { z } from "zod";
import { authenticate, setSessionCookie } from "@/modules/auth/service";
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

  // Rate limiting check
  const ip = request.headers.get("x-forwarded-for") ?? request.headers.get("x-real-ip") ?? "unknown";
  const rateLimitKey = `${parsed.data.username}:${ip}`;

  const rateLimit = await checkRateLimit(rateLimitKey);
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
      redirectTo: authResult.mustChangePassword
        ? "/app/change-password"
        : getRoleAwareHome(authResult.role),
      mustChangePassword: authResult.mustChangePassword,
    });
  } catch (error) {
    if (error instanceof Error && error.message === "FORBIDDEN_MASTER_ONLY") {
      return NextResponse.json({ message: "No tienes permisos para acceder." }, { status: 403 });
    }

    return NextResponse.json({ message: "No fue posible iniciar sesión." }, { status: 500 });
  }
}
