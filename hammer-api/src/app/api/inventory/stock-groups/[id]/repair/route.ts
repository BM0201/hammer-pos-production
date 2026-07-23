import { getCurrentSession } from "@/modules/auth/service";
import { assertAuthenticated, assertMaster } from "@/modules/auth/access";
import { requireCsrf } from "@/modules/security/csrf";
import { ok, fail } from "@/lib/api/response";
import { toHttpErrorResponse } from "@/lib/http";
import { previewStockGroupRepair, applyStockGroupRepair } from "@/modules/catalog/stock-group-crud";

// GET → preview de reparación guiada (Fusión de Inventario v2, Fase 1.6):
// antes/después/diff por sucursal SIN escribir nada. Incluye un hash que
// POST debe recibir sin cambios para poder aplicar — "nadie repara sin ver".
export async function GET(_request: Request, context: { params: Promise<{ id: string }> }) {
  try {
    const session = await getCurrentSession();
    assertAuthenticated(session);
    assertMaster(session);

    const { id } = await context.params;
    return ok(await previewStockGroupRepair(id));
  } catch (error) {
    return toHttpErrorResponse(error);
  }
}

// POST → aplica la reparación (rebuildStockGroupBalancesTx) SOLO si expectedHash
// coincide con un preview recalculado en el momento de aplicar. Si el
// inventario cambió desde que se generó el preview visto por el usuario,
// rechaza con REPAIR_PREVIEW_STALE y pide generar uno nuevo.
export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  try {
    const session = await getCurrentSession();
    assertAuthenticated(session);
    await requireCsrf(request, session);
    assertMaster(session);

    const { id } = await context.params;
    const body = (await request.json().catch(() => ({}))) as {
      expectedHash?: string;
      reason?: string;
    };

    if (!body.expectedHash) {
      return fail("VALIDATION_ERROR", "expectedHash es requerido — generá un preview primero.", 400);
    }

    const results = await applyStockGroupRepair({
      stockGroupId: id,
      actorUserId: session.userId,
      reason: body.reason ?? "guided stock group repair",
      expectedHash: body.expectedHash,
    });

    return ok({ ok: true, branches: results });
  } catch (error) {
    return toHttpErrorResponse(error);
  }
}
