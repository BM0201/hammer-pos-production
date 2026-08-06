import { getCurrentSession } from "@/modules/auth/service";
import { assertAuthenticated, assertMaster } from "@/modules/auth/access";
import { getPrintSettingsByBranch, upsertPrintSettings } from "@/modules/print/service";
import { upsertPrintSettingsSchema } from "@/modules/print/validation";
import { toHttpErrorResponse } from "@/lib/http";
import { requireCsrf } from "@/modules/security/csrf";
import { ok, fail, validationFail } from "@/lib/api/response";

type RouteParams = { params: Promise<{ branchId: string }> };

/**
 * GET /api/master/print-settings/[branchId]
 * Obtener configuración de impresión de una sucursal específica.
 */
export async function GET(_request: Request, { params }: RouteParams) {
  try {
    const session = await getCurrentSession();
    assertAuthenticated(session);
    assertMaster(session);

    const { branchId } = await params;
    const settings = await getPrintSettingsByBranch(branchId);
    if (!settings) {
      return fail("NOT_FOUND", "No hay configuración de impresión para esta sucursal.", 404);
    }
    return ok(settings);
  } catch (err) {
    return toHttpErrorResponse(err);
  }
}

/**
 * PATCH /api/master/print-settings/[branchId]
 * Actualizar configuración de impresión de una sucursal.
 */
export async function PATCH(request: Request, { params }: RouteParams) {
  try {
    const session = await getCurrentSession();
    assertAuthenticated(session);
    assertMaster(session);
    await requireCsrf(request, session);

    const { branchId } = await params;
    const body = await request.json();
    const parsed = upsertPrintSettingsSchema.safeParse({ ...body, branchId });
    if (!parsed.success) return validationFail(parsed.error);

    const result = await upsertPrintSettings(parsed.data);
    return ok(result);
  } catch (err) {
    return toHttpErrorResponse(err);
  }
}
