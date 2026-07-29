import { resolveReportRequest, reportResponse } from "@/modules/reports/http";
import { toCsv } from "@/modules/reports/serializers";
import { getInventoryMovementsReportRows } from "@/modules/reports/service";
import type { MovementGroup } from "@/modules/reports/movement-groups";
import { toHttpErrorResponse } from "@/lib/http";

// CAMBIO 4 (prompt-reportes-v2): nunca existió reporte de InventoryMovement.
// `group` es el único parámetro nuevo (sub-tabs Todos/Envíos/Ingresos/
// Conteos/Ventas) — mismas claves que MOVEMENT_GROUP_LABEL.
const VALID_GROUPS = new Set<MovementGroup>(["envios", "ingresos", "conteos", "ventas"]);

const COLUMNS = [
  "fecha",
  "sucursal_codigo",
  "sucursal_nombre",
  "grupo",
  "tipo",
  "producto_sku",
  "producto_nombre",
  "categoria",
  "cantidad",
  "costo_unitario",
  "valor",
  "origen_destino",
  "referencia",
  "motivo",
];

export async function GET(request: Request) {
  try {
    const resolved = await resolveReportRequest(request);
    if ("error" in resolved) return resolved.error;

    const { searchParams } = new URL(request.url);
    const rawGroup = searchParams.get("group");
    const group = rawGroup && VALID_GROUPS.has(rawGroup as MovementGroup) ? (rawGroup as MovementGroup) : undefined;

    const { rows, totalCount } = await getInventoryMovementsReportRows({
      branchIds: resolved.branchIds,
      dateFrom: resolved.query.dateFrom,
      dateTo: resolved.query.dateTo,
      group,
    });

    return reportResponse(resolved, "reporte-movimientos-materiales.csv", toCsv(COLUMNS, rows), rows, "inventory-movements", totalCount);
  } catch (error) {
    return toHttpErrorResponse(error);
  }
}
