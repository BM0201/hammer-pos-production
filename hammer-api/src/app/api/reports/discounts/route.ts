import { resolveReportRequest, reportResponse } from "@/modules/reports/http";
import { toCsv } from "@/modules/reports/serializers";
import { getDiscountsReportRows } from "@/modules/reports/service";
import { toHttpErrorResponse } from "@/lib/http";

const COLUMNS = [
  "fecha",
  "sucursal_codigo",
  "sucursal_nombre",
  "orden",
  "producto_sku",
  "producto_nombre",
  "cantidad",
  "precio_unitario",
  "subtotal_bruto",
  "descuento_monto",
  "descuento_porcentaje_efectivo",
  "subtotal_final",
  "vendedor",
];

export async function GET(request: Request) {
  try {
    const resolved = await resolveReportRequest(request);
    if ("error" in resolved) return resolved.error;

    const rows = await getDiscountsReportRows({
      branchIds: resolved.branchIds,
      dateFrom: resolved.query.dateFrom,
      dateTo: resolved.query.dateTo,
      status: resolved.query.status,
      actorUsername: resolved.query.actorUsername,
    });

    return reportResponse(resolved, "reporte-descuentos.csv", toCsv(COLUMNS, rows), rows);
  } catch (error) {
    return toHttpErrorResponse(error);
  }
}
