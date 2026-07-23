import { getCurrentSession } from "@/modules/auth/service";
import { assertAuthenticated, assertMaster } from "@/modules/auth/access";
import { ok } from "@/lib/api/response";
import { toHttpErrorResponse } from "@/lib/http";
import { previewUnmergeStockGroup } from "@/modules/catalog/stock-group-crud";

// POST → preview de desfusión (Fusión de Inventario v2, Fase 2.2): muestra
// cómo quedaría el stock por sucursal si se reasigna todo al producto
// indicado, SIN escribir nada. targetProductId es opcional (default: el
// canónico/base).
export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  try {
    const session = await getCurrentSession();
    assertAuthenticated(session);
    assertMaster(session);

    const { id } = await context.params;
    const body = (await request.json().catch(() => ({}))) as { targetProductId?: string };

    return ok(await previewUnmergeStockGroup({ stockGroupId: id, targetProductId: body.targetProductId }));
  } catch (error) {
    return toHttpErrorResponse(error);
  }
}
