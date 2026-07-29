import { resolveReportRequest, reportResponse } from "@/modules/reports/http";
import { toCsv } from "@/modules/reports/serializers";
import { getSalesReportRows } from "@/modules/reports/service";
import { toHttpErrorResponse } from "@/lib/http";

// CAMBIO 1 (prompt-reportes-v2): "sales" ahora es el detalle por línea — ver
// getSalesReportRows en reports/service.ts. El resumen por orden vive en
// /api/reports/sales-summary.
const COLUMNS = [
  "fecha",
  "sucursal_codigo",
  "sucursal_nombre",
  "orden",
  "producto_sku",
  "producto_nombre",
  "categoria",
  "cantidad",
  "precio_unitario",
  "costo_unitario",
  "costo_total",
  "subtotal",
  "margen_monto",
  "margen_porcentaje",
  "costo_fuente",
  "vendedor",
];

export async function GET(request: Request) {
  try {
    const resolved = await resolveReportRequest(request);
    if ("error" in resolved) return resolved.error;

    const { rows, totalCount } = await getSalesReportRows({
      branchIds: resolved.branchIds,
      dateFrom: resolved.query.dateFrom,
      dateTo: resolved.query.dateTo,
      status: resolved.query.status,
    });

    return reportResponse(resolved, "reporte-ventas.csv", toCsv(COLUMNS, rows), rows, "sales", totalCount);
  } catch (error) {
    return toHttpErrorResponse(error);
  }
}
