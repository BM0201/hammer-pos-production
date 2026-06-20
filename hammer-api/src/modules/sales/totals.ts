import { Prisma } from "@prisma/client";

export function calculateLineSubtotal(quantity: Prisma.Decimal, unitPrice: Prisma.Decimal, discountAmount: Prisma.Decimal) {
  const gross = quantity.mul(unitPrice);
  const subtotal = gross.minus(discountAmount);
  if (subtotal.lt(new Prisma.Decimal(0))) {
    throw new Error("INVALID_LINE_TOTAL");
  }
  return subtotal;
}

export function aggregateOrderTotals(
  lines: Array<{ lineSubtotal: Prisma.Decimal; discountAmount: Prisma.Decimal }>,
  transportAmount: Prisma.Decimal = new Prisma.Decimal(0),
) {
  const subtotal = lines.reduce((acc, line) => acc.plus(line.lineSubtotal), new Prisma.Decimal(0));
  const discountTotal = lines.reduce((acc, line) => acc.plus(line.discountAmount), new Prisma.Decimal(0));
  const taxTotal = new Prisma.Decimal(0);
  // grandTotal = subtotal (already has line-level discounts) + tax + transport
  const grandTotal = subtotal.plus(taxTotal).plus(transportAmount);

  return { subtotal, discountTotal, taxTotal, grandTotal, transportAmount };
}
