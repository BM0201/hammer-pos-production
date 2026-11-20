import { ApprovalStatus, PaymentStatus, Prisma, SaleOrderStatus, TransportServiceStatus } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { getBranchSalesRealtimeSummary, getOperationalWindowForManaguaDate } from "@/modules/sales/realtime-sales-summary";
import { excludeDerivedStockGroupMembers } from "@/modules/catalog/service";
import { calculateExpectedCashForSessionTx } from "@/modules/cash-session/service";
import { getCashAutoCloseConfig } from "@/modules/cash-session/auto-close-config";
import { isBlindCountTime } from "@/modules/cash-session/auto-close-service";
import { buildPendingList, PACE_WINDOW_DAYS, rankSoldStock, type PendingKey } from "@/modules/dashboard/my-day";

const ACTIVE_CASH_STATUSES = ["OPEN", "RECONCILING", "AUTO_CLOSED_PENDING_REVIEW"] as const;

/** Qué secciones de "Mi día" puede ver el usuario en esta sucursal (lo decide la ruta con canInBranch). */
type DayViewAccess = Record<PendingKey, boolean> & { cash: boolean };

/**
 * "Mi día" de la caja: estado de caja, lo que falta, ventas de hoy y lo que
 * cuánto alcanza lo vendido hoy. Reemplaza los 4 resúmenes por rol que
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

  // Conteo a ciegas desde 20 min antes del cierre: no se muestra cuánto debe haber.
  const blindCount = access.cash && isBlindCountTime(new Date(), await getCashAutoCloseConfig());

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
        // Solo con la caja abierta y antes del conteo a ciegas; contando o auto-cerrada, el conteo manda.
        expectedCash:
          s.status === "OPEN" && !blindCount
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
    lowStock: await listSoldTodayStock(branchId, soldToday, window.end),
  };
}

type SoldRow = { productId: string; _sum: { quantity: Prisma.Decimal | null } };

/**
 * Lo vendido hoy con lo que queda y cuántos días alcanza al ritmo de las
 * últimas 2 semanas. Un derivado de fusión (bolsa, lata) se cuenta en su
 * canónico, que es donde vive el stock, convertido con conversionFactor.
 */
async function listSoldTodayStock(branchId: string, soldToday: SoldRow[], dayEnd: Date) {
  if (soldToday.length === 0) return [];
  const soldIds = soldToday.map((s) => s.productId);

  const memberships = await prisma.productStockGroupMember.findMany({
    where: { productId: { in: soldIds }, isActive: true, stockGroup: { isActive: true } },
    select: {
      stockGroup: { select: { products: { where: { isActive: true }, select: { productId: true, conversionFactor: true, isCanonical: true } } } },
    },
  });
  // productId → producto que guarda el stock y factor a su unidad.
  const toStock = new Map<string, { stockId: string; factor: number }>();
  for (const { stockGroup } of memberships) {
    const canonical = stockGroup.products.find((p) => p.isCanonical);
    if (!canonical) continue;
    const canonicalFactor = Number(canonical.conversionFactor) || 1;
    for (const p of stockGroup.products) {
      if (!toStock.has(p.productId)) toStock.set(p.productId, { stockId: canonical.productId, factor: Number(p.conversionFactor) / canonicalFactor });
    }
  }
  const byStock = (rows: SoldRow[]) => {
    const totals = new Map<string, number>();
    for (const r of rows) {
      const { stockId, factor } = toStock.get(r.productId) ?? { stockId: r.productId, factor: 1 };
      totals.set(stockId, (totals.get(stockId) ?? 0) + Number(r._sum.quantity ?? 0) * factor);
    }
    return totals;
  };
  const todayByStock = byStock(soldToday);
  const stockIds = [...todayByStock.keys()];

  const [recent, balances, settings] = await Promise.all([
    prisma.saleOrderLine.groupBy({
      by: ["productId"],
      where: {
        productId: { in: [...new Set([...soldIds, ...toStock.keys()])] },
        saleOrder: {
          branchId,
          status: { not: SaleOrderStatus.CANCELLED },
          createdAt: { gte: new Date(dayEnd.getTime() - PACE_WINDOW_DAYS * 86_400_000), lt: dayEnd },
        },
      },
      _sum: { quantity: true },
    }),
    // Sin derivados: uno cuyo grupo no tiene canónico activo quedaría siempre en 0.
    prisma.inventoryBalance.findMany({
      where: { branchId, productId: { in: stockIds }, product: { isActive: true, ...excludeDerivedStockGroupMembers() } },
      select: { productId: true, quantityOnHand: true, product: { select: { name: true, unit: true } } },
    }),
    prisma.branchProductSetting.findMany({
      where: { branchId, productId: { in: stockIds } },
      select: { productId: true, reorderPoint: true, minStock: true },
    }),
  ]);
  const recentByStock = byStock(recent);
  const reorderById = new Map(settings.map((s) => [s.productId, s.reorderPoint ?? s.minStock]));

  return rankSoldStock(
    balances.map((b) => {
      const reorder = reorderById.get(b.productId);
      return {
        productId: b.productId,
        name: b.product.name,
        unit: b.product.unit,
        onHand: Number(b.quantityOnHand),
        soldToday: todayByStock.get(b.productId) ?? 0,
        soldInWindow: recentByStock.get(b.productId) ?? 0,
        reorderPoint: reorder == null ? null : Number(reorder),
      };
    }),
  );
}
