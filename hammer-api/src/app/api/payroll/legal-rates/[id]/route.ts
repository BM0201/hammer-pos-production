import { getCurrentSession } from "@/modules/auth/service";
import { assertAuthenticated, assertMaster } from "@/modules/auth/access";
import { requireCsrf } from "@/modules/security/csrf";
import { ok } from "@/lib/api/response";
import { toHttpErrorResponse } from "@/lib/http";
import { deleteLegalRateVersion } from "@/modules/payroll/payroll-rate-config";

/**
 * DELETE /api/payroll/legal-rates/[id] — borra una versión de tasas legales.
 * Solo si no hay una corrida POSTED en su mes o en uno posterior. No hay
 * edición: para corregir una versión, se borra y se crea otra.
 * prompt-nomina-config.md Fase 2.4.
 */
export async function DELETE(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const session = await getCurrentSession();
    assertAuthenticated(session);
    await requireCsrf(request, session);
    assertMaster(session!);

    const { id } = await params;
    await deleteLegalRateVersion(id, session!.userId);
    return ok({ id });
  } catch (err: unknown) {
    return toHttpErrorResponse(err);
  }
}
