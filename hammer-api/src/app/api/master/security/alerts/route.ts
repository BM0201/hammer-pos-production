/**
 * GET  /api/master/security/alerts  → lista paginada de alertas
 * PATCH /api/master/security/alerts → actualiza estado de una alerta
 */

import { z } from "zod";
import { getCurrentSession } from "@/modules/auth/service";
import { unauthorized, forbidden, ok, fail } from "@/lib/api/response";
import { isMaster } from "@/modules/rbac/guards";
import { listSecurityAlerts, updateAlertStatus } from "@/modules/security/alerts-service";
import type { AlertSeverity, AlertStatus } from "@prisma/client";

export async function GET(req: Request) {
  const session = await getCurrentSession();
  if (!session) return unauthorized();
  if (!isMaster(session)) return forbidden();

  const url = new URL(req.url);
  const status = url.searchParams.get("status") as AlertStatus | null;
  const severity = url.searchParams.get("severity") as AlertSeverity | null;
  const type = url.searchParams.get("type") ?? undefined;
  const limit = Math.min(Number(url.searchParams.get("limit") ?? "50"), 200);
  const offset = Number(url.searchParams.get("offset") ?? "0");

  const result = await listSecurityAlerts({
    status: status ?? undefined,
    severity: severity ?? undefined,
    type,
    limit,
    offset,
  });

  return ok(result);
}

const patchSchema = z.object({
  alertId: z.string().min(1),
  action: z.enum(["ACKNOWLEDGE", "RESOLVE", "DISMISS"]),
  note: z.string().optional(),
});

export async function PATCH(req: Request) {
  const session = await getCurrentSession();
  if (!session) return unauthorized();
  if (!isMaster(session)) return forbidden();

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return fail("VALIDATION_ERROR", "Solicitud inválida.", 400);
  }

  const parsed = patchSchema.safeParse(body);
  if (!parsed.success) {
    return fail("VALIDATION_ERROR", "alertId y acción son requeridos.", 400);
  }

  await updateAlertStatus({ ...parsed.data, actorUserId: session.userId });
  return ok({ updated: true });
}
