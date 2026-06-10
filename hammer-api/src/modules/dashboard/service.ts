import { ApprovalStatus, PaymentStatus, SaleOrderStatus, TransportServiceStatus } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { getBranchSalesRealtimeSummary, getOperationalWindowForManaguaDate } from "@/modules/sales/realtime-sales-summary";

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

export async function getMasterDashboardSummary() {
  const [branches, pendingOrders, pendingApprovals, pendingDispatch] = await Promise.all([
    prisma.branch.findMany({ where: { isActive: true }, select: { id: true, code: true, name: true }, orderBy: { code: "asc" } }),
    prisma.saleOrder.groupBy({
      by: ["branchId"],
      where: { status: SaleOrderStatus.PENDING_PAYMENT },
      _count: { _all: true },
    }),
    prisma.approvalRequest.groupBy({
      by: ["branchId"],
      where: { status: { in: [ApprovalStatus.REQUESTED, ApprovalStatus.UNDER_REVIEW] } },
      _count: { _all: true },
    }),
    prisma.saleOrder.groupBy({
      by: ["branchId"],
      where: { status: SaleOrderStatus.DISPATCH_PENDING },
      _count: { _all: true },
    }),
  ]);
  const salesSummaries = await Promise.all(branches.map((branch) => getBranchSalesRealtimeSummary(branch.id)));

  const byBranch = branches.map((branch) => {
    const today = salesSummaries.find((item) => item.branchId === branch.id);
    const pending = pendingOrders.find((item) => item.branchId === branch.id);
    const approvals = pendingApprovals.find((item) => item.branchId === branch.id);
    const dispatch = pendingDispatch.find((item) => item.branchId === branch.id);
    return {
      branchId: branch.id,
      branchCode: branch.code,
      branchName: branch.name,
      salesToday: today?.paidSalesTotal ?? 0,
      pendingOrders: pending?._count._all ?? 0,
      pendingApprovals: approvals?._count._all ?? 0,
      pendingDispatch: dispatch?._count._all ?? 0,
    };
  });

  const totalPendingApprovals = byBranch.reduce((acc, item) => acc + item.pendingApprovals, 0);
  const totalPendingDispatch = byBranch.reduce((acc, item) => acc + item.pendingDispatch, 0);
  const totalPendingOrders = byBranch.reduce((acc, item) => acc + item.pendingOrders, 0);

  const alerts: string[] = [];
  if (totalPendingApprovals > 0) alerts.push(`Hay ${totalPendingApprovals} solicitudes de aprobación pendientes.`);
  if (totalPendingDispatch > 0) alerts.push(`Hay ${totalPendingDispatch} órdenes pendientes de despacho.`);
  if (totalPendingOrders > 0) alerts.push(`Hay ${totalPendingOrders} órdenes pendientes de cobro o despacho.`);

  return { byBranch, alerts };
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
    prisma.inventoryBalance.count({
      where: { branchId: { in: branchIds }, quantityOnHand: { lte: 5 } },
    }),
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
  const [activeSessionCount, pendingPayments, lastPayment, discrepancyApprovals] = await Promise.all([
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
    prisma.approvalRequest.count({
      where: {
        branchId,
        type: "CASH_SESSION_DISCREPANCY",
        status: { in: [ApprovalStatus.REQUESTED, ApprovalStatus.UNDER_REVIEW] },
      },
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
    discrepancyApprovals,
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
