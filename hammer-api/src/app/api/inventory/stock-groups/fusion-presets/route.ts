import { getCurrentSession } from "@/modules/auth/service";
import { assertAuthenticated, assertMaster } from "@/modules/auth/access";
import { ok } from "@/lib/api/response";
import { toHttpErrorResponse } from "@/lib/http";
import { FUSION_PRESETS } from "@/modules/inventory/unit-conversion";

// GET → presets de familia (Fusión de Inventario v2, Fase 2.3): datos, no
// código. El asistente de creación los usa para precargar nombre/unidades/
// factor en el paso 1-2; el usuario siempre confirma antes de crear.
export async function GET() {
  try {
    const session = await getCurrentSession();
    assertAuthenticated(session);
    assertMaster(session);

    return ok(FUSION_PRESETS);
  } catch (error) {
    return toHttpErrorResponse(error);
  }
}
