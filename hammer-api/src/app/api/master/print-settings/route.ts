import { getCurrentSession } from "@/modules/auth/service";
import { assertAuthenticated, assertMaster } from "@/modules/auth/access";
import { getAllPrintSettings, upsertPrintSettings } from "@/modules/print/service";
import { upsertPrintSettingsSchema } from "@/modules/print/validation";
import { toHttpErrorResponse } from "@/lib/http";
import { requireCsrf } from "@/modules/security/csrf";
import { ok, validationFail } from "@/lib/api/response";

/**
 * GET /api/master/print-settings
 * Lista configuración de impresión de todas las sucursales.
 */
export async function GET() {
  try {
    const session = await getCurrentSession();
    assertAuthenticated(session);
    assertMaster(session);

    const settings = await getAllPrintSettings();
    return ok(settings);
  } catch (err) {
    return toHttpErrorResponse(err);
  }
}

/**
 * POST /api/master/print-settings
 * Crear/actualizar configuración de impresión para una sucursal.
 */
export async function POST(request: Request) {
  try {
    const session = await getCurrentSession();
    assertAuthenticated(session);
    assertMaster(session);
    await requireCsrf(request, session);

    const body = await request.json();
    const parsed = upsertPrintSettingsSchema.safeParse(body);
    if (!parsed.success) return validationFail(parsed.error);

    const result = await upsertPrintSettings(parsed.data);
    return ok(result);
  } catch (err) {
    return toHttpErrorResponse(err);
  }
}
