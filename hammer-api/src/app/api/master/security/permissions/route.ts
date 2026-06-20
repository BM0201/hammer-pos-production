/**
 * GET /api/master/security/permissions
 *
 * Devuelve la matriz completa roles × capabilities para la vista de permisos
 * del Security Center. Los datos vienen de las constantes RBAC del backend.
 */

import { getCurrentSession } from "@/modules/auth/service";
import { unauthorized, forbidden, ok } from "@/lib/api/response";
import { isMaster } from "@/modules/rbac/guards";
import { CAPABILITIES } from "@/modules/rbac/policies";
import { can } from "@/modules/rbac/policies";
import type { RoleCode } from "@prisma/client";

const ROLES: RoleCode[] = [
  "SYSTEM_ADMIN",
  "OWNER",
  "MASTER",
  "BRANCH_ADMIN",
  "SALES",
  "CASHIER",
  "WAREHOUSE",
];

export async function GET() {
  const session = await getCurrentSession();
  if (!session) return unauthorized();
  if (!isMaster(session)) return forbidden();

  const capabilities = Object.entries(CAPABILITIES).map(([key, value]) => ({
    key,
    value,
    // Group by module prefix
    module: value.split(".")[0],
  }));

  const matrix: Record<string, Record<string, boolean>> = {};
  for (const [key] of Object.entries(CAPABILITIES)) {
    const cap = CAPABILITIES[key as keyof typeof CAPABILITIES];
    matrix[key] = {};
    for (const role of ROLES) {
      matrix[key][role] = can(role, cap);
    }
  }

  return ok({ roles: ROLES, capabilities, matrix });
}
