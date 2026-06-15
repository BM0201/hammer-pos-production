import { NextResponse } from "next/server";
import { getCurrentSession } from "@/modules/auth/service";
import { assertAuthenticated } from "@/modules/auth/access";
import { canExportReports, resolveReportBranchScope } from "@/modules/reports/access";
import { prisma } from "@/lib/prisma";
import { PaymentStatus, SaleOrderStatus } from "@prisma/client";
import { toHttpErrorResponse } from "@/lib/http";

export async function GET(request: Request) {
  try {
    const session = await getCurrentSession();
    assertAuthenticated(session);
    if (!canExportReports(session)) {
      return NextResponse.json({ error: { code: "FORBIDDEN_REPORTS" } }, { status: 403 });
    }

    const { searchParams } = new URL(request.url);
    const branchIdParam = searchParams.get("branchId") ?? undefined;
    const branchIds = resolveReportBranchScope(session, branchIdParam);

    const now = new Date();
    const todayStart = new Date(now);
    todayStart.setUTCHours(0, 0, 0, 0);
    const thirtyDaysAgo = new Date(now);
    thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);

    // Branch scope helpers
    const directBranch = branchIds?.length ? { branchId: { in: branchIds } } : {};
    const nestedBranch = branchIds?.length ? { saleOrder: { branchId: { in: branchIds } } } : {};

    const [
      ventas30dias,
      pagosHoy,
      pendientePago,
      descuentos30dias,
      inventarioCritico,
      prestamosActivos,
    ] = await Promise.all([
      // Total cobrado (POSTED) en últimos 30 días
      prisma.payment.aggregate({
        where: { status: PaymentStatus.POSTED, paidAt: { gte: thirtyDaysAgo }, ...nestedBranch },
        _sum: { amount: true },
        _count: { _all: true },
      }),
      // Cobrado hoy (UTC)
      prisma.payment.aggregate({
        where: { status: PaymentStatus.POSTED, paidAt: { gte: todayStart }, ...nestedBranch },
        _sum: { amount: true },
        _count: { _all: true },
      }),
      // Órdenes pendientes de pago
      prisma.saleOrder.aggregate({
        where: { status: SaleOrderStatus.PENDING_PAYMENT, ...directBranch },
        _sum: { grandTotal: true },
        _count: { _all: true },
      }),
      // Descuentos aplicados en últimos 30 días
      prisma.saleOrderLine.aggregate({
        where: { discountAmount: { gt: 0 }, createdAt: { gte: thirtyDaysAgo }, ...nestedBranch },
        _sum: { discountAmount: true },
        _count: { _all: true },
      }),
      // Productos con existencia crítica (<=5 unidades, >0 para excluir agotado)
      prisma.inventoryBalance.count({
        where: { quantityOnHand: { gt: 0, lte: 5 }, ...directBranch },
      }),
      // Préstamos activos
      prisma.employeeLoan.count({
        where: { status: "ACTIVE", ...directBranch },
      }),
    ]);

    return NextResponse.json(
      {
        data: {
          ventas30dias:         Number(ventas30dias._sum.amount ?? 0),
          ventas30diasCount:    ventas30dias._count._all,
          pagosHoy:             Number(pagosHoy._sum.amount ?? 0),
          pagosHoyCount:        pagosHoy._count._all,
          pendientePago:        Number(pendientePago._sum.grandTotal ?? 0),
          pendientePagoCount:   pendientePago._count._all,
          descuentos30dias:     Number(descuentos30dias._sum.discountAmount ?? 0),
          descuentos30diasCount: descuentos30dias._count._all,
          inventarioCritico,
          prestamosActivos,
        },
      },
      { status: 200, headers: { "cache-control": "no-store" } },
    );
  } catch (error) {
    if (error instanceof Error && error.message === "FORBIDDEN_BRANCH") {
      return NextResponse.json({ error: { code: "FORBIDDEN_BRANCH" } }, { status: 403 });
    }
    return toHttpErrorResponse(error);
  }
}
