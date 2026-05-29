import { autoCloseExpiredCashSessions } from "@/modules/cash-session/auto-close-service";
import { toHttpErrorResponse } from "@/lib/http";
import { fail } from "@/lib/api/response";
import { NextResponse } from "next/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function assertCronAuthorized(request: Request) {
  const secret = process.env.CRON_SECRET;
  if (!secret) {
    throw new Error("CRON_SECRET_MISSING");
  }

  const authorization = request.headers.get("authorization");
  if (authorization === `Bearer ${secret}`) return;
  throw new Error("CRON_UNAUTHORIZED");
}

function parseNowOverride(url: URL) {
  const raw = url.searchParams.get("now");
  if (!raw) return undefined;
  if (process.env.NODE_ENV === "production") {
    throw new Error("NOW_OVERRIDE_FORBIDDEN");
  }
  const parsed = new Date(raw);
  if (Number.isNaN(parsed.getTime())) {
    throw new Error("INVALID_NOW_OVERRIDE");
  }
  return parsed;
}

async function handleCashAutoCloseCron(request: Request) {
  try {
    const url = new URL(request.url);
    assertCronAuthorized(request);

    const result = await autoCloseExpiredCashSessions({
      dryRun: url.searchParams.get("dryRun") === "1",
      now: parseNowOverride(url),
      actor: "SYSTEM",
    });

    return NextResponse.json({ ok: true, ...result });
  } catch (error) {
    if (error instanceof Error && error.message === "CRON_SECRET_MISSING") {
      return fail("CONFIGURATION_ERROR", "CRON_SECRET no esta configurado.", 500);
    }
    if (error instanceof Error && error.message === "CRON_UNAUTHORIZED") {
      return fail("UNAUTHORIZED", "Cron no autorizado.", 401);
    }
    if (error instanceof Error && error.message === "NOW_OVERRIDE_FORBIDDEN") {
      return fail("FORBIDDEN", "now override no esta permitido en produccion.", 403);
    }
    if (error instanceof Error && error.message === "INVALID_NOW_OVERRIDE") {
      return fail("VALIDATION_ERROR", "Parametro now invalido.", 400);
    }
    return toHttpErrorResponse(error);
  }
}

export async function GET(request: Request) {
  return handleCashAutoCloseCron(request);
}

export async function POST(request: Request) {
  return handleCashAutoCloseCron(request);
}
