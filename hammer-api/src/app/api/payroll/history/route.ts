import { NextRequest } from "next/server";
import { getCurrentSession } from "@/modules/auth/service";
import { assertAuthenticated, assertMaster } from "@/modules/auth/access";
import { toHttpErrorResponse } from "@/lib/http";
import { getSalaryHistory, listPayrollRuns, serializePayrollRunResult } from "@/modules/payroll/payroll-service";
import { ok } from "@/lib/api/response";

/** GET /api/payroll/history — get salary history */
export async function GET(req: NextRequest) {
  try {
    const session = await getCurrentSession();
    assertAuthenticated(session);
    assertMaster(session!);

    const url = new URL(req.url);
    const employeeId = url.searchParams.get("employeeId") ?? undefined;
    const startMonth = url.searchParams.get("startMonth") ?? undefined;
    const endMonth = url.searchParams.get("endMonth") ?? undefined;
    const runs = url.searchParams.get("runs") === "true";
    const branchId = url.searchParams.get("branchId") ?? undefined;
    const status = url.searchParams.get("status") ?? undefined;

    if (runs) {
      const rows = await listPayrollRuns({ branchId, status });
      return ok(rows.map((run) => serializePayrollRunResult(run)));
    }

    const history = await getSalaryHistory({ employeeId, startMonth, endMonth });

    return ok(history);
  } catch (err: any) {
    return toHttpErrorResponse(err);
  }
}
