import { fail, ok } from "@/lib/api/response";
import { toHttpErrorResponse } from "@/lib/http";
import { timingSafeEqualStrings } from "@/lib/timing-safe-compare";
import { runBrainScan } from "@/modules/brain/engine";

/**
 * prompt-brain-centro-decisiones.md Fase 1.8 — SCHEDULED_SCAN automático,
 * cada hora en horario de operación (ver vercel.json). Antes NADA disparaba
 * un escaneo salvo que alguien apretara un botón — si nadie entraba a
 * Brain en una semana, el cron de limpieza diario vaciaba la bandeja
 * (expireStaleBrainDecisions a los 7 días) sin que nadie hubiera mirado
 * nada, y el check "Decisiones críticas de Brain" del cierre del día
 * marcaba OK igual.
 */
export const runtime = "nodejs";
export const maxDuration = 120;

export async function GET(request: Request) {
  const authHeader = request.headers.get("authorization");
  const expected = process.env.CRON_SECRET;

  if (!expected) {
    return fail("INTERNAL_ERROR", "CRON_SECRET not configured on server", 500);
  }
  if (!authHeader || !timingSafeEqualStrings(authHeader, `Bearer ${expected}`)) {
    return fail("UNAUTHENTICATED", "Unauthorized", 401);
  }

  try {
    const result = await runBrainScan({ mode: "SCHEDULED_SCAN", trigger: "SCHEDULED" });
    return ok(result);
  } catch (error) {
    // BRAIN_SCAN_RUNNING acá no es un error real — el cron de la hora
    // anterior sigue corriendo (una corrida grande, un cold start lento).
    // 200 con el aviso, no 409: un cron que "falla" por esto generaría
    // alertas de monitoreo por algo que se autorresuelve en la próxima hora.
    if (error instanceof Error && error.message === "BRAIN_SCAN_RUNNING") {
      return ok({ skipped: true, reason: "BRAIN_SCAN_RUNNING" });
    }
    return toHttpErrorResponse(error);
  }
}
