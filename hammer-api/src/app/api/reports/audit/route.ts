import { resolveReportRequest, reportResponse } from "@/modules/reports/http";
import { toCsv } from "@/modules/reports/serializers";
import { getAuditReportRows } from "@/modules/reports/service";
import { toHttpErrorResponse } from "@/lib/http";

const COLUMNS = ["fecha", "sucursal_codigo", "sucursal_nombre", "modulo", "accion", "usuario", "entidad", "entidad_id"];

export async function GET(request: Request) {
  try {
    const resolved = await resolveReportRequest(request);
    if ("error" in resolved) return resolved.error;

    const rows = await getAuditReportRows({
      branchIds: resolved.branchIds,
      dateFrom: resolved.query.dateFrom,
      dateTo: resolved.query.dateTo,
      status: resolved.query.status,
      actorUsername: resolved.query.actorUsername,
    });

    return reportResponse(resolved, "reporte-bitacora.csv", toCsv(COLUMNS, rows), rows);
  } catch (error) {
    return toHttpErrorResponse(error);
  }
}
