import { ApprovalStatus, PaymentStatus, Prisma, SaleOrderStatus, TransportServiceStatus } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { getBranchSalesRealtimeSummary, getOperationalWindowForManaguaDate } from "@/modules/sales/realtime-sales-summary";
import { excludeDerivedStockGroupMembers } from "@/modules/catalog/service";
import { calculateExpectedCashForSessionTx } from "@/modules/cash-session/service";
import { buildPendingList, lowStockThreshold, pickLowStock, type PendingKey } from "@/modules/dashboard/my-day";

const ACTIVE_CASH_STATUSES = ["OPEN", "RECONCILING", "AUTO_CLOSED_PENDING_REVIEW"] as const;

/** Qué secciones de "Mi día" puede ver el usuario en esta sucursal (lo decide la ruta con canInBranch). */
export type DayViewAccess = Record<PendingKey, boolean> & { cash: boolean };

/**
 * "Mi día" de la caja: estado de caja, lo que falta, ventas de hoy y lo que
 * se está agotando de lo vendido hoy. Reemplaza los 4 resúmenes por rol que
 * repetían la barra de arriba. El día es el día operativo de Managua, el
 * mismo que usa la barra (getBranchSalesRealtimeSummary).
 */
export async function getBranchDayView(branchId: string, userId: string, access: DayViewAccess) {
  const window = getOperationalWindowForManaguaDate();
  const todayOrders = { branchId, status: { not: SaleOrderStatus.CANCELLED }, createdAt: { gte: window.start, lt: window.end } };

  const [sales, cashSessions, payments, myDrafts, dispatches, transports, approvals, recentPayments, soldToday] = await Promise.all([
    getBranchSalesRealtimeSummary(branchId),
    access.cash
      ? prisma.cashSession.findMany({
          where: { physicalCashBox: { branchId }, status: { in: [...ACTIVE_CASH_STATUSES] } },
          select: {
            id: true,
            status: true,
            openedAt: true,
            openingAmount: true,
            physicalCashBox: { select: { code: true, description: true } },
            openedBy: { select: { fullName: true, username: true } },
          },
          orderBy: { openedAt: "asc" },
        })
      : Promise.resolve([]),
    access.payments ? prisma.saleOrder.count({ where: { branchId, status: SaleOrderStatus.PENDING_PAYMENT } }) : 0,
    // Con líneas: un borrador vacío no es una venta sin terminar.
    access.myDrafts
      ? prisma.saleOrder.count({ where: { branchId, createdByUserId: userId, status: SaleOrderStatus.DRAFT, lines: { some: {} } } })
      : 0,
    access.dispatches ? prisma.saleOrder.count({ where: { branchId, status: SaleOrderStatus.DISPATCH_PENDING } }) : 0,
    access.transports
      ? prisma.transportService.count({
          where: { branchId, status: { in: [TransportServiceStatus.PENDING, TransportServiceStatus.IN_TRANSIT] } },
        })
      : 0,
    access.approvals
      ? prisma.approvalRequest.count({
          where: { branchId, status: { in: [ApprovalStatus.REQUESTED, ApprovalStatus.UNDER_REVIEW] } },
        })
      : 0,
    prisma.payment.findMany({
      where: {
        status: PaymentStatus.POSTED,
        paidAt: { gte: window.start, lt: window.end },
        saleOrder: { branchId, status: { not: SaleOrderStatus.CANCELLED } },
      },
      select: { id: true, amount: true, method: true, paidAt: true, saleOrder: { select: { id: true, orderNumber: true } } },
      orderBy: { paidAt: "desc" },
      take: 8,
    }),
    prisma.saleOrderLine.groupBy({
      by: ["productId"],
      where: { saleOrder: todayOrders },
      _sum: { quantity: true },
    }),
  ]);

  return {
    branchId,
    branchName: sales.branchName,
    businessDate: sales.businessDate,
    // null = sin permiso de caja (no se muestra la sección); [] = caja cerrada.
    cashSessions: !access.cash ? null : await Promise.all(
      cashSessions.map(async (s) => ({
        id: s.id,
        status: s.status,
        openedAt: s.openedAt,
        boxCode: s.physicalCashBox.code,
        boxName: s.physicalCashBox.description,
        openedByName: s.openedBy.fullName || s.openedBy.username,
        // Solo con la caja abierta: en conciliación o auto-cerrada el conteo manda.
        expectedCash:
          s.status === "OPEN"
            ? (await calculateExpectedCashForSessionTx(prisma as unknown as Prisma.TransactionClient, s.id, s.openingAmount)).expectedCash
            : null,
      })),
    ),
    sales: {
      paidTotal: sales.paidSalesTotal,
      paidCount: sales.paidSalesCount,
      averageTicket: sales.paidSalesCount > 0 ? sales.paidSalesTotal / sales.paidSalesCount : 0,
      byMethod: sales.paymentsByMethod,
      cancelledCount: sales.cancelledSalesCount,
      cancelledTotal: sales.cancelledSalesTotal,
      pendingPaymentTotal: sales.pendingPaymentTotal,
    },
    pending: buildPendingList({ payments, myDrafts, dispatches, transports, approvals }, access),
    recentSales: recentPayments.map((p) => ({
      paymentId: p.id,
      orderId: p.saleOrder.id,
      orderNumber: p.saleOrder.orderNumber,
      amount: Number(p.amount),
      method: p.method,
      paidAt: p.paidAt,
    })),
    lowStock: await listLowStockSoldToday(branchId, soldToday),
  };
}

/**
 * Lo vendido hoy que quedó en su punto de reorden (o mínimo, o 5) o debajo.
 * Antes "Inventario crítico" contaba todo lo que tuviera ≤ 5 en la sucursal
 * (212 en Managua), incluido lo que nunca se volvió a pedir, y no decía cuál.
 */
async function listLowStockSoldToday(
  branchId: string,
  soldToday: Array<{ productId: string; _sum: { quantity: Prisma.Decimal | null } }>,
) {
  if (soldToday.length === 0) return [];
  const soldById = new Map(soldToday.map((s) => [s.productId, Number(s._sum.quantity ?? 0)]));
  const productIds = [...soldById.keys()];

  // shortcut: un derivado de fusión no aparece (su stock vive en el canónico, que no tiene ventas propias); si hace falta, mapear derivado → canónico.
  const [balances, settings] = await Promise.all([
    prisma.inventoryBalance.findMany({
      where: { branchId, productId: { in: productIds }, product: { isActive: true, ...excludeDerivedStockGroupMembers() } },
      select: { productId: true, quantityOnHand: true, product: { select: { name: true, unit: true } } },
    }),
    prisma.branchProductSetting.findMany({
      where: { branchId, productId: { in: productIds } },
      select: { productId: true, reorderPoint: true, minStock: true },
    }),
  ]);
  const settingById = new Map(
    settings.map((s) => [
      s.productId,
      { reorderPoint: s.reorderPoint === null ? null : Number(s.reorderPoint), minStock: s.minStock === null ? null : Number(s.minStock) },
    ]),
  );

  return pickLowStock(
    balances.map((b) => ({
      productId: b.productId,
      name: b.product.name,
      unit: b.product.unit,
      onHand: Number(b.quantityOnHand),
      threshold: lowStockThreshold(settingById.get(b.productId) ?? null),
      soldToday: soldById.get(b.productId) ?? 0,
    })),
  );
}
