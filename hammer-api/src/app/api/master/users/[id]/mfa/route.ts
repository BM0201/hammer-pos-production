/**
 * DELETE /api/master/users/[id]/mfa
 *
 * Reinicia el MFA de un usuario (lo desactiva sin requerir código TOTP del objetivo).
 * Solo SYSTEM_ADMIN puede ejecutar esta acción en cualquier usuario.
 * OWNER y MASTER solo pueden resetearlo en usuarios de menor jerarquía.
 */

import { ok, unauthorized, forbidden, notFound } from "@/lib/api/response";
import { getCurrentSession } from "@/modules/auth/service";
import { getUserById } from "@/modules/users/service";
import { disableMfa } from "@/modules/auth/mfa-service";
import { assertCanManageUser } from "@/modules/auth/role-hierarchy";
import { getClientIp } from "@/lib/client-ip";
import { requireCsrf } from "@/modules/security/csrf";
import { toHttpErrorResponse } from "@/lib/http";

export async function DELETE(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const session = await getCurrentSession();
  if (!session) return unauthorized();

  // Auditoría 2026-07-22 (ALTO Seguridad): esta ruta reinicia el MFA de OTRO
  // usuario (sin su código TOTP) y no exigía CSRF — un DELETE cross-site
  // aprovechando la cookie de sesión de un Master/SystemAdmin autenticado
  // podía desactivar el MFA de cualquier usuario de menor jerarquía.
  try {
    await requireCsrf(request, session);
  } catch (err) {
    return toHttpErrorResponse(err);
  }

  const { id: targetId } = await params;
  const target = await getUserById(targetId);
  if (!target) return notFound("Usuario no encontrado.");

  try {
    assertCanManageUser(session, target.globalRole);
  } catch (err) {
    return forbidden(err instanceof Error ? err.message.replace("FORBIDDEN: ", "") : undefined);
  }

  const ip = getClientIp(request);
  const userAgent = request.headers.get("user-agent") ?? "unknown";

  await disableMfa(targetId, session.userId, { ipAddress: ip, userAgent });

  return ok({ reset: true });
}
