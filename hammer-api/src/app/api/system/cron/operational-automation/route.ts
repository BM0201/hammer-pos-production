import { NextResponse } from "next/server";
import { fail } from "@/lib/api/response";
import { toHttpErrorResponse } from "@/lib/http";
import { timingSafeEqualStrings } from "@/lib/timing-safe-compare";
import { autoCloseExpiredCashSessions } from "@/modules/cash-session/auto-close-service";
import { sweepStaleOperationalDaysToAwaitingReview } from "@/modules/operations/service";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function assertCronAuthorized(request: Request) {
  const secret = process.env.CRON_SECRET;
  if (!secret) throw new Error("CRON_SECRET_MISSING");
  const authorization = request.headers.get("authorization");
  if (authorization && timingSafeEqualStrings(authorization, `Bearer ${secret}`)) return;
  throw new Error("CRON_UNAUTHORIZED");
}

function parseNowOverride(url: URL) {
  const raw = url.searchParams.get("now");
  if (!raw) return undefined;
  if (process.env.NODE_ENV === "production") throw new Error("NOW_OVERRIDE_FORBIDDEN");
  const parsed = new Date(raw);
  if (Number.isNaN(parsed.getTime())) throw new Error("INVALID_NOW_OVERRIDE");
  return parsed;
}

/**
 * Cron cada 10 min (vercel.json). Día Operativo 360: solo quedan dos pasos.
 *  1. cashSessionClose — cierre automático de CAJA por horario (B4, reloj
 *     independiente del día operativo — se mantiene intacto, es la barrera
 *     real contra vender de noche).
 *  2. operationalDaySweep — barrido ACTIVE → AWAITING_REVIEW de días de
 *     fecha pasada. Nunca finaliza ni confirma nada.
 * autoOpenOperationalDays, autoClosePendingOperationalDaysBacklog y
 * autoCloseTodaysOperationalDaysAtDeadline desaparecieron: el día se crea
 * solo con la primera operación, y confirmar es siempre un acto humano.
 */
async function handle(request: Request) {
  try {
    const url = new URL(request.url);
    assertCronAuthorized(request);
    const dryRun = url.searchParams.get("dryRun") === "1";
    const now = parseNowOverride(url);

    const cashSessionClose = await autoCloseExpiredCashSessions({ dryRun, now, actor: "SYSTEM" });
    const operationalDaySweep = await sweepStaleOperationalDaysToAwaitingReview({ dryRun, now });

    return NextResponse.json({
      ok: true,
      steps: { cashSessionClose, operationalDaySweep },
    });
  } catch (error) {
    if (error instanceof Error && error.message === "CRON_SECRET_MISSING")
      return fail("CONFIGURATION_ERROR", "CRON_SECRET no esta configurado.", 500);
    if (error instanceof Error && error.message === "CRON_UNAUTHORIZED")
      return fail("UNAUTHORIZED", "Cron no autorizado.", 401);
    if (error instanceof Error && error.message === "NOW_OVERRIDE_FORBIDDEN")
      return fail("FORBIDDEN", "now override no esta permitido en produccion.", 403);
    if (error instanceof Error && error.message === "INVALID_NOW_OVERRIDE")
      return fail("VALIDATION_ERROR", "Parametro now invalido.", 400);
    return toHttpErrorResponse(error);
  }
}

export async function GET(request: Request) { return handle(request); }
export async function POST(request: Request) { return handle(request); }
