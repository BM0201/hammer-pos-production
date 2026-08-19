import { getCurrentSession } from "@/modules/auth/service";
import { assertAuthenticated, assertMaster } from "@/modules/auth/access";
import { hasBranchAccess } from "@/modules/rbac/guards";
import { requireCsrf } from "@/modules/security/csrf";
import { ok, fail, validationFail } from "@/lib/api/response";
import { toHttpErrorResponse } from "@/lib/http";
import { getPrintSettings } from "@/modules/printing/printing-service";
import { upsertPrintSettings } from "@/modules/print/service";
import { upsertPrintSettingsSchema } from "@/modules/print/validation";

export async function GET(request: Request) {
  try {
    const session = await getCurrentSession();
    assertAuthenticated(session);

    const url = new URL(request.url);
    const branchId = url.searchParams.get("branchId");
    if (!branchId) return validationFail({ branchId: "branchId es obligatorio" });

    // Auditoría 2026-08-03: solo exigía sesión — cualquier usuario
    // autenticado podía leer la config de impresión de otra sucursal
    // cambiando branchId. El PUT de este mismo archivo ya exige Master.
    if (!hasBranchAccess(session, branchId)) {
      return fail("FORBIDDEN", "No tienes acceso a esta sucursal.", 403);
    }

    const settings = await getPrintSettings({ branchId, cashRegisterId: url.searchParams.get("cashRegisterId") });
    return ok(settings);
  } catch (error) {
    return toHttpErrorResponse(error);
  }
}

export async function PUT(request: Request) {
  try {
    const session = await getCurrentSession();
    assertAuthenticated(session);
    assertMaster(session);
    await requireCsrf(request, session);

    const body = await request.json();
    const mapped = {
      ...body,
      printerName: body.printerName ?? body.name ?? null,
      printerMode: body.printerMode ?? body.printerType,
      paperWidth: body.paperWidth ?? body.paperSize,
      footerText: body.footerText ?? body.footerMessage,
      autoPrint: body.autoPrint ?? body.autoPrintTicket,
      copies: body.copies ?? body.copiesTicket,
    };
    const parsed = upsertPrintSettingsSchema.safeParse(mapped);
    if (!parsed.success) return validationFail(parsed.error);

    const saved = await upsertPrintSettings({ ...parsed.data, actorUserId: session.userId });
    const settings = await getPrintSettings({ branchId: saved.branchId });
    return ok(settings);
  } catch (error) {
    return toHttpErrorResponse(error);
  }
}
