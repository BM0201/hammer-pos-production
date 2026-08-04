import { NextRequest } from "next/server";
import { getCurrentSession } from "@/modules/auth/service";
import { assertAuthenticated } from "@/modules/auth/access";
import { assertMaster } from "@/modules/security/rbac-helpers";
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

    // Auditoría 2026-08-03: solo exigía sesión. La acción que este preview
    // antecede (PATCH .../trips/{id} action:"confirm") ya exige MASTER, y
    // el preview expone el mismo detalle de costo/margen que se va a
    // inyectar — no tiene sentido dejarlo abierto a cualquier rol.
    assertMaster(session);

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
