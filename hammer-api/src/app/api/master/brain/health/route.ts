import { ok } from "@/lib/api/response";
import { toHttpErrorResponse } from "@/lib/http";
import { assertAuthenticated, assertMaster } from "@/modules/auth/access";
import { getCurrentSession } from "@/modules/auth/service";
import { getBrainHealth } from "@/modules/brain/health-service";

/** prompt-brain-centro-decisiones.md Fase 2.3 — línea de salud del encabezado. */
export async function GET() {
  try {
    const session = await getCurrentSession();
    assertAuthenticated(session);
    assertMaster(session);
    return ok(await getBrainHealth());
  } catch (error) {
    return toHttpErrorResponse(error);
  }
}
