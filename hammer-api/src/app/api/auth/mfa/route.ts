/**
 * POST /api/auth/mfa
 *
 * Segundo factor del login — recibe pendingToken + código TOTP/recuperación.
 * Si es válido, emite la sesión completa. No crea sesión parcial en ningún punto.
 */

import { z } from "zod";
import { ok, fail } from "@/lib/api/response";
import { consumeMfaPendingToken, verifyMfaCode } from "@/modules/auth/mfa-service";
import { createSessionAfterMfa, setSessionCookie } from "@/modules/auth/service";
import { getRoleAwareHome } from "@/modules/rbac/guards";

const schema = z.object({
  pendingToken: z.string().min(1),
  code: z.string().min(6).max(10),
});

export async function POST(request: Request) {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return fail("VALIDATION_ERROR", "Solicitud inválida.", 400);
  }

  const parsed = schema.safeParse(body);
  if (!parsed.success) {
    return fail("VALIDATION_ERROR", "pendingToken y código son requeridos.", 400);
  }

  const { pendingToken, code } = parsed.data;
  const ip = request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ?? "unknown";
  const userAgent = request.headers.get("user-agent") ?? "unknown";

  // Consume y valida el pending token (single-use, TTL 10 min)
  const userId = await consumeMfaPendingToken(pendingToken);
  if (!userId) {
    return fail("UNAUTHENTICATED", "Token MFA expirado o inválido. Inicia sesión nuevamente.", 401);
  }

  // Verifica el código TOTP o de recuperación
  const valid = await verifyMfaCode(userId, code, { ipAddress: ip, userAgent });
  if (!valid) {
    return fail("UNAUTHENTICATED", "Código MFA incorrecto.", 401);
  }

  // Crea la sesión completa
  const result = await createSessionAfterMfa(userId, { ipAddress: ip, userAgent });
  if (!result) {
    return fail("UNAUTHENTICATED", "Usuario no disponible.", 401);
  }

  await setSessionCookie(result.token);

  return ok({
    redirectTo: result.mustChangePassword
      ? "/app/change-password"
      : getRoleAwareHome(result.role),
    mustChangePassword: result.mustChangePassword,
    fullName: result.fullName,
  });
}
