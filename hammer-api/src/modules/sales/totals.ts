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
  manualDiscountAmount: Prisma.Decimal = new Prisma.Decimal(0),
) {
  const lineSubtotal = lines.reduce((acc, line) => acc.plus(line.lineSubtotal), new Prisma.Decimal(0));
  const lineDiscountTotal = lines.reduce((acc, line) => acc.plus(line.discountAmount), new Prisma.Decimal(0));

  // El descuento manual de orden no puede superar el subtotal neto de líneas.
  const safeManualDiscount = manualDiscountAmount.lt(0)
    ? new Prisma.Decimal(0)
    : manualDiscountAmount.gt(lineSubtotal)
      ? lineSubtotal
      : manualDiscountAmount;

  // El subtotal mostrado descuenta el descuento manual de la orden.
  const subtotal = lineSubtotal.minus(safeManualDiscount);
  // discountTotal informa el total de descuentos (por línea + manual de orden).
  const discountTotal = lineDiscountTotal.plus(safeManualDiscount);
  const taxTotal = new Prisma.Decimal(0);
  // grandTotal = subtotal neto (líneas - descuento manual) + impuesto + transporte
  const grandTotal = subtotal.plus(taxTotal).plus(transportAmount);

  return { subtotal, discountTotal, taxTotal, grandTotal, transportAmount, manualDiscountAmount: safeManualDiscount };
}
