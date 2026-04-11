import test from "node:test";
import assert from "node:assert/strict";
import { Prisma } from "@prisma/client";
import { calculateLineSubtotal, aggregateOrderTotals } from "../../src/modules/sales/totals";

test("calculateLineSubtotal computes quantity * unitPrice - discount", () => {
  const result = calculateLineSubtotal(
    new Prisma.Decimal("3"),
    new Prisma.Decimal("100.00"),
    new Prisma.Decimal("10.00"),
  );
  assert.equal(result.toString(), "290");
});

test("aggregateOrderTotals sums lines correctly (discount already in lineSubtotal)", () => {
  const lines = [
    { lineSubtotal: new Prisma.Decimal("90.00"), discountAmount: new Prisma.Decimal("10.00") },
    { lineSubtotal: new Prisma.Decimal("200.00"), discountAmount: new Prisma.Decimal("0.00") },
  ];
  const result = aggregateOrderTotals(lines);
  assert.equal(result.subtotal.toString(), "290");
  assert.equal(result.discountTotal.toString(), "10");
  // grandTotal = subtotal + tax(0) + transport(0), discount already deducted in lineSubtotal
  assert.equal(result.grandTotal.toString(), "290");
});

test("aggregateOrderTotals handles empty lines", () => {
  const result = aggregateOrderTotals([]);
  assert.equal(result.subtotal.toString(), "0");
  assert.equal(result.grandTotal.toString(), "0");
});
