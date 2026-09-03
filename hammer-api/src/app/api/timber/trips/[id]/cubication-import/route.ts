import { NextRequest } from "next/server";
import { getCurrentSession } from "@/modules/auth/service";
import { assertAuthenticated } from "@/modules/auth/access";
import { assertMaster } from "@/modules/security/rbac-helpers";
import { previewTimberCubicationImport } from "@/modules/timber/service";
import { toHttpErrorResponse } from "@/lib/http";
import { requireCsrf } from "@/modules/security/csrf";
import { ok, fail } from "@/lib/api/response";

/**
 * prompt-timber-cubicacion-carga.md, Parte B — POST (no PUT/GET): sube el
 * archivo de cubicación (hoja "Simple", columna MEDIDA + PIEZAS) y
 * devuelve un PREVIEW, sin escribir nada. Mismo guard que el resto de
 * .../trips/{id} (MASTER — expone costo/pies del viaje). El cliente
 * aplica el resultado editando `lines` localmente (mismo mecanismo que
 * updateLinePieces/addMeasure en timber-workspace.tsx) y lo guarda con
 * el PUT .../trips/{id} de siempre — no hay un camino de escritura nuevo.
 */
export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const session = await getCurrentSession();
    assertAuthenticated(session);
    await requireCsrf(req, session);
    assertMaster(session);

    const { id } = await params;
    const body = await req.json().catch(() => null);
    const fileBase64 = typeof body?.fileBase64 === "string" ? body.fileBase64 : null;
    if (!fileBase64) {
      return fail("VALIDATION_ERROR", "fileBase64 es obligatorio.", 400);
    }

    const preview = await previewTimberCubicationImport(id, fileBase64);
    return ok(preview);
  } catch (err: unknown) {
    if (err instanceof Error) {
      if (err.message === "TIMBER_TRIP_NOT_FOUND") {
        return fail("NOT_FOUND", err.message, 404);
      }
      if (err.message === "EMPTY_CUBICATION_FILE") {
        return fail("VALIDATION_ERROR", "El archivo está vacío o no se pudo leer.", 400);
      }
      if (err.message === "CUBICATION_COLUMNS_NOT_FOUND") {
        return fail("VALIDATION_ERROR", "No se encontraron las columnas MEDIDA y PIEZAS en la hoja \"Simple\" (o la primera hoja) del archivo.", 400);
      }
    }
    return toHttpErrorResponse(err);
  }
}
