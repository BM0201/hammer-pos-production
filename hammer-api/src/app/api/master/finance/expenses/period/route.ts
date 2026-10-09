import { fail, ok } from "@/lib/api/response";
import { toHttpErrorResponse } from "@/lib/http";
import { assertAuthenticated } from "@/modules/auth/access";
import { getCurrentSession } from "@/modules/auth/service";
import { isMaster, canInBranch, hasCapabilityInAnyAssignedBranch } from "@/modules/rbac/guards";
import { CAPABILITIES } from "@/modules/rbac/policies";
import { parseListLimit } from "@/lib/api/list-limit";
import { getExpensePeriodReport } from "@/modules/finance/expense-period-report";
import { expensePeriodReportSchema } from "@/modules/finance/validators";

/**
 * GET /api/master/finance/expenses/period — libro de gastos de un período
 * (día/semana/quincena/mes/rango) con comparación, presupuesto prorrateado
 * y alertas. prompt-gastos-semana-quincena.md Fase 2.4.
 */
export async function GET(request: Request) {
  try {
    const session = await getCurrentSession();
    assertAuthenticated(session);

    const url = new URL(request.url);
    const parsed = expensePeriodReportSchema.safeParse({
      branchId: url.searchParams.get("branchId") ?? undefined,
      kind: url.searchParams.get("kind") ?? undefined,
      date: url.searchParams.get("date") ?? undefined,
      from: url.searchParams.get("from") ?? undefined,
      to: url.searchParams.get("to") ?? undefined,
      basis: url.searchParams.get("basis") ?? undefined,
      limit: url.searchParams.get("limit") ?? undefined,
      offset: url.searchParams.get("offset") ?? undefined,
      category: url.searchParams.get("category") ?? undefined,
      source: url.searchParams.get("source") ?? undefined,
      conceptId: url.searchParams.get("conceptId") ?? undefined,
      text: url.searchParams.get("text") ?? undefined,
    });
    if (!parsed.success) return fail("VALIDATION_ERROR", "Parámetros inválidos.", 400, parsed.error.flatten());

    const branchId = parsed.data.branchId ?? null;

    if (!isMaster(session)) {
      if (branchId) {
        if (!canInBranch(session, branchId, CAPABILITIES.FINANCE_VIEW)) {
          return fail("FORBIDDEN", "No tienes permiso para ver finanzas de esta sucursal.", 403);
        }
      } else if (!hasCapabilityInAnyAssignedBranch(session, CAPABILITIES.FINANCE_VIEW)) {
        return fail("FORBIDDEN", "No tienes permiso para ver finanzas.", 403);
      }
    }

    const data = await getExpensePeriodReport({
      kind: parsed.data.kind,
      anchorDate: parsed.data.date,
      custom: parsed.data.kind === "CUSTOM" && parsed.data.from && parsed.data.to ? { from: parsed.data.from, to: parsed.data.to } : undefined,
      branchId,
      basis: parsed.data.basis,
      rowsLimit: parseListLimit(parsed.data.limit, { default: 50 }),
      rowsOffset: parsed.data.offset ?? 0,
      rowsFilter: {
        category: parsed.data.category,
        source: parsed.data.source,
        conceptId: parsed.data.conceptId,
        text: parsed.data.text,
      },
    });

    return ok(data);
  } catch (error) {
    return toHttpErrorResponse(error);
  }
}
