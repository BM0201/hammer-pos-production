import { NextResponse } from "next/server";
import { resolveReportRequest } from "@/modules/reports/http";
import { getSalesProductsByDay } from "@/modules/reports/sales-analytics";
import { toHttpErrorResponse } from "@/lib/http";

export async function GET(request: Request) {
  try {
    const resolved = await resolveReportRequest(request);
    if ("error" in resolved) return resolved.error;

    const { searchParams } = new URL(request.url);
    const date = searchParams.get("date") ?? undefined;

    const rows = await getSalesProductsByDay({
      dateFrom: resolved.query.dateFrom,
      dateTo: resolved.query.dateTo,
      branchIds: resolved.branchIds,
      date,
    });

    return NextResponse.json(
      { rows, count: rows.length, generatedAt: new Date().toISOString() },
      { status: 200, headers: { "cache-control": "no-store" } },
    );
  } catch (error) {
    return toHttpErrorResponse(error);
  }
}
