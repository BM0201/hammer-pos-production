import { NextRequest } from "next/server";
import { getCurrentSession } from "@/modules/auth/service";
import { assertAuthenticated } from "@/modules/auth/access";
import { assertFinanceAccess } from "@/modules/security/rbac-helpers";
import { applyTimberBranchCost, previewTimberBranchCost } from "@/modules/timber/service";
import { timberBranchCostSchema } from "@/modules/timber/validators";
import { toHttpErrorResponse } from "@/lib/http";
import { requireCsrf } from "@/modules/security/csrf";
import { ok, fail } from "@/lib/api/response";

// GET → existencias en pies por sucursal y, con branchId, cada medida. Con costPerFoot
// muestra además el costo que quedaría, sin escribir nada.
export async function GET(req: NextRequest) {
  try {
    const session = await getCurrentSession();
    if (!session) return fail("ERROR", "No autenticado", 401);
    assertFinanceAccess(session);

    const branchId = req.nextUrl.searchParams.get("branchId") || null;
    const costPerFoot = Number(req.nextUrl.searchParams.get("costPerFoot"));
    const preview = await previewTimberBranchCost(branchId, costPerFoot > 0 ? costPerFoot : undefined);
    return ok(preview);
  } catch (err: unknown) {
    if (err instanceof Error && err.message === "BRANCH_NOT_FOUND") {
      return fail("NOT_FOUND", "Sucursal no encontrada", 404);
    }
    console.error("[TIMBER_BRANCH_COST_GET]", err);
    return toHttpErrorResponse(err);
  }
}

// POST → fija el costo por pie: escribe el costo de cada medida de ESA sucursal y lo audita.
export async function POST(req: NextRequest) {
  try {
    const session = await getCurrentSession();
    assertAuthenticated(session);
    await requireCsrf(req, session);
    assertFinanceAccess(session);

    const parsed = timberBranchCostSchema.safeParse(await req.json().catch(() => ({})));
    if (!parsed.success) {
      return fail("VALIDATION_ERROR", parsed.error.issues[0]?.message ?? "Validación fallida", 400);
    }

    const result = await applyTimberBranchCost(parsed.data.branchId, parsed.data.costPerFoot, session.userId);
    return ok(result);
  } catch (err: unknown) {
    if (err instanceof Error && err.message === "BRANCH_NOT_FOUND") {
      return fail("NOT_FOUND", "Sucursal no encontrada", 404);
    }
    console.error("[TIMBER_BRANCH_COST_POST]", err);
    return toHttpErrorResponse(err);
  }
}
