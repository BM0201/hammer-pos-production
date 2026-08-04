import assert from "node:assert/strict";
import test from "node:test";
import { Prisma } from "@prisma/client";
import { aggregateOrderTotals, calculateLineSubtotal } from "@/modules/sales/totals";

/**
 * Bug 1 + Bug 2 (auditoría ventas/pagos/POS, sync offline): syncOfflineSale
 * hacía aritmética float propia (quantity*unitPrice-discountAmount con
 * numbers de JS) y confiaba ciegamente en el grandTotal que manda el
 * dispositivo offline, sin recalcularlo. El fix reusa calculateLineSubtotal/
 * aggregateOrderTotals — las mismas funciones que ya usa el flujo online vía
 * recalcOrderTotalsTx — y valida el total del cliente contra el recalculado
 * en el servidor con una tolerancia de un centavo.
 *
 * Estos tests ejercitan las funciones REALES de totals.ts (puras, sin DB) de
 * la misma forma en que syncOfflineSale las usa hoy, y una copia espejo del
 * chequeo de tolerancia (esa decisión vive inlineada en
 * offline-sync.service.ts, paso 3c). Los efectos en DB — persistencia de la
 * orden/pago/auditLog — se cubren en integración/QA manual, mismo criterio
 * que operational-day-open-reopen.test.ts.
 */

const TOTAL_TOLERANCE = new Prisma.Decimal("0.01");

// Espejo exacto del chequeo de mismatch en syncOfflineSale (paso 3c).
function isOfflineSyncTotalMismatch(clientGrandTotal: Prisma.Decimal, serverGrandTotal: Prisma.Decimal) {
  return clientGrandTotal.minus(serverGrandTotal).abs().gt(TOTAL_TOLERANCE);
}

// Espejo del mapeo que syncOfflineSale hace sobre input.lines antes de
// llamar a aggregateOrderTotals (linesWithTotals + totals, paso 3c).
type RawLine = { quantity: number; unitPrice: number; discountAmount: number };
function recalcOfflineTotals(lines: RawLine[]) {
  const withSubtotal = lines.map((line) => {
    const quantity = new Prisma.Decimal(line.quantity);
    const unitPrice = new Prisma.Decimal(line.unitPrice);
    const discountAmount = new Prisma.Decimal(line.discountAmount);
    return { lineSubtotal: calculateLineSubtotal(quantity, unitPrice, discountAmount), discountAmount };
  });
  // El offline sync no maneja transporte por ahora.
  return aggregateOrderTotals(withSubtotal, new Prisma.Decimal(0));
}

test("bug 2: linea con cantidad fraccionaria (ej. madera por pies tablares) da el mismo lineSubtotal que calculateLineSubtotal directamente", () => {
  const raw: RawLine = { quantity: 11.333, unitPrice: 2.5, discountAmount: 1.25 };

  const viaOfflineSyncPath = recalcOfflineTotals([raw]);
  const viaDirectCall = calculateLineSubtotal(
    new Prisma.Decimal(raw.quantity),
    new Prisma.Decimal(raw.unitPrice),
    new Prisma.Decimal(raw.discountAmount),
  );

  // aggregateOrderTotals.subtotal es la suma de lineSubtotal — con una sola
  // línea, es exactamente el lineSubtotal de esa línea.
  assert.equal(viaOfflineSyncPath.subtotal.toString(), viaDirectCall.toString());
  assert.equal(viaDirectCall.toString(), "27.0825"); // 11.333*2.5 - 1.25 = 28.3325 - 1.25
});

test("bug 2: 3 * 1.1 da exactamente 3.3 en Decimal — el float nativo de JS da 3.3000000000000003", () => {
  assert.notEqual(3 * 1.1, 3.3, "demuestra el problema de precisión que la aritmética float tenía en syncOfflineSale");
  const lineSubtotal = calculateLineSubtotal(new Prisma.Decimal(3), new Prisma.Decimal(1.1), new Prisma.Decimal(0));
  assert.equal(lineSubtotal.toString(), "3.3");
});

test("bug 1 (caso sano): grandTotal del cliente dentro de tolerancia (<= 0.01) NO dispara mismatch", () => {
  const totals = recalcOfflineTotals([
    { quantity: 2, unitPrice: 150, discountAmount: 10 },
    { quantity: 1, unitPrice: 55.5, discountAmount: 0 },
  ]);
  assert.equal(totals.grandTotal.toString(), "345.5");

  // Redondeo de display del lado del cliente — medio centavo de diferencia.
  const clientGrandTotal = new Prisma.Decimal("345.505");
  assert.equal(isOfflineSyncTotalMismatch(clientGrandTotal, totals.grandTotal), false);
});

test("bug 1: grandTotal del cliente fuera de tolerancia SI dispara mismatch", () => {
  const totals = recalcOfflineTotals([{ quantity: 2, unitPrice: 150, discountAmount: 10 }]);
  assert.equal(totals.grandTotal.toString(), "290");

  const clientGrandTotal = new Prisma.Decimal("300"); // 10 de diferencia
  assert.equal(isOfflineSyncTotalMismatch(clientGrandTotal, totals.grandTotal), true);
});

test("bug 1: límite exacto de la tolerancia — 0.01 de diferencia NO es mismatch, 0.02 SI", () => {
  const server = new Prisma.Decimal("100.00");
  assert.equal(isOfflineSyncTotalMismatch(new Prisma.Decimal("100.01"), server), false);
  assert.equal(isOfflineSyncTotalMismatch(new Prisma.Decimal("100.02"), server), true);
});

test("bug 1: discountTotal/subtotal/grandTotal salen de aggregateOrderTotals, no de un reduce en float", () => {
  const totals = recalcOfflineTotals([
    { quantity: 3, unitPrice: 10, discountAmount: 1.5 },
    { quantity: 2, unitPrice: 20, discountAmount: 2.5 },
  ]);
  // discountTotal = 1.5 + 2.5 = 4
  // subtotal = (30-1.5) + (40-2.5) = 28.5 + 37.5 = 66 (ya neto de descuento, como el flujo online)
  assert.equal(totals.discountTotal.toString(), "4");
  assert.equal(totals.subtotal.toString(), "66");
  assert.equal(totals.grandTotal.toString(), "66");
});

test("calculateLineSubtotal rechaza un descuento mayor al bruto de la línea (INVALID_LINE_TOTAL) — misma validación que el flujo online", () => {
  assert.throws(
    () => calculateLineSubtotal(new Prisma.Decimal(1), new Prisma.Decimal(10), new Prisma.Decimal(15)),
    /INVALID_LINE_TOTAL/,
  );
});
