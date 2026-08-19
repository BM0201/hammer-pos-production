import { resolveReportRequest, reportResponse } from "@/modules/reports/http";
import { toCsv } from "@/modules/reports/serializers";
import { getSalesByCategoryReportRows } from "@/modules/reports/service";
import { toHttpErrorResponse } from "@/lib/http";

// CAMBIO 2 (prompt-reportes-v2) — ver getSalesByCategoryReportRows, que
// reusa getSalesSummaryAggregated (sales-analytics.ts) en vez de una query
// paralela.
const COLUMNS = ["categoria", "ingreso", "costo", "margen_porcentaje", "porcentaje_total", "ordenes"];

export async function GET(request: Request) {
  try {
    const resolved = await resolveReportRequest(request);
    if ("error" in resolved) return resolved.error;

    const rows = await getSalesByCategoryReportRows({
      branchIds: resolved.branchIds,
      dateFrom: resolved.query.dateFrom,
      dateTo: resolved.query.dateTo,
    });

    return reportResponse(resolved, "reporte-ventas-por-categoria.csv", toCsv(COLUMNS, rows), rows, "sales-by-category");
  } catch (error) {
    return toHttpErrorResponse(error);
  }
}
