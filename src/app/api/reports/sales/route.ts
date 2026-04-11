import { resolveReportRequest, csvReportResponse } from "@/modules/reports/http";
import { toCsv } from "@/modules/reports/serializers";
import { getSalesReportRows } from "@/modules/reports/service";
import { toHttpErrorResponse } from "@/lib/http";

const COLUMNS = ["fecha", "sucursal_codigo", "sucursal_nombre", "orden", "estado", "vendedor", "total"];

export async function GET(request: Request) {
  try {
    const resolved = await resolveReportRequest(request);
    if ("error" in resolved) return resolved.error;

    const rows = await getSalesReportRows({
      branchIds: resolved.branchIds,
      dateFrom: resolved.query.dateFrom,
      dateTo: resolved.query.dateTo,
      status: resolved.query.status,
    });

    return csvReportResponse("reporte-ventas.csv", toCsv(COLUMNS, rows));
  } catch (error) {
    return toHttpErrorResponse(error);
  }
}
