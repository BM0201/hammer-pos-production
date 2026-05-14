import { resolveReportRequest, csvReportResponse } from "@/modules/reports/http";
import { toCsv } from "@/modules/reports/serializers";
import { getPaymentsReportRows } from "@/modules/reports/service";
import { toHttpErrorResponse } from "@/lib/http";

const COLUMNS = ["fecha_pago", "sucursal_codigo", "sucursal_nombre", "orden", "metodo", "estado", "cajero", "monto", "referencia"];

export async function GET(request: Request) {
  try {
    const resolved = await resolveReportRequest(request);
    if ("error" in resolved) return resolved.error;

    const rows = await getPaymentsReportRows({
      branchIds: resolved.branchIds,
      dateFrom: resolved.query.dateFrom,
      dateTo: resolved.query.dateTo,
      status: resolved.query.status,
      actorUsername: resolved.query.actorUsername,
    });

    return csvReportResponse("reporte-cobros.csv", toCsv(COLUMNS, rows));
  } catch (error) {
    return toHttpErrorResponse(error);
  }
}
