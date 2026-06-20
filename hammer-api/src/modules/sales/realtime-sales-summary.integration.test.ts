import assert from "node:assert/strict";
import test from "node:test";
import { PaymentMethod, PaymentStatus, SaleOrderStatus } from "@prisma/client";
import { buildBranchRealtimeSalesSummary } from "@/modules/sales/realtime-sales-summary";

type OrderRow = {
  id: string;
  orderNumber: string;
  branchId: string;
  status: SaleOrderStatus;
  grandTotal: number;
  createdAt: Date;
  updatedAt: Date;
  requiresManualInvoice?: boolean;
  manualInvoiceRegisteredAt?: Date | null;
  deliveryOrderIssuedAt?: Date | null;
  createdBy: { username: string; fullName: string | null };
};

type PaymentRow = {
  id: string;
  saleOrderId: string;
  status: PaymentStatus;
  amount: number;
  paidAt: Date;
  method: PaymentMethod;
  receivedBy: { username: string; fullName: string | null };
};

type TenderRow = {
  id: string;
  paymentId: string;
  method: PaymentMethod;
  amount: number;
  receivedAmount?: number | null;
  changeAmount?: number | null;
};

function sum(values: number[]) {
  return values.reduce((acc, value) => acc + value, 0);
}

function createRealtimeDb(input: { orders: OrderRow[]; payments: PaymentRow[]; tenders: TenderRow[] }) {
  const orderById = new Map(input.orders.map((order) => [order.id, order]));
  const paymentById = new Map(input.payments.map((payment) => [payment.id, payment]));

  function matchesDate(date: Date | null | undefined, range: { gte?: Date; lt?: Date } | undefined) {
    if (!range) return true;
    if (!date) return false;
    if (range.gte && date < range.gte) return false;
    if (range.lt && date >= range.lt) return false;
    return true;
  }

  function matchesStatus<T extends string>(status: T, condition: T | { not?: T } | undefined) {
    if (!condition) return true;
    if (typeof condition === "string") return status === condition;
    if (condition.not) return status !== condition.not;
    return true;
  }

  function matchesPaymentWhere(payment: PaymentRow, where: any) {
    const order = orderById.get(payment.saleOrderId);
    if (!order) return false;
    if (where.status && payment.status !== where.status) return false;
    if (!matchesDate(payment.paidAt, where.paidAt)) return false;
    if (where.saleOrder?.branchId && order.branchId !== where.saleOrder.branchId) return false;
    if (where.saleOrder?.status && !matchesStatus(order.status, where.saleOrder.status)) return false;
    return true;
  }

  function matchesOrderWhere(order: OrderRow, where: any) {
    if (where.branchId && order.branchId !== where.branchId) return false;
    if (where.status && !matchesStatus(order.status, where.status)) return false;
    if (where.updatedAt && !matchesDate(order.updatedAt, where.updatedAt)) return false;
    if (where.manualInvoiceRegisteredAt !== undefined) {
      if (where.manualInvoiceRegisteredAt === null && order.manualInvoiceRegisteredAt) return false;
      if (where.manualInvoiceRegisteredAt !== null && !matchesDate(order.manualInvoiceRegisteredAt, where.manualInvoiceRegisteredAt)) return false;
    }
    if (where.deliveryOrderIssuedAt !== undefined && !matchesDate(order.deliveryOrderIssuedAt, where.deliveryOrderIssuedAt)) return false;
    if (where.requiresManualInvoice !== undefined && Boolean(order.requiresManualInvoice) !== where.requiresManualInvoice) return false;
    return true;
  }

  return {
    payment: {
      aggregate: async ({ where }: any) => {
        const rows = input.payments.filter((payment) => matchesPaymentWhere(payment, where));
        return { _sum: { amount: sum(rows.map((row) => row.amount)) }, _count: { _all: rows.length } };
      },
      count: async ({ where }: any) => input.payments.filter((payment) => matchesPaymentWhere(payment, where)).length,
      findFirst: async ({ where }: any) => {
        const row = input.payments
          .filter((payment) => matchesPaymentWhere(payment, where))
          .sort((a, b) => b.paidAt.getTime() - a.paidAt.getTime())[0];
        if (!row) return null;
        const order = orderById.get(row.saleOrderId)!;
        return {
          amount: row.amount,
          paidAt: row.paidAt,
          method: row.method,
          receivedBy: row.receivedBy,
          saleOrder: {
            id: order.id,
            orderNumber: order.orderNumber,
            createdBy: order.createdBy,
          },
        };
      },
    },
    saleOrder: {
      aggregate: async ({ where }: any) => {
        const rows = input.orders.filter((order) => matchesOrderWhere(order, where));
        return { _sum: { grandTotal: sum(rows.map((row) => row.grandTotal)) }, _count: { _all: rows.length } };
      },
      count: async ({ where }: any) => input.orders.filter((order) => matchesOrderWhere(order, where)).length,
    },
    paymentTender: {
      groupBy: async ({ where }: any) => {
        const rows = input.tenders.filter((tender) => {
          const payment = paymentById.get(tender.paymentId);
          return payment ? matchesPaymentWhere(payment, where.payment) : false;
        });
        const byMethod = new Map<PaymentMethod, TenderRow[]>();
        for (const row of rows) byMethod.set(row.method, [...(byMethod.get(row.method) ?? []), row]);
        return [...byMethod.entries()].map(([method, tenders]) => ({
          method,
          _sum: { amount: sum(tenders.map((row) => row.amount)) },
          _count: { _all: tenders.length },
        }));
      },
    },
  } as any;
}

const MSY = { id: "branch-msy", code: "MSY", name: "Masaya" };
const MGA = { id: "branch-mga", code: "MGA", name: "Managua" };
const today = "2026-06-10";
const paidToday = new Date("2026-06-10T15:00:00.000Z");
const yesterday = new Date("2026-06-09T15:00:00.000Z");

test("integration A/B/C/D/E/F/G: realtime sales summary follows paidAt, pending, cancellation, multi-branch and timezone rules", async () => {
  const orders: OrderRow[] = [
    { id: "sale-500", orderNumber: "OE-500", branchId: MSY.id, status: SaleOrderStatus.DISPATCHED, grandTotal: 500, createdAt: paidToday, updatedAt: paidToday, createdBy: { username: "seller", fullName: "Seller" } },
    { id: "pending-700", orderNumber: "OE-700", branchId: MSY.id, status: SaleOrderStatus.PENDING_PAYMENT, grandTotal: 700, createdAt: paidToday, updatedAt: paidToday, createdBy: { username: "seller", fullName: "Seller" } },
    { id: "paid-700", orderNumber: "OE-701", branchId: MSY.id, status: SaleOrderStatus.DISPATCH_PENDING, grandTotal: 700, createdAt: paidToday, updatedAt: paidToday, createdBy: { username: "seller", fullName: "Seller" } },
    { id: "draft-yesterday-paid-today", orderNumber: "OE-YDAY", branchId: MSY.id, status: SaleOrderStatus.PAID, grandTotal: 250, createdAt: yesterday, updatedAt: paidToday, createdBy: { username: "seller", fullName: "Seller" } },
    { id: "cancelled-500", orderNumber: "OE-CAN", branchId: MSY.id, status: SaleOrderStatus.CANCELLED, grandTotal: 500, createdAt: paidToday, updatedAt: paidToday, createdBy: { username: "seller", fullName: "Seller" } },
    { id: "mga-300", orderNumber: "OE-MGA", branchId: MGA.id, status: SaleOrderStatus.PAID, grandTotal: 300, createdAt: paidToday, updatedAt: paidToday, createdBy: { username: "seller2", fullName: "Seller MGA" } },
    { id: "near-midnight", orderNumber: "OE-TZ", branchId: MSY.id, status: SaleOrderStatus.PAID, grandTotal: 90, createdAt: new Date("2026-06-11T03:30:00.000Z"), updatedAt: new Date("2026-06-11T03:30:00.000Z"), createdBy: { username: "seller", fullName: "Seller" } },
  ];
  const payments: PaymentRow[] = [
    { id: "pay-500", saleOrderId: "sale-500", status: PaymentStatus.POSTED, amount: 500, paidAt: paidToday, method: PaymentMethod.CASH, receivedBy: { username: "cashier", fullName: "Cashier" } },
    { id: "pay-700", saleOrderId: "paid-700", status: PaymentStatus.POSTED, amount: 700, paidAt: paidToday, method: PaymentMethod.CARD, receivedBy: { username: "cashier", fullName: "Cashier" } },
    { id: "pay-yday", saleOrderId: "draft-yesterday-paid-today", status: PaymentStatus.POSTED, amount: 250, paidAt: paidToday, method: PaymentMethod.TRANSFER, receivedBy: { username: "cashier", fullName: "Cashier" } },
    { id: "pay-cancelled", saleOrderId: "cancelled-500", status: PaymentStatus.VOIDED, amount: 500, paidAt: paidToday, method: PaymentMethod.CASH, receivedBy: { username: "cashier", fullName: "Cashier" } },
    { id: "pay-mga", saleOrderId: "mga-300", status: PaymentStatus.POSTED, amount: 300, paidAt: paidToday, method: PaymentMethod.CASH, receivedBy: { username: "cashier2", fullName: "Cashier MGA" } },
    { id: "pay-tz", saleOrderId: "near-midnight", status: PaymentStatus.POSTED, amount: 90, paidAt: new Date("2026-06-11T03:30:00.000Z"), method: PaymentMethod.CASH, receivedBy: { username: "cashier", fullName: "Cashier" } },
  ];
  const tenders: TenderRow[] = payments.map((payment) => ({ id: `t-${payment.id}`, paymentId: payment.id, method: payment.method, amount: payment.amount }));
  const db = createRealtimeDb({ orders, payments, tenders });

  const msy = await buildBranchRealtimeSalesSummary(db, MSY, today);
  const mga = await buildBranchRealtimeSalesSummary(db, MGA, today);

  assert.equal(msy.paidSalesTotal, 1540);
  assert.equal(msy.pendingPaymentTotal, 700);
  assert.equal(msy.pendingPaymentCount, 1);
  assert.equal(msy.voidedPaymentsCount, 1);
  assert.equal(msy.cancelledSalesTotal, 500);
  assert.equal(msy.lastSale?.orderNumber, "OE-TZ");
  assert.equal(mga.paidSalesTotal, 300);
  assert.equal(msy.paidSalesTotal + mga.paidSalesTotal, 1840);

  const nextManaguaDay = await buildBranchRealtimeSalesSummary(db, MSY, "2026-06-11");
  assert.equal(nextManaguaDay.paidSalesTotal, 0);
});

test("integration: mixed payments and cash change use Payment.amount for net sales and PaymentTender for method breakdown", async () => {
  const orders: OrderRow[] = [
    { id: "mixed-1000", orderNumber: "OE-MIX", branchId: MSY.id, status: SaleOrderStatus.PAID, grandTotal: 1000, createdAt: paidToday, updatedAt: paidToday, createdBy: { username: "seller", fullName: null } },
    { id: "cash-change-300", orderNumber: "OE-CHANGE", branchId: MSY.id, status: SaleOrderStatus.PAID, grandTotal: 300, createdAt: paidToday, updatedAt: paidToday, createdBy: { username: "seller", fullName: null } },
  ];
  const payments: PaymentRow[] = [
    { id: "pay-mixed", saleOrderId: "mixed-1000", status: PaymentStatus.POSTED, amount: 1000, paidAt: paidToday, method: PaymentMethod.MIXED, receivedBy: { username: "cashier", fullName: null } },
    { id: "pay-change", saleOrderId: "cash-change-300", status: PaymentStatus.POSTED, amount: 300, paidAt: paidToday, method: PaymentMethod.CASH, receivedBy: { username: "cashier", fullName: null } },
  ];
  const tenders: TenderRow[] = [
    { id: "t-mixed-cash", paymentId: "pay-mixed", method: PaymentMethod.CASH, amount: 600 },
    { id: "t-mixed-card", paymentId: "pay-mixed", method: PaymentMethod.CARD, amount: 400 },
    { id: "t-change-cash", paymentId: "pay-change", method: PaymentMethod.CASH, amount: 300, receivedAmount: 500, changeAmount: 200 },
  ];
  const summary = await buildBranchRealtimeSalesSummary(createRealtimeDb({ orders, payments, tenders }), MSY, today);

  assert.equal(summary.paidSalesTotal, 1300);
  assert.deepEqual(
    Object.fromEntries(summary.paymentsByMethod.map((item) => [item.method, item.amount])),
    { CASH: 900, CARD: 400 },
  );
});

test("integration: manual invoice registration after payment and later cancellation stay out of net sales", async () => {
  const orders: OrderRow[] = [
    {
      id: "manual-invoice",
      orderNumber: "OE-MANUAL",
      branchId: MSY.id,
      status: SaleOrderStatus.CANCELLED,
      grandTotal: 800,
      createdAt: paidToday,
      updatedAt: paidToday,
      requiresManualInvoice: true,
      manualInvoiceRegisteredAt: paidToday,
      deliveryOrderIssuedAt: paidToday,
      createdBy: { username: "seller", fullName: null },
    },
  ];
  const payments: PaymentRow[] = [
    { id: "pay-manual-voided", saleOrderId: "manual-invoice", status: PaymentStatus.VOIDED, amount: 800, paidAt: paidToday, method: PaymentMethod.CASH, receivedBy: { username: "cashier", fullName: null } },
  ];
  const summary = await buildBranchRealtimeSalesSummary(createRealtimeDb({ orders, payments, tenders: [{ id: "t-manual", paymentId: "pay-manual-voided", method: PaymentMethod.CASH, amount: 800 }] }), MSY, today);

  assert.equal(summary.paidSalesTotal, 0);
  assert.equal(summary.manualInvoicesRegistered, 1);
  assert.equal(summary.deliveryOrdersIssued, 1);
  assert.equal(summary.cancelledSalesTotal, 800);
  assert.equal(summary.voidedPaymentsCount, 1);
});
