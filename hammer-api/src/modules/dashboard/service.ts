import { ApprovalStatus, SaleOrderStatus, TransportServiceStatus } from "@prisma/client";
import { prisma } from "@/lib/prisma";

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
  const { start, end } = dayBounds();

  const [branches, salesToday, pendingOrders, pendingApprovals, pendingDispatch] = await Promise.all([
    prisma.branch.findMany({ where: { isActive: true }, select: { id: true, code: true, name: true }, orderBy: { code: "asc" } }),
    prisma.saleOrder.groupBy({
      by: ["branchId"],
      where: {
        createdAt: { gte: start, lt: end },
        // Excluir ventas de prueba y anuladas de las métricas.
        isTest: false,
        voidedAt: null,
        status: { in: [SaleOrderStatus.PAID, SaleOrderStatus.DISPATCH_PENDING, SaleOrderStatus.DISPATCHED, SaleOrderStatus.PENDING_PAYMENT] },
      },
      _sum: { grandTotal: true },
    }),
    prisma.saleOrder.groupBy({
      by: ["branchId"],
      where: { status: { in: [SaleOrderStatus.PENDING_PAYMENT, SaleOrderStatus.DISPATCH_PENDING] } },
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

  const byBranch = branches.map((branch) => {
    const today = salesToday.find((item) => item.branchId === branch.id);
    const pending = pendingOrders.find((item) => item.branchId === branch.id);
    const approvals = pendingApprovals.find((item) => item.branchId === branch.id);
    const dispatch = pendingDispatch.find((item) => item.branchId === branch.id);
    return {
      branchId: branch.id,
      branchCode: branch.code,
      branchName: branch.name,
      salesToday: toNumber(today?._sum.grandTotal),
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
  const { start, end } = dayBounds();

  const [salesToday, pendingPayments, pendingDispatches, pendingApprovals, criticalInventory, pendingTransports] = await Promise.all([
    prisma.saleOrder.aggregate({
      where: {
        branchId: { in: branchIds },
        createdAt: { gte: start, lt: end },
        // Excluir ventas de prueba y anuladas de las métricas.
        isTest: false,
        voidedAt: null,
        status: { in: [SaleOrderStatus.PAID, SaleOrderStatus.DISPATCH_PENDING, SaleOrderStatus.DISPATCHED, SaleOrderStatus.PENDING_PAYMENT] },
      },
      _sum: { grandTotal: true },
    }),
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
    salesToday: toNumber(salesToday._sum.grandTotal),
    pendingPayments,
    pendingDispatches,
    pendingApprovals,
    criticalInventory,
    pendingTransports,
    alerts,
  };
}

export async function getSalesDashboardSummary(branchId: string, userId: string) {
  const { start, end } = dayBounds();

  const [draftsOpen, sentToPayment, salesToday] = await Promise.all([
    prisma.saleOrder.count({ where: { branchId, createdByUserId: userId, status: SaleOrderStatus.DRAFT } }),
    prisma.saleOrder.count({ where: { branchId, createdByUserId: userId, status: SaleOrderStatus.PENDING_PAYMENT } }),
    prisma.saleOrder.aggregate({
      where: {
        branchId,
        createdByUserId: userId,
        createdAt: { gte: start, lt: end },
        // Excluir ventas de prueba y anuladas de las métricas.
        isTest: false,
        voidedAt: null,
        status: { in: [SaleOrderStatus.PENDING_PAYMENT, SaleOrderStatus.PAID, SaleOrderStatus.DISPATCH_PENDING, SaleOrderStatus.DISPATCHED] },
      },
      _sum: { grandTotal: true },
    }),
  ]);

  return {
    draftsOpen,
    sentToPayment,
    salesToday: toNumber(salesToday._sum.grandTotal),
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
      where: { saleOrder: { branchId } },
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
