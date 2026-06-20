/**
 * GET /api/master/security
 *
 * Overview del Security Center: alertas abiertas, usuarios sin MFA (roles críticos),
 * intentos de login fallidos en las últimas 24h, y acciones críticas recientes.
 *
 * Solo accesible para SYSTEM_ADMIN, OWNER, MASTER.
 */

import { getCurrentSession } from "@/modules/auth/service";
import { unauthorized, forbidden, ok } from "@/lib/api/response";
import { prisma } from "@/lib/prisma";
import { isMaster } from "@/modules/rbac/guards";
import { getAlertCounts, listSecurityAlerts } from "@/modules/security/alerts-service";

const CRITICAL_ROLES = ["MASTER", "OWNER", "SYSTEM_ADMIN"];
const HOURS_24 = new Date(Date.now() - 24 * 60 * 60 * 1000);

export async function GET(req: Request) {
  const session = await getCurrentSession();
  if (!session) return unauthorized();
  if (!isMaster(session)) return forbidden();

  const [
    alertCounts,
    recentAlerts,
    usersMissingMfa,
    failedLogins,
    criticalActions,
  ] = await Promise.all([
    getAlertCounts(),
    listSecurityAlerts({ status: "OPEN", limit: 10 }),

    // Usuarios con rol crítico que NO tienen MFA activo
    prisma.user.findMany({
      where: {
        isActive: true,
        globalRole: { in: CRITICAL_ROLES as ("MASTER" | "OWNER" | "SYSTEM_ADMIN")[] },
        mfaEnabled: false,
        NOT: { username: { startsWith: "deleted-" } },
      },
      select: {
        id: true,
        username: true,
        fullName: true,
        globalRole: true,
        createdAt: true,
      },
    }),

    // Intentos de login fallidos en las últimas 24h (usando LoginAttempt)
    prisma.loginAttempt.count({
      where: {
        success: false,
        attemptedAt: { gte: HOURS_24 },
      },
    }),

    // Acciones críticas de seguridad en las últimas 24h (AuditLog)
    prisma.auditLog.findMany({
      where: {
        occurredAt: { gte: HOURS_24 },
        action: {
          in: [
            "LOGIN_FAILURE",
            "MFA_LOGIN_FAILED",
            "MFA_DISABLED",
            "MFA_RECOVERY_CODE_USED",
            "GLOBAL_ROLE_CHANGED",
            "USER_DEACTIVATED",
            "PASSWORD_RESET_BY_ADMIN",
            "USER_CREATED",
          ],
        },
      },
      include: {
        actor: { select: { username: true, fullName: true } },
        branch: { select: { code: true, name: true } },
      },
      orderBy: { occurredAt: "desc" },
      take: 20,
    }),
  ]);

  return ok({
    alertCounts,
    recentAlerts: recentAlerts.items,
    usersMissingMfa,
    failedLogins24h: failedLogins,
    criticalActions,
  });
}
