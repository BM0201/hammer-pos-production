import { InventoryMovementType } from "@prisma/client";
import { getCurrentSession } from "@/modules/auth/service";
import { assertAuthenticated } from "@/modules/auth/access";
import { exportInventoryMovementsToExcel } from "@/modules/inventory/service";
import { toHttpErrorResponse } from "@/lib/http";
import { fail } from "@/lib/api/response";
import { hasBranchAccess } from "@/modules/rbac/guards";
import { prisma } from "@/lib/prisma";
import { isValidYmd, managuaStartOfDayUtc, managuaEndOfDayUtc } from "@/lib/timezone";

/**
 * GET /api/inventory/movements/export
 *
 * Genera un archivo Excel (.xlsx) del Kardex respetando exactamente los mismos
 * filtros que la vista (branchId, productId, movementType, startDate, endDate).
 * El Excel incluye los filtros aplicados en el encabezado, todas las columnas
 * visibles y una fila de totales. Se descarga como adjunto.
 */
export async function GET(request: Request) {
  try {
    const session = await getCurrentSession();
    assertAuthenticated(session);

    const { searchParams } = new URL(request.url);
    const branchId = searchParams.get("branchId");
    const productId = searchParams.get("productId") ?? undefined;
    const movementTypeRaw = searchParams.get("movementType") ?? undefined;
    const startDateRaw = searchParams.get("startDate") ?? undefined;
    const endDateRaw = searchParams.get("endDate") ?? undefined;

    if (!branchId) {
      return fail("VALIDATION_ERROR", "branchId is required", 400);
    }
    if (!hasBranchAccess(session, branchId)) {
      return fail("FORBIDDEN", "Forbidden", 403);
    }

    const movementType =
      movementTypeRaw && movementTypeRaw in InventoryMovementType
        ? (movementTypeRaw as InventoryMovementType)
        : undefined;

    if (startDateRaw && !isValidYmd(startDateRaw)) {
      return fail("VALIDATION_ERROR", "startDate must be in YYYY-MM-DD format", 400);
    }
    if (endDateRaw && !isValidYmd(endDateRaw)) {
      return fail("VALIDATION_ERROR", "endDate must be in YYYY-MM-DD format", 400);
    }
    const startDate = startDateRaw ? managuaStartOfDayUtc(startDateRaw) : undefined;
    const endDate = endDateRaw ? managuaEndOfDayUtc(endDateRaw) : undefined;

    // Resolve human-readable labels for the header block.
    const [branch, product] = await Promise.all([
      prisma.branch.findUnique({ where: { id: branchId }, select: { code: true, name: true } }),
      productId
        ? prisma.product.findUnique({ where: { id: productId }, select: { sku: true, name: true } })
        : Promise.resolve(null),
    ]);

    const buffer = await exportInventoryMovementsToExcel({
      branchId,
      productId,
      movementType,
      startDate,
      endDate,
      filterLabels: {
        branch: branch ? `${branch.code} - ${branch.name}` : branchId,
        product: product ? `${product.sku} - ${product.name}` : "Todos",
        movementType: movementType ?? "Todos",
        startDate: startDateRaw ?? "—",
        endDate: endDateRaw ?? "—",
      },
    });

    const stamp = new Date().toISOString().slice(0, 10);
    const filename = `kardex_${branch?.code ?? branchId}_${stamp}.xlsx`;

    return new Response(new Uint8Array(buffer), {
      status: 200,
      headers: {
        "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        "Content-Disposition": `attachment; filename="${filename}"`,
        "Cache-Control": "no-store",
      },
    });
  } catch (error) {
    return toHttpErrorResponse(error);
  }
}
