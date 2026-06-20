import { NextResponse } from "next/server";
import { resolveReportRequest } from "@/modules/reports/http";
import { getSalesSummaryAggregated } from "@/modules/reports/sales-analytics";
import { toHttpErrorResponse } from "@/lib/http";

export async function GET(request: Request) {
  try {
    const resolved = await resolveReportRequest(request);
    if ("error" in resolved) return resolved.error;

    const data = await getSalesSummaryAggregated({
      dateFrom: resolved.query.dateFrom,
      dateTo: resolved.query.dateTo,
      branchIds: resolved.branchIds,
    });

    return NextResponse.json(data, {
      status: 200,
      headers: { "cache-control": "no-store" },
    });
  } catch (error) {
    return toHttpErrorResponse(error);
  }
}
