import { sweepStaleOperationalDaysToAwaitingReview } from "@/modules/operations/service";
import { toHttpErrorResponse } from "@/lib/http";
import { fail } from "@/lib/api/response";
import { timingSafeEqualStrings } from "@/lib/timing-safe-compare";
import { NextResponse } from "next/server";

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
 * Día Operativo 360 — el único trabajo periódico que le queda al día
 * operativo: barrer ACTIVE → AWAITING_REVIEW los días de fecha pasada. Nunca
 * finaliza nada, nunca confirma nada — solo saca el día del turno en curso
 * para que la sucursal pueda abrir el de hoy sin tropezar con él. Reemplaza
 * a operational-day-auto-close (que además auto-cerraba y auto-aprobaba).
 */
async function handle(request: Request) {
  try {
    const url = new URL(request.url);
    assertCronAuthorized(request);
    const dryRun = url.searchParams.get("dryRun") === "1";
    const now = parseNowOverride(url);
    const result = await sweepStaleOperationalDaysToAwaitingReview({ dryRun, now });
    return NextResponse.json({ ok: true, ...result });
  } catch (error) {
    if (error instanceof Error && error.message === "CRON_SECRET_MISSING")
      return fail("CONFIGURATION_ERROR", "CRON_SECRET no está configurado.", 500);
    if (error instanceof Error && error.message === "CRON_UNAUTHORIZED")
      return fail("UNAUTHORIZED", "Cron no autorizado.", 401);
    if (error instanceof Error && error.message === "NOW_OVERRIDE_FORBIDDEN")
      return fail("FORBIDDEN", "now override no está permitido en producción.", 403);
    if (error instanceof Error && error.message === "INVALID_NOW_OVERRIDE")
      return fail("VALIDATION_ERROR", "Parámetro now inválido.", 400);
    return toHttpErrorResponse(error);
  }
}

export async function GET(request: Request) { return handle(request); }
export async function POST(request: Request) { return handle(request); }
