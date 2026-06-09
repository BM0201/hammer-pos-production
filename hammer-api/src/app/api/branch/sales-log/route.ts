import { SaleOrderStatus } from "@prisma/client";
import { getCurrentSession } from "@/modules/auth/service";
import { assertAuthenticated } from "@/modules/auth/access";
import { listBranchSalesLog, type BranchSalesLogFilters } from "@/modules/sales/management-service";
import { resolveBranchSalesLogAccess } from "@/modules/sales/sales-log-access";
import { toApiErrorResponse } from "@/lib/api/errors";
import { ok } from "@/lib/api/response";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function parseDate(value: string | null): Date | undefined {
  if (!value) return undefined;
  const d = new Date(value);
  return Number.isNaN(d.getTime()) ? undefined : d;
}

function parseInteger(value: string | null): number | undefined {
  if (!value) return undefined;
  const n = Number.parseInt(value, 10);
  return Number.isNaN(n) ? undefined : n;
}

/**
 * GET /api/branch/sales-log[?branchId=&dateFrom=&dateTo=&status=&sellerId=&search=&page=&pageSize=]
 *
 * Bitácora de ventas de la sucursal del usuario autenticado. Devuelve SOLO
 * ventas válidas (no anuladas, no de prueba, no canceladas), paginadas, con
 * filtros por fecha, estado y vendedor.
 *
 * Seguridad: el `branchId` es solo un selector; se valida contra la membresía
 * y capacidades de la sesión (ver `resolveBranchSalesLogAccess`). El usuario
 * NUNCA puede consultar ventas de una sucursal a la que no pertenece.
 */
export async function GET(request: Request) {
  try {
    const session = await getCurrentSession();
    assertAuthenticated(session);

    const url = new URL(request.url);
    const q = url.searchParams;

    const requestedBranchId = q.get("branchId") ?? undefined;
    const { branchId } = resolveBranchSalesLogAccess({ session: session!, requestedBranchId });

    const statusParam = q.get("status");
    const validStatus =
      statusParam && (Object.values(SaleOrderStatus) as string[]).includes(statusParam)
        ? (statusParam as SaleOrderStatus)
        : undefined;

    const filters: BranchSalesLogFilters = {
      branchId,
      dateFrom: parseDate(q.get("dateFrom")),
      dateTo: parseDate(q.get("dateTo")),
      status: validStatus,
      sellerId: q.get("sellerId") ?? undefined,
      search: q.get("search") ?? undefined,
      page: parseInteger(q.get("page")),
      pageSize: parseInteger(q.get("pageSize")),
    };

    const result = await listBranchSalesLog(filters);
    return ok({ branchId, ...result });
  } catch (error) {
    return toApiErrorResponse(error);
  }
}
