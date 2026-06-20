import { PaymentMethod, PaymentStatus, Prisma, SaleOrderStatus } from "@prisma/client";
import { prisma } from "@/lib/prisma";

const TIMEZONE = "America/Managua";
const MANAGUA_UTC_OFFSET_HOURS = 6;

type Db = typeof prisma | Prisma.TransactionClient;

function n(value: Prisma.Decimal | number | string | null | undefined) {
  return Number(value ?? 0);
}

function fixedDateParts(date: Date) {
  const formatter = new Intl.DateTimeFormat("en-CA", {
    timeZone: TIMEZONE,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  });
  const [year, month, day] = formatter.format(date).split("-").map(Number);
  return { year, month, day };
}

function businessDateYmd(date: Date) {
  const { year, month, day } = fixedDateParts(date);
  return `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
}

export function getOperationalWindowForManaguaDate(date?: Date | string | null) {
  let year: number;
  let month: number;
  let day: number;
  if (typeof date === "string" && date.trim()) {
    [year, month, day] = date.split("-").map(Number);
  } else {
    const parts = fixedDateParts(date instanceof Date ? date : new Date());
    year = parts.year;
    month = parts.month;
    day = parts.day;
  }

  const start = new Date(Date.UTC(year, month - 1, day, MANAGUA_UTC_OFFSET_HOURS, 0, 0, 0));
  const end = new Date(Date.UTC(year, month - 1, day + 1, MANAGUA_UTC_OFFSET_HOURS, 0, 0, 0));
  const businessDate = `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
  return { start, end, timezone: TIMEZONE, businessDate };
}

export type RealtimeSalesSummary = {
  branchId: string;
  branchCode: string;
  branchName: string;
  businessDate: string;
  window: { start: Date; end: Date; timezone: "America/Managua" };
  paidSalesTotal: number;
  paidSalesCount: number;
  pendingPaymentTotal: number;
  pendingPaymentCount: number;
  cancelledSalesTotal: number;
  cancelledSalesCount: number;
  postedPaymentsCount: number;
  voidedPaymentsCount: number;
  invoicesCount: number;
  manualInvoicesRegistered: number;
  manualInvoicesPending: number;
  deliveryOrdersIssued: number;
  lastSale: {
    orderId: string;
    orderNumber: string;
    amount: number;
    paidAt: string;
    method: PaymentMethod;
    cashierName: string | null;
    sellerName: string | null;
  } | null;
  paymentsByMethod: Array<{ method: PaymentMethod; amount: number; count: number }>;
};

export async function buildBranchRealtimeSalesSummary(
  db: Db,
  branch: { id: string; code: string; name: string },
  date?: Date | string | null,
): Promise<RealtimeSalesSummary> {
  const window = getOperationalWindowForManaguaDate(date);
  const paymentWhere: Prisma.PaymentWhereInput = {
    status: PaymentStatus.POSTED,
    paidAt: { gte: window.start, lt: window.end },
    saleOrder: { branchId: branch.id, status: { not: SaleOrderStatus.CANCELLED } },
  };
  const voidedWhere: Prisma.PaymentWhereInput = {
    status: PaymentStatus.VOIDED,
    paidAt: { gte: window.start, lt: window.end },
    saleOrder: { branchId: branch.id },
  };

  const [
    paidPayments,
    voidedPaymentsCount,
    pending,
    cancelled,
    invoiceCount,
    manualInvoicesRegistered,
    manualInvoicesPending,
    deliveryOrdersIssued,
    paymentsByMethod,
    lastSale,
  ] = await Promise.all([
    db.payment.aggregate({ where: paymentWhere, _sum: { amount: true }, _count: { _all: true } }),
    db.payment.count({ where: voidedWhere }),
    db.saleOrder.aggregate({
      // Scope pending-payment orders to the operational window (consistent with
      // paid/cancelled above and with the Master approval flow). Without this,
      // stale unpaid orders from previous days inflate pendingPaymentTotal and,
      // because pending_payments is a HARD close blocker, the operational day
      // could never be closed.
      where: {
        branchId: branch.id,
        status: SaleOrderStatus.PENDING_PAYMENT,
        createdAt: { gte: window.start, lt: window.end },
      },
      _sum: { grandTotal: true },
      _count: { _all: true },
    }),
    db.saleOrder.aggregate({
      where: { branchId: branch.id, status: SaleOrderStatus.CANCELLED, updatedAt: { gte: window.start, lt: window.end } },
      _sum: { grandTotal: true },
      _count: { _all: true },
    }),
    db.payment.count({ where: paymentWhere }),
    db.saleOrder.count({
      where: {
        branchId: branch.id,
        manualInvoiceRegisteredAt: { gte: window.start, lt: window.end },
      },
    }),
    db.saleOrder.count({
      where: {
        branchId: branch.id,
        status: { not: SaleOrderStatus.CANCELLED },
        requiresManualInvoice: true,
        manualInvoiceRegisteredAt: null,
      },
    }),
    db.saleOrder.count({
      where: {
        branchId: branch.id,
        deliveryOrderIssuedAt: { gte: window.start, lt: window.end },
      },
    }),
    db.paymentTender.groupBy({
      by: ["method"],
      where: { payment: paymentWhere },
      _sum: { amount: true },
      _count: { _all: true },
    }),
    db.payment.findFirst({
      where: paymentWhere,
      orderBy: { paidAt: "desc" },
      select: {
        amount: true,
        paidAt: true,
        method: true,
        receivedBy: { select: { username: true, fullName: true } },
        saleOrder: {
          select: {
            id: true,
            orderNumber: true,
            createdBy: { select: { username: true, fullName: true } },
          },
        },
      },
    }),
  ]);

  return {
    branchId: branch.id,
    branchCode: branch.code,
    branchName: branch.name,
    businessDate: window.businessDate,
    window: { start: window.start, end: window.end, timezone: TIMEZONE },
    paidSalesTotal: n(paidPayments._sum.amount),
    paidSalesCount: paidPayments._count._all,
    pendingPaymentTotal: n(pending._sum.grandTotal),
    pendingPaymentCount: pending._count._all,
    cancelledSalesTotal: n(cancelled._sum.grandTotal),
    cancelledSalesCount: cancelled._count._all,
    postedPaymentsCount: paidPayments._count._all,
    voidedPaymentsCount,
    invoicesCount: invoiceCount,
    manualInvoicesRegistered,
    manualInvoicesPending,
    deliveryOrdersIssued,
    lastSale: lastSale
      ? {
          orderId: lastSale.saleOrder.id,
          orderNumber: lastSale.saleOrder.orderNumber,
          amount: n(lastSale.amount),
          paidAt: lastSale.paidAt.toISOString(),
          method: lastSale.method,
          cashierName: lastSale.receivedBy?.fullName ?? lastSale.receivedBy?.username ?? null,
          sellerName: lastSale.saleOrder.createdBy?.fullName ?? lastSale.saleOrder.createdBy?.username ?? null,
        }
      : null,
    paymentsByMethod: paymentsByMethod.map((row) => ({
      method: row.method,
      amount: n(row._sum.amount),
      count: row._count._all,
    })),
  };
}

export async function getBranchSalesRealtimeSummary(branchId: string, date?: Date | string | null) {
  const branch = await prisma.branch.findUniqueOrThrow({
    where: { id: branchId },
    select: { id: true, code: true, name: true },
  });
  return buildBranchRealtimeSalesSummary(prisma, branch, date);
}

export async function getAllBranchesSalesRealtimeSummary(date?: Date | string | null) {
  const branches = await prisma.branch.findMany({
    where: { isActive: true },
    select: { id: true, code: true, name: true },
    orderBy: { code: "asc" },
  });
  return getAllBranchesSalesRealtimeSummaryBatch(branches, date);
}

/**
 * Batch multi-branch sales summary using groupBy/aggregate.
 *
 * Replaces N×10 per-branch queries with ~6 queries total across all branches.
 * Accepts pre-fetched branches to avoid an extra branch.findMany when the caller
 * (e.g. Command Center) already has them.
 *
 * TTL: data reflects the current operational window; no caching applied here.
 */
export async function getAllBranchesSalesRealtimeSummaryBatch(
  branches: Array<{ id: string; code: string; name: string }>,
  date?: Date | string | null,
): Promise<RealtimeSalesSummary[]> {
  if (branches.length === 0) return [];

  const window = getOperationalWindowForManaguaDate(date);
  const branchIds = branches.map((b) => b.id);

  const paymentWhere: Prisma.PaymentWhereInput = {
    status: PaymentStatus.POSTED,
    paidAt: { gte: window.start, lt: window.end },
    saleOrder: { branchId: { in: branchIds }, status: { not: SaleOrderStatus.CANCELLED } },
  };

  const [
    paidByBranch,
    voidedByBranch,
    pendingByBranch,
    cancelledByBranch,
    manualRegByBranch,
    manualPendingByBranch,
    deliveryByBranch,
    tendersByBranch,
    lastSalesByBranch,
  ] = await Promise.all([
    // 1. Paid payment totals grouped by branch
    prisma.payment.groupBy({
      by: ["saleOrderId"],
      where: paymentWhere,
      _sum: { amount: true },
      _count: { _all: true },
    }).then(async (rows) => {
      // groupBy saleOrderId then join to branchId
      const orderIds = rows.map((r) => r.saleOrderId);
      if (orderIds.length === 0) return new Map<string, { total: number; count: number }>();
      const orders = await prisma.saleOrder.findMany({
        where: { id: { in: orderIds } },
        select: { id: true, branchId: true },
      });
      const orderBranch = new Map(orders.map((o) => [o.id, o.branchId]));
      const result = new Map<string, { total: number; count: number }>();
      for (const row of rows) {
        const bid = orderBranch.get(row.saleOrderId);
        if (!bid) continue;
        const entry = result.get(bid) ?? { total: 0, count: 0 };
        entry.total += n(row._sum.amount);
        entry.count += row._count._all;
        result.set(bid, entry);
      }
      return result;
    }),

    // 2. Voided payments grouped by branch
    (async () => {
      const rows = await prisma.payment.findMany({
        where: {
          status: PaymentStatus.VOIDED,
          paidAt: { gte: window.start, lt: window.end },
          saleOrder: { branchId: { in: branchIds } },
        },
        select: { saleOrder: { select: { branchId: true } } },
      });
      const result = new Map<string, number>();
      for (const row of rows) {
        const bid = row.saleOrder.branchId;
        result.set(bid, (result.get(bid) ?? 0) + 1);
      }
      return result;
    })(),

    // 3. Pending payment orders grouped by branch
    prisma.saleOrder.groupBy({
      by: ["branchId"],
      where: {
        branchId: { in: branchIds },
        status: SaleOrderStatus.PENDING_PAYMENT,
        createdAt: { gte: window.start, lt: window.end },
      },
      _sum: { grandTotal: true },
      _count: { _all: true },
    }),

    // 4. Cancelled orders grouped by branch
    prisma.saleOrder.groupBy({
      by: ["branchId"],
      where: {
        branchId: { in: branchIds },
        status: SaleOrderStatus.CANCELLED,
        updatedAt: { gte: window.start, lt: window.end },
      },
      _sum: { grandTotal: true },
      _count: { _all: true },
    }),

    // 5. Manual invoices registered today grouped by branch
    prisma.saleOrder.groupBy({
      by: ["branchId"],
      where: {
        branchId: { in: branchIds },
        manualInvoiceRegisteredAt: { gte: window.start, lt: window.end },
      },
      _count: { _all: true },
    }),

    // 6. Manual invoices pending (not cancelled, requiresManualInvoice, not yet registered)
    prisma.saleOrder.groupBy({
      by: ["branchId"],
      where: {
        branchId: { in: branchIds },
        status: { not: SaleOrderStatus.CANCELLED },
        requiresManualInvoice: true,
        manualInvoiceRegisteredAt: null,
      },
      _count: { _all: true },
    }),

    // 7. Delivery orders issued today grouped by branch
    prisma.saleOrder.groupBy({
      by: ["branchId"],
      where: {
        branchId: { in: branchIds },
        deliveryOrderIssuedAt: { gte: window.start, lt: window.end },
      },
      _count: { _all: true },
    }),

    // 8. Tenders by method and branch
    prisma.paymentTender.groupBy({
      by: ["method"],
      where: { payment: paymentWhere },
      _sum: { amount: true },
      _count: { _all: true },
    }).then(async (rows) => {
      // We need per-branch tender breakdown; fetch payments with saleOrder branchId
      const tenderRows = await prisma.paymentTender.findMany({
        where: { payment: paymentWhere },
        select: {
          method: true,
          amount: true,
          payment: { select: { saleOrder: { select: { branchId: true } } } },
        },
      });
      const result = new Map<string, Array<{ method: PaymentMethod; amount: number; count: number }>>();
      const branchMethodMap = new Map<string, Map<string, { amount: number; count: number }>>();
      for (const row of tenderRows) {
        const bid = row.payment.saleOrder.branchId;
        if (!branchMethodMap.has(bid)) branchMethodMap.set(bid, new Map());
        const methods = branchMethodMap.get(bid)!;
        const entry = methods.get(row.method) ?? { amount: 0, count: 0 };
        entry.amount += n(row.amount);
        entry.count += 1;
        methods.set(row.method, entry);
      }
      for (const [bid, methods] of branchMethodMap) {
        result.set(bid, Array.from(methods.entries()).map(([method, v]) => ({ method: method as PaymentMethod, amount: v.amount, count: v.count })));
      }
      return result;
    }),

    // 9. Last sale per branch
    (async () => {
      const payments = await prisma.payment.findMany({
        where: paymentWhere,
        orderBy: { paidAt: "desc" },
        select: {
          amount: true,
          paidAt: true,
          method: true,
          receivedBy: { select: { username: true, fullName: true } },
          saleOrder: {
            select: {
              id: true,
              orderNumber: true,
              branchId: true,
              createdBy: { select: { username: true, fullName: true } },
            },
          },
        },
      });
      const seen = new Set<string>();
      const result = new Map<string, typeof payments[0]>();
      for (const p of payments) {
        const bid = p.saleOrder.branchId;
        if (!seen.has(bid)) {
          seen.add(bid);
          result.set(bid, p);
        }
      }
      return result;
    })(),
  ]);

  return branches.map((branch) => {
    const bid = branch.id;
    const paid = paidByBranch.get(bid) ?? { total: 0, count: 0 };
    const voided = voidedByBranch.get(bid) ?? 0;
    const pending = pendingByBranch.find((r) => r.branchId === bid);
    const cancelled = cancelledByBranch.find((r) => r.branchId === bid);
    const manualReg = manualRegByBranch.find((r) => r.branchId === bid);
    const manualPend = manualPendingByBranch.find((r) => r.branchId === bid);
    const delivery = deliveryByBranch.find((r) => r.branchId === bid);
    const tenders = tendersByBranch.get(bid) ?? [];
    const lastSaleRaw = lastSalesByBranch.get(bid);
    const lastSale = lastSaleRaw
      ? {
          orderId: lastSaleRaw.saleOrder.id,
          orderNumber: lastSaleRaw.saleOrder.orderNumber,
          amount: n(lastSaleRaw.amount),
          paidAt: lastSaleRaw.paidAt.toISOString(),
          method: lastSaleRaw.method,
          cashierName: lastSaleRaw.receivedBy?.fullName ?? lastSaleRaw.receivedBy?.username ?? null,
          sellerName: lastSaleRaw.saleOrder.createdBy?.fullName ?? lastSaleRaw.saleOrder.createdBy?.username ?? null,
        }
      : null;

    return {
      branchId: branch.id,
      branchCode: branch.code,
      branchName: branch.name,
      businessDate: window.businessDate,
      window: { start: window.start, end: window.end, timezone: TIMEZONE },
      paidSalesTotal: paid.total,
      paidSalesCount: paid.count,
      pendingPaymentTotal: n(pending?._sum.grandTotal),
      pendingPaymentCount: pending?._count._all ?? 0,
      cancelledSalesTotal: n(cancelled?._sum.grandTotal),
      cancelledSalesCount: cancelled?._count._all ?? 0,
      postedPaymentsCount: paid.count,
      voidedPaymentsCount: voided,
      invoicesCount: paid.count,
      manualInvoicesRegistered: manualReg?._count._all ?? 0,
      manualInvoicesPending: manualPend?._count._all ?? 0,
      deliveryOrdersIssued: delivery?._count._all ?? 0,
      lastSale,
      paymentsByMethod: tenders,
    } satisfies RealtimeSalesSummary;
  });
}

/**
 * Slim POS summary — only the 5 fields the POS header widget needs.
 *
 * Runs 3 parallel queries instead of the full 10-query buildBranchRealtimeSalesSummary.
 * TTL: polled at 15-second intervals; not cached server-side (data must be fresh for POS).
 */
export type PosSummarySlim = {
  paidSalesTotal: number;
  paidSalesCount: number;
  pendingPaymentTotal: number;
  pendingPaymentCount: number;
  lastSale: {
    orderNumber: string;
    amount: number;
    paidAt: string;
    method: PaymentMethod;
  } | null;
};

export async function getBranchPosSummarySlim(branchId: string, date?: Date | string | null): Promise<PosSummarySlim> {
  const window = getOperationalWindowForManaguaDate(date);
  const paymentWhere: Prisma.PaymentWhereInput = {
    status: PaymentStatus.POSTED,
    paidAt: { gte: window.start, lt: window.end },
    saleOrder: { branchId, status: { not: SaleOrderStatus.CANCELLED } },
  };

  const [paidPayments, pending, lastSaleRaw] = await Promise.all([
    prisma.payment.aggregate({ where: paymentWhere, _sum: { amount: true }, _count: { _all: true } }),
    prisma.saleOrder.aggregate({
      where: {
        branchId,
        status: SaleOrderStatus.PENDING_PAYMENT,
        createdAt: { gte: window.start, lt: window.end },
      },
      _sum: { grandTotal: true },
      _count: { _all: true },
    }),
    prisma.payment.findFirst({
      where: paymentWhere,
      orderBy: { paidAt: "desc" },
      select: {
        amount: true,
        paidAt: true,
        method: true,
        saleOrder: { select: { orderNumber: true } },
      },
    }),
  ]);

  return {
    paidSalesTotal: n(paidPayments._sum.amount),
    paidSalesCount: paidPayments._count._all,
    pendingPaymentTotal: n(pending._sum.grandTotal),
    pendingPaymentCount: pending._count._all,
    lastSale: lastSaleRaw
      ? {
          orderNumber: lastSaleRaw.saleOrder.orderNumber,
          amount: n(lastSaleRaw.amount),
          paidAt: lastSaleRaw.paidAt.toISOString(),
          method: lastSaleRaw.method,
        }
      : null,
  };
}

export async function getSalesSummaryForOperationalDayTx(tx: Prisma.TransactionClient, operationalDayId: string) {
  const day = await tx.operationalDay.findUniqueOrThrow({
    where: { id: operationalDayId },
    select: {
      businessDate: true,
      branch: { select: { id: true, code: true, name: true } },
    },
  });
  return buildBranchRealtimeSalesSummary(tx, day.branch, businessDateYmd(day.businessDate));
}
