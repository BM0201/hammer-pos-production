import { resolveReportRequest, reportResponse } from "@/modules/reports/http";
import { toCsv } from "@/modules/reports/serializers";
import { getDispatchReportRows } from "@/modules/reports/service";
import { toHttpErrorResponse } from "@/lib/http";

const COLUMNS = ["fecha", "sucursal_codigo", "sucursal_nombre", "orden", "estado", "despachado_por", "fecha_despacho", "notas"];

export async function GET(request: Request) {
  try {
    const resolved = await resolveReportRequest(request);
    if ("error" in resolved) return resolved.error;

    const rows = await getDispatchReportRows({
      branchIds: resolved.branchIds,
      dateFrom: resolved.query.dateFrom,
      dateTo: resolved.query.dateTo,
      status: resolved.query.status,
    });

    return reportResponse(resolved, "reporte-despachos.csv", toCsv(COLUMNS, rows), rows, "dispatch");
  } catch (error) {
    return toHttpErrorResponse(error);
  }
}
