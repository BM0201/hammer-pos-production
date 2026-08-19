import { getCurrentSession } from "@/modules/auth/service";
import { assertAuthenticated, assertFinanceAccess } from "@/modules/auth/access";
import { ok, fail } from "@/lib/api/response";
import { toHttpErrorResponse } from "@/lib/http";
import { getDisbursementPeriodsForMonth } from "@/modules/payroll/payroll-disbursement-service";

/**
 * Desembolsos de la corrida de un mes — el frontend calcula pendingHalf()
 * sobre esto. Sin año/mes, usa el mes calendario actual (Managua).
 */
export async function GET(request: Request) {
  try {
    const session = await getCurrentSession();
    assertAuthenticated(session);
    assertFinanceAccess(session!);

    const url = new URL(request.url);
    const now = new Date();
    const managua = new Intl.DateTimeFormat("en-CA", { timeZone: "America/Managua", year: "numeric", month: "2-digit" }).formatToParts(now);
    const defaultYear = Number(managua.find((p) => p.type === "year")?.value);
    const defaultMonth = Number(managua.find((p) => p.type === "month")?.value);

    const year = Number(url.searchParams.get("year") ?? defaultYear);
    const month = Number(url.searchParams.get("month") ?? defaultMonth);
    const branchId = url.searchParams.get("branchId");

    if (!Number.isInteger(year) || !Number.isInteger(month) || month < 1 || month > 12) {
      return fail("VALIDATION_ERROR", "year/month invalidos.", 400);
    }

    return ok(await getDisbursementPeriodsForMonth(year, month, branchId));
  } catch (error) {
    return toHttpErrorResponse(error);
  }
}
