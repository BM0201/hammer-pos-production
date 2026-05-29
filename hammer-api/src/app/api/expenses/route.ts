import { NextRequest, NextResponse } from "next/server";
import { getCurrentSession } from "@/modules/auth/service";
import { assertAuthenticated, assertMaster } from "@/modules/auth/access";
import { toHttpErrorResponse } from "@/lib/http";
import { createExpenseSchema } from "@/modules/pricing/validators";
import { requireCsrf } from "@/modules/security/csrf";
import { ok, created, fail } from "@/lib/api/response";
import {
  createOperatingExpense,
  listExpensesByBranch,
  getExpenseSummaryByBranch,
} from "@/modules/pricing/service";

/**
 * GET /api/expenses?branchId=xxx&summary=true
 * List expenses for a branch. Master only.
 */
export async function GET(req: NextRequest) {
  try {
    const session = await getCurrentSession();
    assertAuthenticated(session);
    assertMaster(session);

    const { searchParams } = new URL(req.url);
    const branchId = searchParams.get("branchId");
    const summary = searchParams.get("summary") === "true";

    if (!branchId) {
      return fail("VALIDATION_ERROR", "branchId is required", 400);
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
    assertMaster(session);

    const body = await req.json();
    const parsed = createExpenseSchema.parse(body);
    const expense = await createOperatingExpense(parsed, session.userId);

    return created(expense);
  } catch (error) {
    if (error instanceof Error && error.name === "ZodError") {
      return fail("VALIDATION_ERROR", "Datos inv\u00e1lidos", 400);
    }
    return toHttpErrorResponse(error);
  }
}
