import { resolveReportRequest, reportResponse } from "@/modules/reports/http";
import { toCsv } from "@/modules/reports/serializers";
import { getSalesSummaryByOrderRows } from "@/modules/reports/service";
import { toHttpErrorResponse } from "@/lib/http";

// Vista "resumen por orden" conservada del reporte "sales" original —
// prompt-reportes-v2 CAMBIO 1.
const COLUMNS = ["fecha", "sucursal_codigo", "sucursal_nombre", "orden", "estado", "vendedor", "total"];

export async function GET(request: Request) {
  try {
    const resolved = await resolveReportRequest(request);
    if ("error" in resolved) return resolved.error;

    const rows = await getSalesSummaryByOrderRows({
      branchIds: resolved.branchIds,
      dateFrom: resolved.query.dateFrom,
      dateTo: resolved.query.dateTo,
      status: resolved.query.status,
    });

    return reportResponse(resolved, "reporte-ventas-resumen.csv", toCsv(COLUMNS, rows), rows, "sales-summary");
  } catch (error) {
    return toHttpErrorResponse(error);
  }
}
