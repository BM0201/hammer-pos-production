import { NextRequest } from "next/server";
import { getCurrentSession } from "@/modules/auth/service";
import { assertAuthenticated } from "@/modules/auth/access";
import { requireBranchCapability } from "@/modules/rbac/guards";
import { CAPABILITIES } from "@/modules/rbac/policies";
import { requireCsrf } from "@/modules/security/csrf";
import { ok, created, fail } from "@/lib/api/response";
import { toApiErrorResponse } from "@/lib/api/errors";
import { createOperatingExpense, listExpensesByBranch } from "@/modules/pricing/service";
import { z } from "zod";
import { EXPENSE_CATEGORIES } from "@/modules/pricing/validators";

const createSchema = z.object({
  branchId: z.string().min(1),
  category: z.enum(EXPENSE_CATEGORIES),
  description: z.string().min(1).max(200),
  amount: z.number().positive(),
  effectiveFrom: z.string().optional(),
  effectiveTo: z.string().optional(),
});

/**
 * GET /api/branch/expenses?branchId=xxx
 * Lists operating expenses for a branch. Accessible to BRANCH_ADMIN and MASTER.
 */
export async function GET(req: NextRequest) {
  try {
    const session = await getCurrentSession();
    assertAuthenticated(session);

    const branchId = new URL(req.url).searchParams.get("branchId");
    if (!branchId) return fail("VALIDATION_ERROR", "branchId es requerido", 400);

    requireBranchCapability(session, branchId, CAPABILITIES.OPERATING_EXPENSE_VIEW);

    const expenses = await listExpensesByBranch(branchId);
    return ok(expenses);
  } catch (error) {
    return toApiErrorResponse(error);
  }
}

/**
 * POST /api/branch/expenses
 * Creates a manual operating expense. Accessible to BRANCH_ADMIN and MASTER.
 */
export async function POST(req: NextRequest) {
  try {
    const session = await getCurrentSession();
    assertAuthenticated(session);
    await requireCsrf(req, session);

    const body = await req.json();
    const parsed = createSchema.safeParse(body);
    if (!parsed.success) return fail("VALIDATION_ERROR", "Datos inválidos", 400);

    requireBranchCapability(session, parsed.data.branchId, CAPABILITIES.OPERATING_EXPENSE_CREATE);

    const expense = await createOperatingExpense(parsed.data, session.userId);
    return created(expense);
  } catch (error) {
    return toApiErrorResponse(error);
  }
}
