import { getCurrentSession } from "@/modules/auth/service";
import { assertAuthenticated, assertMaster } from "@/modules/auth/access";
import { ok, fail } from "@/lib/api/response";
import { toHttpErrorResponse } from "@/lib/http";
import { getBranchExposureStatus } from "@/modules/treasury/service";

/**
 * Exposición acumulada por sucursal (§1.3) — informa, nunca bloquea. El
 * umbral no tiene valor por defecto (ningún doc fijó un número): se pasa
 * por query si Master quiere ver el semáforo con SU propio criterio; sin
 * umbral, siempre "sin alerta" y solo se muestran los montos crudos.
 */
export async function GET(request: Request) {
  try {
    const session = await getCurrentSession();
    assertAuthenticated(session);
    assertMaster(session);

    const url = new URL(request.url);
    const branchId = url.searchParams.get("branchId");
    if (!branchId) return fail("VALIDATION_ERROR", "branchId es obligatorio.", 400);

    const maxAmountRaw = url.searchParams.get("maxAmount");
    const maxDaysRaw = url.searchParams.get("maxBusinessDays");
    const threshold = maxAmountRaw && maxDaysRaw
      ? { maxAmount: Number(maxAmountRaw), maxBusinessDays: Number(maxDaysRaw) }
      : null;

    return ok(await getBranchExposureStatus(branchId, threshold));
  } catch (error) {
    return toHttpErrorResponse(error);
  }
}
