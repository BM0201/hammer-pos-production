import { getCurrentSession } from "@/modules/auth/service";
import { assertAuthenticated, assertMaster } from "@/modules/auth/access";
import { toHttpErrorResponse } from "@/lib/http";
import { ok, fail } from "@/lib/api/response";
import { prisma } from "@/lib/prisma";
import { getWacHistory, WacHistoryNotFoundError } from "@/modules/inventory/wac-history";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * "que el WAC deje de moverse sin que nadie lo decida, y poder ver de
 * dónde salió cada valor" — PARTE A.1. Mismo permiso que el Kardex de
 * movimientos del producto (assertMaster, product-360.tsx → KardexTab):
 * es la misma pantalla la que va a mostrar esto.
 */
export async function GET(request: Request) {
  try {
    const session = await getCurrentSession();
    assertAuthenticated(session);
    assertMaster(session);

    const { searchParams } = new URL(request.url);
    const productId = searchParams.get("productId");
    const branchId = searchParams.get("branchId");
    if (!productId || !branchId) {
      return fail("VALIDATION_ERROR", "productId y branchId son obligatorios.", 400);
    }

    return ok(await getWacHistory(prisma, { productId, branchId }));
  } catch (error) {
    if (error instanceof WacHistoryNotFoundError) {
      return fail("NOT_FOUND", "Producto no encontrado.", 404);
    }
    return toHttpErrorResponse(error);
  }
}
