import { NextRequest } from "next/server";
import { getCurrentSession } from "@/modules/auth/service";
import { assertAuthenticated } from "@/modules/auth/access";
import { assertFinanceAccess } from "@/modules/security/rbac-helpers";
import { previewTimberSalePriceRecalc, applyTimberSalePriceRecalc } from "@/modules/timber/service";
import { timberErrorResponse } from "@/modules/timber/errors";
import { requireCsrf } from "@/modules/security/csrf";
import { ok, fail } from "@/lib/api/response";

// GET → vista previa (sin escribir) de cómo cambiaría sellingPrice de cada
// producto de madera al recalcular con el precio por pulgada vigente de la
// sucursal (o, sin branchId, de todas las que heredan el default global).
export async function GET(req: NextRequest) {
  try {
    const session = await getCurrentSession();
    if (!session) return fail("ERROR", "No autenticado", 401);
    assertFinanceAccess(session);

    const branchId = req.nextUrl.searchParams.get("branchId") || undefined;
    const rows = await previewTimberSalePriceRecalc(branchId);
    return ok(rows);
  } catch (err: unknown) {
    return timberErrorResponse(err);
  }
}

// POST → aplica la vista previa: escribe branchPrice en BranchProductSetting
// para esa sucursal (nunca branchCost, nunca otra sucursal) y audita cada cambio.
export async function POST(req: NextRequest) {
  try {
    const session = await getCurrentSession();
    assertAuthenticated(session);
    await requireCsrf(req, session);
    assertFinanceAccess(session);

    const body = await req.json().catch(() => ({}));
    const branchId = typeof body?.branchId === "string" ? body.branchId : "";
    if (!branchId) return fail("VALIDATION_ERROR", "Elegí una sucursal.", 400);

    const result = await applyTimberSalePriceRecalc(branchId, session.userId);
    return ok(result);
  } catch (err: unknown) {
    return timberErrorResponse(err);
  }
}
