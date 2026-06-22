import { resolveReportRequest, reportResponse } from "@/modules/reports/http";
import { toCsv } from "@/modules/reports/serializers";
import { getEmployeeLoansReportRows } from "@/modules/reports/service";
import { toHttpErrorResponse } from "@/lib/http";

const COLUMNS = [
  "fecha",
  "sucursal",
  "empleado",
  "monto_original",
  "saldo_pendiente",
  "cuota",
  "estado",
  "notas",
];

export async function GET(request: Request) {
  try {
    const resolved = await resolveReportRequest(request);
    if ("error" in resolved) return resolved.error;

    const rows = await getEmployeeLoansReportRows({
      ...resolved.query,
      branchIds: resolved.branchIds,
    });

    return reportResponse(resolved, "reporte-prestamos-empleados.csv", toCsv(COLUMNS, rows), rows, "employee-loans");
  } catch (error: unknown) {
    return toHttpErrorResponse(error);
  }
}
