import { resolveReportRequest, reportResponse } from "@/modules/reports/http";
import { toCsv } from "@/modules/reports/serializers";
import { getApprovalsReportRows } from "@/modules/reports/service";
import { toHttpErrorResponse } from "@/lib/http";

const COLUMNS = ["fecha_solicitud", "sucursal_codigo", "sucursal_nombre", "tipo", "estado", "solicitado_por", "resuelto_por", "referencia_tipo", "referencia_id", "motivo"];

export async function GET(request: Request) {
  try {
    const resolved = await resolveReportRequest(request);
    if ("error" in resolved) return resolved.error;

    const rows = await getApprovalsReportRows({
      branchIds: resolved.branchIds,
      dateFrom: resolved.query.dateFrom,
      dateTo: resolved.query.dateTo,
      status: resolved.query.status,
      actorUsername: resolved.query.actorUsername,
    });

    return reportResponse(resolved, "reporte-aprobaciones.csv", toCsv(COLUMNS, rows), rows);
  } catch (error) {
    return toHttpErrorResponse(error);
  }
}
