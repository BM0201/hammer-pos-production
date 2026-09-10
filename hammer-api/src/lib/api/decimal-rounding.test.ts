/**
 * ════════════════════════════════════════════════════════════════
 * FRONTERA DE SALIDA — Prisma.Decimal redondeado antes de JSON
 * ════════════════════════════════════════════════════════════════
 * Ver decimal-rounding.ts para el porqué. Caso central pedido por el usuario:
 * un Decimal de precisión larga ("100.000000000000000000") debe llegar como
 * "100.00" (o "100" si es la representación exacta que hace .toString() de un
 * Decimal ya en 2dp sin cifras extra — se verifica con Number() para no
 * depender del formato interno de decimal.js).
 */
import assert from "node:assert/strict";
import test from "node:test";
import { Prisma } from "@prisma/client";
import { isMoneyField, roundDecimalsForResponse } from "@/lib/api/decimal-rounding";
import { ok } from "@/lib/api/response";

function n(d: Prisma.Decimal): number {
  return d.toNumber();
}

// ─── isMoneyField — clasificación por nombre de campo ──────────────────

test("isMoneyField: campos de dinero conocidos → true", () => {
  for (const key of ["amount", "totalCost", "unitPrice", "grandTotal", "netPay", "taxAmount", "subtotal", "freightAmount", "ventas30dias", "pagosHoy"]) {
    assert.equal(isMoneyField(key), true, key);
  }
});

test("isMoneyField: porcentajes/factores/scores → false aunque contengan una palabra de dinero", () => {
  // maxDiscountPercent contiene "discount" (dinero) pero "percent" manda: es un %, no C$.
  for (const key of ["maxDiscountPercent", "targetMarginPct", "taxRate", "returnRate", "conversionFactor", "priorityScore", "rotationIndex", "reconciliationTolerancePercent", "priceApprovalDeltaPct"]) {
    assert.equal(isMoneyField(key), false, key);
  }
});

test("isMoneyField: medidas de madera en pies → false aunque contengan 'cost'/'total'", () => {
  // calculatedCostFeet/totalFeet son medidas (pies), no C$ — 'feet' manda sobre 'cost'/'total'.
  for (const key of ["totalFeet", "invoicedFeet", "calculatedFeet", "boardFeet", "calculatedCostFeet"]) {
    assert.equal(isMoneyField(key), false, key);
  }
});

test("isMoneyField: costo POR pie (singular) sigue siendo dinero — 'Foot' no matchea 'feet'", () => {
  for (const key of ["costPerFoot", "computedCostPerFoot", "landedCostPerFoot", "calculatedCostPerFoot"]) {
    assert.equal(isMoneyField(key), true, key);
  }
});

test("isMoneyField: precio por galón es dinero; eficiencia km/galón no lo es", () => {
  assert.equal(isMoneyField("fuelPricePerGallon"), true);
  assert.equal(isMoneyField("fuelEfficiencyKmPerGallon"), false);
});

test("isMoneyField: 'ir' (Impuesto sobre la Renta) es dinero por caso exacto, no substring", () => {
  assert.equal(isMoneyField("ir"), true);
  // substrings que contienen "ir" no deben dispararse por accidente
  assert.equal(isMoneyField("director"), false);
});

test("isMoneyField: Discount.value es polimórfico (% o C$) → default seguro NO-dinero (4dp)", () => {
  assert.equal(isMoneyField("value"), false);
  // pero campos que TERMINAN en "value" y son inequívocamente monetarios sí son dinero
  assert.equal(isMoneyField("inventoryValue"), true);
  assert.equal(isMoneyField("lineValue"), true);
  assert.equal(isMoneyField("vacationValuePaid"), true);
});

test("isMoneyField: días son cantidad, no dinero", () => {
  assert.equal(isMoneyField("absenceDays"), false);
  assert.equal(isMoneyField("vacationDaysPaid"), false);
});

test("isMoneyField: 'proratedSalary' es dinero — 'prorated' contiene 'rate' por accidente, no debe excluirse", () => {
  assert.equal(isMoneyField("proratedSalary"), true);
  // control: taxRate/returnRate SÍ deben seguir excluidos (ahí "rate" es real, no accidental)
  assert.equal(isMoneyField("taxRate"), false);
  assert.equal(isMoneyField("returnRate"), false);
});

test("isMoneyField: 'calculatedProfit' es dinero (ganancia en C$, junto a calculatedSaleTotal)", () => {
  assert.equal(isMoneyField("calculatedProfit"), true);
});

test("isMoneyField: 'margin' a secas es dinero (SaleOrderLine.marginSnapshot vs .marginPercentSnapshot: el propio schema distingue el monto en C$ del %)", () => {
  assert.equal(isMoneyField("marginSnapshot"), true);
  assert.equal(isMoneyField("suggestedMargin"), true);
  // "Múltiplo (C$) al que se redondea el precio" según el comentario de schema.prisma — es C$, no %.
  assert.equal(isMoneyField("targetMarginRoundingMultiple"), true);
  // pero *Percent/*Pct sobre margin siguen siendo % — el exclude gana antes de ver "margin"
  assert.equal(isMoneyField("marginPercent"), false);
  assert.equal(isMoneyField("targetMarginPercent"), false);
  assert.equal(isMoneyField("calculatedMarginPct"), false);
});

// ─── roundDecimalsForResponse — el walker recursivo ─────────────────────

test("roundDecimalsForResponse: Decimal de precisión larga en campo de dinero → 2 decimales exactos", () => {
  const input = { amount: new Prisma.Decimal("100.000000000000000000") };
  const out = roundDecimalsForResponse(input);
  assert.equal(out.amount.toString(), "100");
  assert.equal(n(out.amount), 100);
  assert.equal(out.amount.toDecimalPlaces(2).toFixed(2), "100.00");
});

test("roundDecimalsForResponse: division no exacta en campo de dinero → redondea a 2dp", () => {
  // 100/3 = 33.333333... — nunca debe llegar así a un monto.
  const input = { total: new Prisma.Decimal(100).dividedBy(3) };
  const out = roundDecimalsForResponse(input);
  assert.equal(out.total.toFixed(2), "33.33");
});

test("roundDecimalsForResponse: campo de cantidad/factor conserva 4 decimales, no 2", () => {
  const input = { conversionFactor: new Prisma.Decimal(100).dividedBy(3) };
  const out = roundDecimalsForResponse(input);
  assert.equal(out.conversionFactor.toFixed(4), "33.3333");
});

test("roundDecimalsForResponse: recorre objetos anidados", () => {
  const input = {
    order: {
      grandTotal: new Prisma.Decimal("250.126"),
      lines: [{ unitPrice: new Prisma.Decimal("10.005") }],
    },
  };
  const out = roundDecimalsForResponse(input);
  assert.equal(out.order.grandTotal.toFixed(2), "250.13");
  assert.equal(out.order.lines[0].unitPrice.toFixed(2), "10.01"); // banker's/half-up de decimal.js por defecto (ROUND_HALF_UP)
});

test("roundDecimalsForResponse: recorre arrays de Decimal directamente, clasificando por la key del array", () => {
  const input = { discountAmount: [new Prisma.Decimal("5.005"), new Prisma.Decimal("10.115")] };
  const out = roundDecimalsForResponse(input);
  assert.equal(out.discountAmount[0].toFixed(2), "5.01");
  assert.equal(out.discountAmount[1].toFixed(2), "10.12");
});

test("roundDecimalsForResponse: no toca valores no-Decimal (string, number, boolean, null, Date)", () => {
  const date = new Date("2026-01-01T00:00:00.000Z");
  const input = { name: "x", count: 5, active: true, note: null, when: date };
  const out = roundDecimalsForResponse(input);
  assert.deepEqual(out, input);
  assert.equal(out.when, date);
});

test("roundDecimalsForResponse: no muta el Decimal original (toDecimalPlaces devuelve uno nuevo)", () => {
  const original = new Prisma.Decimal(100).dividedBy(3); // 33.333333333333333333...
  const input = { total: original };
  const out = roundDecimalsForResponse(input);
  assert.notEqual(out.total, original, "debe ser una instancia distinta");
  assert.equal(out.total.toFixed(2), "33.33");
  assert.equal(original.decimalPlaces() > 2, true, "el Decimal original conserva su precisión completa, sin mutar");
});

// ─── Integración: ok() aplica el redondeo automáticamente ───────────────

test("ok(): un Decimal de precisión larga en un campo de dinero sale como '100.00' en el JSON final", async () => {
  const res = ok({ amount: new Prisma.Decimal("100.000000000000000000") });
  const body = await res.json();
  assert.equal(body.ok, true);
  // Prisma.Decimal.toJSON() serializa a string; después de .toDecimalPlaces(2) el
  // string ya no carga precisión extra.
  assert.equal(Number(body.data.amount).toFixed(2), "100.00");
});

test("ok(): una division no exacta (100/3) en un campo de cantidad sale con 4 decimales, no con precisión completa", async () => {
  const res = ok({ conversionFactor: new Prisma.Decimal(100).dividedBy(3) });
  const body = await res.json();
  assert.equal(body.data.conversionFactor, "33.3333");
});
