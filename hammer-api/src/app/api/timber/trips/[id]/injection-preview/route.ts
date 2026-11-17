import { NextRequest } from "next/server";
import { getCurrentSession } from "@/modules/auth/service";
import { assertAuthenticated } from "@/modules/auth/access";
import { assertMaster } from "@/modules/security/rbac-helpers";
import { getTimberTripInjectionPreview } from "@/modules/timber/service";
import { timberErrorResponse } from "@/modules/timber/errors";
import { ok } from "@/lib/api/response";

// GET → por medida, antes → después de costo y precio, SIN escribir nada. El hash
// devuelto debe pasarse a PATCH .../trips/{id} {action:"confirm", expectedHash} para ingresar.
export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const session = await getCurrentSession();
    assertAuthenticated(session);
    // Mismo detalle de costo/margen que se va a ingresar: Master, igual que confirmar.
    assertMaster(session);

    const { id } = await params;
    return ok(await getTimberTripInjectionPreview(id));
  } catch (err: unknown) {
    return timberErrorResponse(err);
  }
}
