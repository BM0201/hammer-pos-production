import { getCurrentSession } from "@/modules/auth/service";
import { assertAuthenticated, assertMaster } from "@/modules/auth/access";
import { toHttpErrorResponse } from "@/lib/http";
import { ok, fail } from "@/lib/api/response";
import { prisma } from "@/lib/prisma";
import { getProductPriceHistory } from "@/modules/catalog/price-history";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * "Historial de precio, como el del WAC" — Parte B.3. Mismo permiso que
 * wac-history (assertMaster): es la misma ficha de producto la que va a
 * mostrar esto.
 */
export async function GET(request: Request) {
  try {
    const session = await getCurrentSession();
    assertAuthenticated(session);
    assertMaster(session);

    const { searchParams } = new URL(request.url);
    const productId = searchParams.get("productId");
    if (!productId) return fail("VALIDATION_ERROR", "productId es obligatorio.", 400);

    return ok(await getProductPriceHistory(prisma, { productId }));
  } catch (error) {
    return toHttpErrorResponse(error);
  }
}
