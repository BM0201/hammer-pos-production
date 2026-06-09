import { SaleOrderStatus } from "@prisma/client";
import { getCurrentSession } from "@/modules/auth/service";
import { assertAuthenticated, assertMaster } from "@/modules/auth/access";
import { listSaleOrdersForManagement, type SalesManagementFilters } from "@/modules/sales/management-service";
import { toApiErrorResponse } from "@/lib/api/errors";
import { ok } from "@/lib/api/response";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function parseDate(value: string | null): Date | undefined {
  if (!value) return undefined;
  const d = new Date(value);
  return Number.isNaN(d.getTime()) ? undefined : d;
}

/**
 * GET /api/master/sales-management — Listado de TODAS las ventas para el panel
 * de gestión (solo MASTER). Soporta filtros por fecha, sucursal, estado y
 * banderas de prueba/anulación.
 */
export async function GET(request: Request) {
  try {
    const session = await getCurrentSession();
    assertAuthenticated(session);
    assertMaster(session!);

    const url = new URL(request.url);
    const q = url.searchParams;

    const statusParam = q.get("status");
    const validStatus = statusParam && (Object.values(SaleOrderStatus) as string[]).includes(statusParam)
      ? (statusParam as SaleOrderStatus)
      : undefined;

    const branchId = q.get("branchId");
    const filters: SalesManagementFilters = {
      branchIds: branchId ? [branchId] : undefined,
      dateFrom: parseDate(q.get("dateFrom")),
      dateTo: parseDate(q.get("dateTo")),
      status: validStatus,
      testFilter: (q.get("test") as SalesManagementFilters["testFilter"]) ?? "all",
      voidedFilter: (q.get("voided") as SalesManagementFilters["voidedFilter"]) ?? "all",
      search: q.get("search") ?? undefined,
    };

    const rows = await listSaleOrdersForManagement(filters);
    return ok(rows);
  } catch (error) {
    return toApiErrorResponse(error);
  }
}
