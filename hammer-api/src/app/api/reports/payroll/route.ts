import { resolveReportRequest, csvReportResponse } from "@/modules/reports/http";
import { toCsv } from "@/modules/reports/serializers";
import { getPayrollReportRows } from "@/modules/reports/service";
import { toHttpErrorResponse } from "@/lib/http";

const COLUMNS = [
  "ano",
  "mes",
  "sucursal",
  "empleado",
  "puesto",
  "salario_bruto",
  "deducciones_prestamos",
  "otras_deducciones",
  "neto_a_pagar",
  "costo_empresa",
  "estado_run",
];

export async function GET(request: Request) {
  try {
    const resolved = await resolveReportRequest(request);
    if ("error" in resolved) return resolved.error;

    const rows = await getPayrollReportRows({
      ...resolved.query,
      branchIds: resolved.branchIds,
    });

    return csvReportResponse("reporte-nomina.csv", toCsv(COLUMNS, rows));
  } catch (error: unknown) {
    return toHttpErrorResponse(error);
  }
}
