import { prisma } from "@/lib/prisma";
import { ok, fail } from "@/lib/api/response";
import { runRetentionSweep } from "@/modules/retention/service";
import { LOGIN_ATTEMPT_RETENTION_DAYS, retentionCutoff } from "@/modules/retention/policy";
import { expireStaleBrainDecisions } from "@/modules/brain/service";

/**
 * Cron diario de limpieza (ver vercel.json — 0 9 UTC = 3am Managua).
 *
 * Dos capas, alineadas a docs/POLITICA-RETENCION-DATOS.md:
 *
 *  1. EFÍMERO — tokens/artefactos de seguridad con TTL corto:
 *     - CsrfToken vencidos (expiresAt)
 *     - RevokedSession vencidas (expiresAt)
 *     - MfaPendingToken vencidos (challenge de 10 min)
 *     - LoginAttempt con más de 90 días (telemetría de seguridad)
 *
 *  2. ARCHIVO — sweep de retención de 3 años (mínimo del negocio) para
 *     auditoría y derivados: AuditLog, BrainDecision cerradas, alertas
 *     cerradas, snapshots de precios, analytics mensuales, lotes de
 *     importación, borradores y bitácora de impresión. Borra por lotes;
 *     los datos transaccionales del negocio jamás se tocan.
 */
export const runtime = "nodejs";
export const maxDuration = 60;

export async function GET(request: Request) {
  const authHeader = request.headers.get("authorization");
  const expected = process.env.CRON_SECRET;

  if (!expected) {
    return fail("INTERNAL_ERROR", "CRON_SECRET not configured on server", 500);
  }

  if (authHeader !== `Bearer ${expected}`) {
    return fail("UNAUTHENTICATED", "Unauthorized", 401);
  }

  const now = new Date();
  const loginAttemptCutoff = retentionCutoff(LOGIN_ATTEMPT_RETENTION_DAYS, now);

  const [csrfDeleted, loginDeleted, revokedDeleted, mfaDeleted] = await Promise.all([
    prisma.csrfToken.deleteMany({ where: { expiresAt: { lt: now } } }),
    prisma.loginAttempt.deleteMany({ where: { attemptedAt: { lt: loginAttemptCutoff } } }),
    prisma.revokedSession.deleteMany({ where: { expiresAt: { lt: now } } }),
    prisma.mfaPendingToken.deleteMany({ where: { expiresAt: { lt: now } } }),
  ]);

  const retention = await runRetentionSweep({ now });

  // Higiene de Brain: expira decisiones que ningún escaneo re-detecta en 7 días
  // (condición desaparecida) para que la bandeja no acumule bulto muerto.
  const brainExpired = await expireStaleBrainDecisions(now);

  return ok({
    timestamp: now.toISOString(),
    cleaned: {
      csrfTokens: csrfDeleted.count,
      loginAttempts: loginDeleted.count,
      revokedSessions: revokedDeleted.count,
      mfaPendingTokens: mfaDeleted.count,
      brainDecisionsExpired: brainExpired,
    },
    retention: {
      cutoff: retention.cutoffIso,
      totalDeleted: retention.totalDeleted,
      byTable: Object.fromEntries(retention.rules.map((r) => [r.table, r.deleted])),
      capped: retention.rules.filter((r) => r.capped).map((r) => r.table),
    },
  });
}
