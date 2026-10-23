import { fail, ok } from "@/lib/api/response";
import { toHttpErrorResponse } from "@/lib/http";
import { assertAuthenticated } from "@/modules/auth/access";
import { getCurrentSession } from "@/modules/auth/service";
import { isMaster } from "@/modules/rbac/guards";
import { listOtherExpensesForReview } from "@/modules/finance/expense-reclassification";

/** GET /api/master/finance/expenses/other-for-review?start=&end=&branchId= — "Revisar N gastos en Otros". Solo Master/Owner. */
export async function GET(request: Request) {
  try {
    const session = await getCurrentSession();
    assertAuthenticated(session);
    if (!isMaster(session)) return fail("FORBIDDEN", "Solo Master puede revisar gastos en Otros.", 403);

    const url = new URL(request.url);
    const start = url.searchParams.get("start");
    const end = url.searchParams.get("end");
    if (!start || !end) return fail("VALIDATION_ERROR", "start y end son requeridos.", 400);

    const rows = await listOtherExpensesForReview({ start: new Date(start), end: new Date(end), branchId: url.searchParams.get("branchId") });
    return ok(rows);
  } catch (error) {
    return toHttpErrorResponse(error);
  }
}
