import { resolveReportRequest, reportResponse } from "@/modules/reports/http";
import { toCsv } from "@/modules/reports/serializers";
import { getInventoryCriticalReportRows } from "@/modules/reports/service";
import { toHttpErrorResponse } from "@/lib/http";

const COLUMNS = ["sucursal_codigo", "sucursal_nombre", "sku", "producto", "existencia", "costo_promedio", "valor_inventario"];

export async function GET(request: Request) {
  try {
    const resolved = await resolveReportRequest(request);
    if ("error" in resolved) return resolved.error;

    const rows = await getInventoryCriticalReportRows({
      branchIds: resolved.branchIds,
    });

    return reportResponse(resolved, "reporte-inventario-critico.csv", toCsv(COLUMNS, rows), rows, "inventory-critical");
  } catch (error) {
    return toHttpErrorResponse(error);
  }
}
