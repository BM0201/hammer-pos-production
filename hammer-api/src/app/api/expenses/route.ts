import { NextRequest } from "next/server";
import { getCurrentSession } from "@/modules/auth/service";
import { assertAuthenticated, assertFinanceAccess } from "@/modules/auth/access";
import { toHttpErrorResponse } from "@/lib/http";
import { createExpenseSchema } from "@/modules/pricing/validators";
import { requireCsrf } from "@/modules/security/csrf";
import { ok, created, fail } from "@/lib/api/response";
import {
  createOperatingExpense,
  listExpensesByBranch,
  getExpenseSummaryByBranch,
  getExpenseSummaryAllBranches,
} from "@/modules/pricing/service";

/**
 * GET /api/expenses?branchId=xxx&summary=true
 * List expenses for a branch. Master only.
 */
export async function GET(req: NextRequest) {
  try {
    const session = await getCurrentSession();
    assertAuthenticated(session);
    assertFinanceAccess(session);

    const { searchParams } = new URL(req.url);
    const branchId = searchParams.get("branchId");
    const summary = searchParams.get("summary") === "true";

    // "all" = resumen consolidado de todas las sucursales (solo lectura).
    // La lista detallada (editar/borrar gasto a gasto) sigue exigiendo una
    // sucursal específica.
    if (!branchId || branchId === "all") {
      if (!summary) {
        return fail("VALIDATION_ERROR", "branchId is required to list individual expenses", 400);
      }
      const result = await getExpenseSummaryAllBranches();
      return ok(result);
    }

    if (summary) {
      const result = await getExpenseSummaryByBranch(branchId);
      return ok(result);
    }

    const expenses = await listExpensesByBranch(branchId);
    return ok(expenses);
  } catch (error) {
    return toHttpErrorResponse(error);
  }
}

/**
 * POST /api/expenses
 * Create a new operating expense. Master only.
 */
export async function POST(req: NextRequest) {
  try {
    const session = await getCurrentSession();
    assertAuthenticated(session);
    await requireCsrf(req, session);
    assertFinanceAccess(session);

    const body = await req.json();
    const parsed = createExpenseSchema.parse(body);
    // La planilla NO se registra a mano: el costo laboral se sincroniza solo
    // al postear la nómina — un gasto PAYROLL manual la duplicaría.
    if (parsed.category === "PAYROLL") {
      return fail(
        "VALIDATION_ERROR",
        "La planilla no se registra como gasto manual: se sincroniza automáticamente al postear la nómina.",
        400,
      );
    }
    const expense = await createOperatingExpense(parsed, session.userId);

    return created(expense);
  } catch (error) {
    if (error instanceof Error && error.name === "ZodError") {
      return fail("VALIDATION_ERROR", "Datos inv\u00e1lidos", 400);
    }
    return toHttpErrorResponse(error);
  }
}
