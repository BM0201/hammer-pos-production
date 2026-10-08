import { fail, ok } from "@/lib/api/response";
import { toHttpErrorResponse } from "@/lib/http";
import { assertAuthenticated, assertMaster } from "@/modules/auth/access";
import { getCurrentSession } from "@/modules/auth/service";
import { isSystemAdmin } from "@/modules/rbac/guards";
import { runBrainScan } from "@/modules/brain/engine";
import { scanBrainSchema } from "@/modules/brain/validators";
import { requireCsrf } from "@/modules/security/csrf";

// Full scan runs 10 detectors in parallel against Neon; give it headroom past
// Vercel's default function duration so a cold start can't kill it midway.
export const maxDuration = 60;

// prompt-brain-centro-decisiones.md Fase 2.6 — "con un modo avanzado
// explícito, solo para SYSTEM_ADMIN". Sin mode (el botón "Escanear ahora" y
// el "Revisar ahora" de Precios, que manda SCHEDULED_SCAN explícito) corre
// para cualquier Master; pedir uno de los 5 modos de diagnóstico puntual
// (QUICK/ENTITY/DEEP/REPAIR/OPERATIONAL_DAY) exige SYSTEM_ADMIN.
const ADVANCED_MODES = new Set(["QUICK_SCAN", "OPERATIONAL_DAY_SCAN", "ENTITY_SCAN", "DEEP_SCAN", "REPAIR_SCAN"]);

export async function POST(request: Request) {
  try {
    const session = await getCurrentSession();
    assertAuthenticated(session);
    await requireCsrf(request, session);
    assertMaster(session);

    const parsed = scanBrainSchema.safeParse(await request.json().catch(() => ({})));
    if (!parsed.success) {
      return fail("VALIDATION_ERROR", "Parametros invalidos.", 400, parsed.error.flatten());
    }

    if (parsed.data.mode && ADVANCED_MODES.has(parsed.data.mode) && !isSystemAdmin(session)) {
      return fail("FORBIDDEN", "Los modos de diagnóstico avanzado son solo para administradores del sistema.", 403);
    }

    const data = await runBrainScan({ ...parsed.data, actorUserId: session.userId });
    return ok(data);
  } catch (error) {
    return toHttpErrorResponse(error);
  }
}
