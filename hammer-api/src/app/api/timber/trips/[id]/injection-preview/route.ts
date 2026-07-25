import { NextRequest } from "next/server";
import { getCurrentSession } from "@/modules/auth/service";
import { assertAuthenticated } from "@/modules/auth/access";
import { getTimberTripInjectionPreview } from "@/modules/timber/service";
import { toHttpErrorResponse } from "@/lib/http";
import { ok, fail } from "@/lib/api/response";

// GET → preview de inyección (Madera v2 Fase 2.4): por línea, antes → después de costo
// unitario, WAC proyectado, costo de sucursal y precio de venta, SIN escribir nada. El hash
// devuelto debe pasarse a PATCH .../trips/{id} {action:"confirm", expectedHash} para aplicar.
export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const session = await getCurrentSession();
    assertAuthenticated(session);

    const { id } = await params;
    const preview = await getTimberTripInjectionPreview(id);
    return ok(preview);
  } catch (err: unknown) {
    if (err instanceof Error && err.message === "TIMBER_TRIP_NOT_FOUND") {
      return fail("NOT_FOUND", err.message, 404);
    }
    return toHttpErrorResponse(err);
  }
}
