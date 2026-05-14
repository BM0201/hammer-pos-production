import { NextRequest, NextResponse } from "next/server";
import { getCurrentSession } from "@/modules/auth/service";
import { assertAuthenticated, assertMaster } from "@/modules/auth/access";
import { toHttpErrorResponse } from "@/lib/http";
import { getSalaryHistory } from "@/modules/payroll/payroll-service";

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

    const history = await getSalaryHistory({ employeeId, startMonth, endMonth });

    return NextResponse.json({ data: history });
  } catch (err: any) {
    return toHttpErrorResponse(err);
  }
}
