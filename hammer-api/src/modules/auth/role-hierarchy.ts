/**
 * Jerarquía de roles para Hammer POS.
 *
 * Reglas:
 *   SYSTEM_ADMIN → puede asignar/editar cualquier rol.
 *   OWNER        → puede asignar MASTER o OWNER; no puede crear SYSTEM_ADMIN.
 *   MASTER       → puede asignar solo roles de sucursal y MASTER; no OWNER ni SYSTEM_ADMIN.
 *   Nadie puede elevar a otro a un nivel superior al propio.
 *   Nadie puede modificarse a sí mismo para quitar su rol privilegiado.
 */

import type { SessionPayload } from "@/types/auth";
import { isOwnerRole, isSystemAdminRole, isMasterOrAbove } from "@/modules/rbac/role-routing";

/** Nivel numérico de privilegio de un rol global (mayor = más privilegiado). */
const ROLE_LEVEL: Record<string, number> = {
  MASTER:       10,
  OWNER:        20,
  SYSTEM_ADMIN: 30,
};

function actorLevel(session: SessionPayload): number {
  const roles = session.globalRoles as string[];
  const rc = session.roleCode as string;

  if (isSystemAdminRole(rc, roles)) return ROLE_LEVEL.SYSTEM_ADMIN;
  if (isOwnerRole(rc, roles))       return ROLE_LEVEL.OWNER;
  if (isMasterOrAbove(rc, roles))   return ROLE_LEVEL.MASTER;
  return 0;
}

/**
 * Lanza FORBIDDEN si el actor no puede asignar `requestedRole` al objetivo.
 * Úsalo en rutas de creación y edición de usuarios.
 */
export function assertCanSetGlobalRole(
  actor: SessionPayload,
  requestedRole: string | null | undefined,
): void {
  if (!requestedRole) return; // quitar rol → permitido para cualquier master+

  const requested = ROLE_LEVEL[requestedRole] ?? 0;
  const actor_level = actorLevel(actor);

  if (actor_level === 0) {
    throw new Error("FORBIDDEN: sin privilegios para asignar roles globales");
  }

  // Un actor no puede elevar a otro a un nivel SUPERIOR al propio.
  // Asignar el mismo nivel que el actor es permitido (ej. MASTER crea otro MASTER).
  if (actor_level < ROLE_LEVEL.SYSTEM_ADMIN && requested > actor_level) {
    throw new Error(
      `FORBIDDEN: no puedes asignar el rol ${requestedRole} (requiere nivel superior al tuyo)`,
    );
  }
}

/**
 * Lanza FORBIDDEN si el actor no puede modificar a un usuario con `targetCurrentRole`.
 * Evita que un actor de nivel inferior edite a alguien de nivel igual o superior.
 */
export function assertCanManageUser(
  actor: SessionPayload,
  targetCurrentRole: string | null | undefined,
): void {
  if (!targetCurrentRole) return; // objetivo sin rol global — siempre permitido

  const target = ROLE_LEVEL[targetCurrentRole] ?? 0;
  const actor_level = actorLevel(actor);

  if (actor_level < ROLE_LEVEL.SYSTEM_ADMIN && target >= actor_level) {
    throw new Error(
      `FORBIDDEN: no puedes gestionar a un usuario con rol ${targetCurrentRole}`,
    );
  }
}
