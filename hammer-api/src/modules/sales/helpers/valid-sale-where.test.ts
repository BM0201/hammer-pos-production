import { test } from "node:test";
import assert from "node:assert/strict";
import { PaymentStatus, SaleOrderStatus } from "@prisma/client";
import {
  CLOSED_SALE_ORDER_STATUSES,
  VALID_SALE_EXCLUSIONS,
  validPaymentWhere,
  validSaleWhere,
  validSaleWhereWithDates,
} from "@/modules/sales/helpers/valid-sale-where";

test("validSaleWhere SIEMPRE excluye anuladas y de prueba", () => {
  const where = validSaleWhere();
  assert.equal(where.voidedAt, null);
  assert.equal(where.isTest, false);
  // Sin status explícito → excluye CANCELLED.
  assert.deepEqual(where.status, { not: SaleOrderStatus.CANCELLED });
});

test("validSaleWhere respeta un status explícito del llamador", () => {
  const where = validSaleWhere({ status: { in: CLOSED_SALE_ORDER_STATUSES } });
  assert.deepEqual(where.status, { in: CLOSED_SALE_ORDER_STATUSES });
  assert.equal(where.voidedAt, null);
  assert.equal(where.isTest, false);
});

test("validSaleWhere conserva filtros extra (branchId)", () => {
  const where = validSaleWhere({ branchId: "branch-1" });
  assert.equal(where.branchId, "branch-1");
  assert.equal(where.voidedAt, null);
  assert.equal(where.isTest, false);
});

test("validSaleWhereWithDates arma rango createdAt + exclusiones", () => {
  const start = new Date("2026-06-09T06:00:00.000Z");
  const end = new Date("2026-06-10T06:00:00.000Z");
  const where = validSaleWhereWithDates({ branchId: "b1", start, end, status: SaleOrderStatus.PENDING_PAYMENT });
  assert.equal(where.branchId, "b1");
  assert.deepEqual(where.createdAt, { gte: start, lt: end });
  assert.equal(where.status, SaleOrderStatus.PENDING_PAYMENT);
  assert.equal(where.voidedAt, null);
  assert.equal(where.isTest, false);
});

test("validPaymentWhere filtra POSTED + venta válida (defensa en profundidad)", () => {
  const start = new Date("2026-06-09T06:00:00.000Z");
  const end = new Date("2026-06-10T06:00:00.000Z");
  const where = validPaymentWhere({ branchId: "b1", start, end });
  assert.equal(where.status, PaymentStatus.POSTED);
  assert.deepEqual(where.paidAt, { gte: start, lt: end });
  const saleOrder = where.saleOrder as Record<string, unknown>;
  assert.equal(saleOrder.branchId, "b1");
  assert.equal(saleOrder.voidedAt, null);
  assert.equal(saleOrder.isTest, false);
});

test("VALID_SALE_EXCLUSIONS expone el núcleo del filtro", () => {
  assert.deepEqual(VALID_SALE_EXCLUSIONS, { voidedAt: null, isTest: false });
});
