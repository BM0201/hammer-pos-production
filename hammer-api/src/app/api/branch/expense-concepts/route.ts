import { NextRequest } from "next/server";
import { getCurrentSession } from "@/modules/auth/service";
import { assertAuthenticated } from "@/modules/auth/access";
import { requireBranchCapability } from "@/modules/rbac/guards";
import { CAPABILITIES } from "@/modules/rbac/policies";
import { ok, fail } from "@/lib/api/response";
import { toApiErrorResponse } from "@/lib/api/errors";
import { listExpenseConcepts } from "@/modules/finance/expense-concepts";

/**
 * GET /api/branch/expense-concepts?branchId=&category= — lista de conceptos
 * para el selector del cajero al registrar un gasto (prompt-gastos-semana-
 * quincena.md Fase 4). El equivalente Master (/api/master/finance/expense-
 * concepts) exige FINANCE_VIEW, que un cajero no tiene — esta ruta usa el
 * mismo permiso que ya exige ver "Gastos del Local" en esa sucursal.
 */
export async function GET(req: NextRequest) {
  try {
    const session = await getCurrentSession();
    assertAuthenticated(session);

    const url = new URL(req.url);
    const branchId = url.searchParams.get("branchId");
    if (!branchId) return fail("VALIDATION_ERROR", "branchId es requerido", 400);
    requireBranchCapability(session, branchId, CAPABILITIES.OPERATING_EXPENSE_VIEW);

    const category = url.searchParams.get("category") ?? undefined;
    return ok(await listExpenseConcepts({ category }));
  } catch (error) {
    return toApiErrorResponse(error);
  }
}
