/**
 * GET  /api/master/retention — estado de la política de retención (dry-run):
 *      qué purgaría el próximo sweep, tabla por tabla, sin borrar nada.
 * POST /api/master/retention — ejecuta el sweep ahora (mismo comportamiento
 *      que el cron diario), auditado con el usuario Master como actor.
 *
 * Solo Master. Política completa en docs/POLITICA-RETENCION-DATOS.md.
 */
import { getCurrentSession } from "@/modules/auth/service";
import { assertAuthenticated, assertMaster } from "@/modules/auth/access";
import { requireCsrf } from "@/modules/security/csrf";
import { ok } from "@/lib/api/response";
import { toApiErrorResponse } from "@/lib/api/errors";
import { runRetentionSweep } from "@/modules/retention/service";
import { ARCHIVE_RETENTION_DAYS, LOGIN_ATTEMPT_RETENTION_DAYS } from "@/modules/retention/policy";

export const maxDuration = 60;

export async function GET() {
  try {
    const session = await getCurrentSession();
    assertAuthenticated(session);
    assertMaster(session);

    const preview = await runRetentionSweep({ dryRun: true });
    return ok({
      policy: {
        archiveRetentionDays: ARCHIVE_RETENTION_DAYS,
        loginAttemptRetentionDays: LOGIN_ATTEMPT_RETENTION_DAYS,
        docs: "docs/POLITICA-RETENCION-DATOS.md",
      },
      preview,
    });
  } catch (error) {
    return toApiErrorResponse(error);
  }
}

export async function POST(request: Request) {
  try {
    const session = await getCurrentSession();
    assertAuthenticated(session);
    await requireCsrf(request, session);
    assertMaster(session);

    const result = await runRetentionSweep({ actorUserId: session.userId });
    return ok(result);
  } catch (error) {
    return toApiErrorResponse(error);
  }
}
