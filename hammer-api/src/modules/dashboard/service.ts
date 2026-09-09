import { ApprovalStatus, PaymentStatus, SaleOrderStatus, TransportServiceStatus } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { getBranchSalesRealtimeSummary, getOperationalWindowForManaguaDate } from "@/modules/sales/realtime-sales-summary";
import { excludeDerivedStockGroupMembers } from "@/modules/catalog/service";

function dayBounds(date = new Date()) {
  const start = new Date(date);
  start.setHours(0, 0, 0, 0);
  const end = new Date(start);
  end.setDate(end.getDate() + 1);
  return { start, end };
}

function toNumber(value: { toNumber: () => number } | null | undefined): number {
  return value ? value.toNumber() : 0;
}

/**
 * prompt-inventario-critico-fusion.md — aislado en su propia función, con
 * un `db` inyectable (mismo patrón que findSafeAccountForBranch en
 * treasury/service.ts), para poder probar el filtro con un fake en
 * memoria sin tocar el resto de getBranchAdminDashboardSummary (KPIs de
 * ventas/cobros/despachos/aprobaciones/transportes, sin cambios).
 *
 * Sin este filtro, cada miembro DERIVADO (no canónico) de una fusión
 * activa cuenta como "crítico" porque su balance propio vive en 0 por
 * diseño (el stock real está en el canónico) — doble conteo + ruido
 * falso. excludeDerivedStockGroupMembers() (catalog/service.ts) es el
 * filtro ÚNICO ya establecido para esto ("alertas de reposición", su
 * propio doc comment) — reusado, no reinventado a mano acá (ver
 * diagnóstico: un filtro literal a mano que solo mire isCanonical, sin
 * isActive de la membresía/grupo, esconde productos hoy canónicos con
 * basura de fusiones viejas ya disueltas).
 */
export async function countCriticalInventory(branchIds: string[], db: typeof prisma = prisma): Promise<number> {
  return db.inventoryBalance.count({
    where: {
      branchId: { in: branchIds },
      quantityOnHand: { lte: 5 },
      product: { isActive: true, ...excludeDerivedStockGroupMembers() },
    },
  });
}

export async function getBranchAdminDashboardSummary(branchIds: string[]) {
  const [salesSummaries, pendingPayments, pendingDispatches, pendingApprovals, criticalInventory, pendingTransports] = await Promise.all([
    Promise.all(branchIds.map((branchId) => getBranchSalesRealtimeSummary(branchId))),
    prisma.saleOrder.count({
      where: { branchId: { in: branchIds }, status: SaleOrderStatus.PENDING_PAYMENT },
    }),
    prisma.saleOrder.count({
      where: { branchId: { in: branchIds }, status: SaleOrderStatus.DISPATCH_PENDING },
    }),
    prisma.approvalRequest.count({
      where: { branchId: { in: branchIds }, status: { in: [ApprovalStatus.REQUESTED, ApprovalStatus.UNDER_REVIEW] } },
    }),
    countCriticalInventory(branchIds),
    prisma.transportService.count({
      where: {
        branchId: { in: branchIds },
        status: { in: [TransportServiceStatus.PENDING, TransportServiceStatus.IN_TRANSIT] },
      },
    }),
  ]);

  const alerts: string[] = [];
  if (pendingApprovals > 0) alerts.push(`Tienes ${pendingApprovals} aprobaciones pendientes en tus sucursales.`);
  if (pendingPayments > 0) alerts.push(`Hay ${pendingPayments} órdenes pendientes de cobro.`);
  if (pendingDispatches > 0) alerts.push(`Hay ${pendingDispatches} órdenes pendientes de despacho.`);
  if (pendingTransports > 0) alerts.push(`Hay ${pendingTransports} servicios de transporte pendientes de entrega.`);
  if (criticalInventory > 0) alerts.push(`Hay ${criticalInventory} balances con inventario crítico (≤ 5).`);

  return {
    salesToday: salesSummaries.reduce((acc, summary) => acc + summary.paidSalesTotal, 0),
    pendingPaymentTotal: salesSummaries.reduce((acc, summary) => acc + summary.pendingPaymentTotal, 0),
    paidSalesCount: salesSummaries.reduce((acc, summary) => acc + summary.paidSalesCount, 0),
    pendingPayments,
    pendingDispatches,
    pendingApprovals,
    criticalInventory,
    pendingTransports,
    alerts,
  };
}

export async function getSalesDashboardSummary(branchId: string, userId: string) {
  const { start, end } = getOperationalWindowForManaguaDate();

  const [draftsOpen, sentToPayment, salesToday] = await Promise.all([
    prisma.saleOrder.count({ where: { branchId, createdByUserId: userId, status: SaleOrderStatus.DRAFT } }),
    prisma.saleOrder.count({ where: { branchId, createdByUserId: userId, status: SaleOrderStatus.PENDING_PAYMENT } }),
    prisma.payment.aggregate({
      where: {
        status: PaymentStatus.POSTED,
        paidAt: { gte: start, lt: end },
        saleOrder: { branchId, createdByUserId: userId, status: { not: SaleOrderStatus.CANCELLED } },
      },
      _sum: { amount: true },
      _count: { _all: true },
    }),
  ]);

  return {
    draftsOpen,
    sentToPayment,
    salesToday: toNumber(salesToday._sum.amount),
    paidSalesCount: salesToday._count._all,
  };
}

export async function getCashierDashboardSummary(branchId: string) {
  const [activeSessionCount, pendingPayments, lastPayment] = await Promise.all([
    prisma.cashSession.count({
      where: {
        physicalCashBox: { branchId },
        status: { in: ["OPEN", "RECONCILING"] },
      },
    }),
    prisma.saleOrder.count({ where: { branchId, status: SaleOrderStatus.PENDING_PAYMENT } }),
    prisma.payment.findFirst({
      where: { status: PaymentStatus.POSTED, saleOrder: { branchId, status: { not: SaleOrderStatus.CANCELLED } } },
      orderBy: { paidAt: "desc" },
      include: { saleOrder: { select: { orderNumber: true } } },
    }),
  ]);

  return {
    activeSessionCount,
    pendingPayments,
    lastPayment: lastPayment
      ? {
          amount: toNumber(lastPayment.amount),
          paidAt: lastPayment.paidAt,
          orderNumber: lastPayment.saleOrder.orderNumber,
        }
      : null,
  };
}

export async function getWarehouseDashboardSummary(branchId: string) {
  const { start } = dayBounds();

  const [pendingDispatches, recentDispatches, overrideRequests] = await Promise.all([
    prisma.saleOrder.count({ where: { branchId, status: SaleOrderStatus.DISPATCH_PENDING } }),
    prisma.dispatchTicket.count({ where: { branchId, dispatchedAt: { gte: start } } }),
    prisma.approvalRequest.count({
      where: {
        branchId,
        type: "OPERATION_OVERRIDE",
        status: { in: [ApprovalStatus.REQUESTED, ApprovalStatus.UNDER_REVIEW] },
      },
    }),
  ]);

  return {
    pendingDispatches,
    recentDispatches,
    overrideRequests,
  };
}
