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
  return Promise.all(branches.map((branch) => buildBranchRealtimeSalesSummary(prisma, branch, date)));
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
