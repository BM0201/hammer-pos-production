import { NextResponse } from "next/server";
import { fail } from "@/lib/api/response";
import { toHttpErrorResponse } from "@/lib/http";
import { timingSafeEqualStrings } from "@/lib/timing-safe-compare";
import { autoCloseExpiredCashSessions } from "@/modules/cash-session/auto-close-service";
import {
  autoClosePendingOperationalDaysBacklog,
  autoCloseTodaysOperationalDaysAtDeadline,
  autoOpenOperationalDays,
} from "@/modules/operations/auto-day-service";
import { sweepStaleOperationalDaysToPendingClose } from "@/modules/operations/service";

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

async function handle(request: Request) {
  try {
    const url = new URL(request.url);
    assertCronAuthorized(request);
    const dryRun = url.searchParams.get("dryRun") === "1";
    const now = parseNowOverride(url);

    const operationalDayOpen = await autoOpenOperationalDays({ dryRun, now });
    const cashSessionClose = await autoCloseExpiredCashSessions({ dryRun, now, actor: "SYSTEM" });
    // Día Operativo v2 Fase 5: el barrido de días stale a PENDING_CLOSE corre
    // siempre (modelo pendiente puro, nunca finaliza un día); el auto-cierre
    // de HOY sigue siendo opt-in (autoCloseEnabled) y separado.
    const operationalDayPendingCloseSweep = await sweepStaleOperationalDaysToPendingClose({ dryRun, now });
    // Reintenta TODO el backlog de PENDING_CLOSE (de cualquier fecha) antes de
    // mirar el día de hoy — sin esto, un día que cae a PENDING_CLOSE queda
    // huérfano para siempre: nada vuelve a chequear si su bloqueante (ej. una
    // venta pendiente de cobro) ya se resolvió, ni avisa mientras sigue vivo.
    const operationalDayPendingCloseBacklog = await autoClosePendingOperationalDaysBacklog({ dryRun });
    const operationalDayClose = await autoCloseTodaysOperationalDaysAtDeadline({ dryRun, now });

    return NextResponse.json({
      ok: true,
      steps: {
        operationalDayOpen,
        cashSessionClose,
        operationalDayPendingCloseSweep,
        operationalDayPendingCloseBacklog,
        operationalDayClose,
      },
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
