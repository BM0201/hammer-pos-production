import { z } from "zod";
import { getCurrentSession, clearSessionCookie } from "@/modules/auth/service";
import { assertAuthenticated } from "@/modules/auth/access";
import { verifyPassword, hashPassword } from "@/modules/auth/password";
import { prisma } from "@/lib/prisma";
import { logAuditEvent } from "@/modules/audit/service";
import { revokeAllUserSessions } from "@/modules/security/token-revocation";
import { requireCsrf } from "@/modules/security/csrf";
import { toHttpErrorResponse } from "@/lib/http";
import { fail, ok } from "@/lib/api/response";
import { validatePasswordPolicy } from "@/modules/auth/password-policy";

const changePasswordSchema = z.object({
  currentPassword: z.string().min(1),
  newPassword: z
    .string()
    .min(8, "La nueva contraseña debe tener al menos 8 caracteres")
    .regex(/[A-Z]/, "Debe contener al menos una letra mayúscula")
    .regex(/[a-z]/, "Debe contener al menos una letra minúscula")
    .regex(/[0-9]/, "Debe contener al menos un número")
    .regex(/[^A-Za-z0-9]/, "Debe contener al menos un carácter especial"),
});

export async function POST(request: Request) {
  try {
    const session = await getCurrentSession();
    assertAuthenticated(session);
    await requireCsrf(request, session);

    const body = await request.json();
    const parsed = changePasswordSchema.safeParse(body);
    if (!parsed.success) {
      return fail("VALIDATION_ERROR", parsed.error.errors[0]?.message ?? "Datos inválidos", 400);
    }

    const passwordPolicyError = validatePasswordPolicy(parsed.data.newPassword);
    if (passwordPolicyError) {
      return fail("VALIDATION_ERROR", passwordPolicyError, 400);
    }

    const user = await prisma.user.findUniqueOrThrow({
      where: { id: session.userId },
    });

    // Verify current password
    const isValid = verifyPassword(parsed.data.currentPassword, user.passwordHash);
    if (!isValid) {
      return fail("UNAUTHENTICATED", "Contraseña actual incorrecta", 401);
    }

    // Prevent reusing the same password
    const isSame = verifyPassword(parsed.data.newPassword, user.passwordHash);
    if (isSame) {
      return fail("VALIDATION_ERROR", "La nueva contraseña no puede ser igual a la actual", 400);
    }

    // Update password
    const newHash = hashPassword(parsed.data.newPassword);
    await prisma.user.update({
      where: { id: session.userId },
      data: {
        passwordHash: newHash,
        mustChangePassword: false,
      },
    });

    // Revoke ALL user sessions (increments sessionVersion) to force re-login
    await revokeAllUserSessions(session.userId, "PASSWORD_CHANGE");

    await logAuditEvent({
      actorUserId: session.userId,
      module: "auth",
      action: "PASSWORD_CHANGED",
      entityType: "User",
      entityId: session.userId,
      metadataJson: { sessionsRevoked: true },
    });

    await clearSessionCookie();

    return ok({ ok: true, message: "Contraseña actualizada exitosamente. Inicia sesión con tu nueva contraseña." });
  } catch (error) {
    return toHttpErrorResponse(error);
  }
}
