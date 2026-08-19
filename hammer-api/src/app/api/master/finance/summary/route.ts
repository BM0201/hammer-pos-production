import { fail, ok } from "@/lib/api/response";
import { toHttpErrorResponse } from "@/lib/http";
import { assertAuthenticated } from "@/modules/auth/access";
import { getCurrentSession } from "@/modules/auth/service";
import { isMaster, canInBranch, hasCapabilityInAnyAssignedBranch } from "@/modules/rbac/guards";
import { CAPABILITIES } from "@/modules/rbac/policies";
import { getFinanceSummary } from "@/modules/finance/service";
import { financeSummarySchema } from "@/modules/finance/validators";

export async function GET(request: Request) {
  try {
    const session = await getCurrentSession();
    assertAuthenticated(session);

    const url = new URL(request.url);
    const parsed = financeSummarySchema.safeParse({
      branchId: url.searchParams.get("branchId") ?? undefined,
      year: url.searchParams.get("year") ?? undefined,
      month: url.searchParams.get("month") ?? undefined,
    });
    if (!parsed.success) return fail("VALIDATION_ERROR", "Parámetros inválidos.", 400, parsed.error.flatten());

    const branchId = parsed.data.branchId ?? null;

    // Master/Owner/SystemAdmin ven todo. Un admin de sucursal solo ve su sucursal
    // si tiene FINANCE_VIEW; sin sucursal seleccionada se exige el permiso global.
    if (!isMaster(session)) {
      if (branchId) {
        if (!canInBranch(session, branchId, CAPABILITIES.FINANCE_VIEW)) {
          return fail("FORBIDDEN", "No tienes permiso para ver finanzas de esta sucursal.", 403);
        }
      } else if (!hasCapabilityInAnyAssignedBranch(session, CAPABILITIES.FINANCE_VIEW)) {
        return fail("FORBIDDEN", "No tienes permiso para ver finanzas.", 403);
      }
    }

    return ok(await getFinanceSummary({ branchId, year: parsed.data.year, month: parsed.data.month }));
  } catch (error) {
    return toHttpErrorResponse(error);
  }
}
