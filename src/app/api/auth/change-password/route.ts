import { NextResponse } from "next/server";
import { z } from "zod";
import { getCurrentSession, clearSessionCookie } from "@/modules/auth/service";
import { assertAuthenticated } from "@/modules/auth/access";
import { verifyPassword, hashPassword } from "@/modules/auth/password";
import { prisma } from "@/lib/prisma";
import { logAuditEvent } from "@/modules/audit/service";
import { revokeSessionToken } from "@/modules/security/token-revocation";
import { makeSessionCookieName } from "@/modules/auth/session";
import { cookies } from "next/headers";

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

    const body = await request.json();
    const parsed = changePasswordSchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json(
        { message: parsed.error.errors[0]?.message ?? "Datos inválidos" },
        { status: 400 }
      );
    }

    const user = await prisma.user.findUniqueOrThrow({
      where: { id: session.userId },
    });

    // Verify current password
    const isValid = verifyPassword(parsed.data.currentPassword, user.passwordHash);
    if (!isValid) {
      return NextResponse.json(
        { message: "Contraseña actual incorrecta" },
        { status: 401 }
      );
    }

    // Prevent reusing the same password
    const isSame = verifyPassword(parsed.data.newPassword, user.passwordHash);
    if (isSame) {
      return NextResponse.json(
        { message: "La nueva contraseña no puede ser igual a la actual" },
        { status: 400 }
      );
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

    // Revoke current session token to force re-login with new password
    const store = await cookies();
    const rawToken = store.get(makeSessionCookieName())?.value;
    if (rawToken) {
      await revokeSessionToken({
        token: rawToken,
        userId: session.userId,
        expiresAt: new Date(session.exp),
        reason: "PASSWORD_CHANGE",
      });
    }

    await logAuditEvent({
      actorUserId: session.userId,
      module: "auth",
      action: "PASSWORD_CHANGED",
      entityType: "User",
      entityId: session.userId,
      metadataJson: { sessionsRevoked: true },
    });

    await clearSessionCookie();

    return NextResponse.json({ ok: true, message: "Contraseña actualizada exitosamente. Inicia sesión con tu nueva contraseña." });
  } catch (error) {
    if (error instanceof Error && error.message === "UNAUTHENTICATED") {
      return NextResponse.json({ message: "Unauthorized" }, { status: 401 });
    }
    return NextResponse.json({ message: "Error al cambiar la contraseña" }, { status: 500 });
  }
}
