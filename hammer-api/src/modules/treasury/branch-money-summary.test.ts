import assert from "node:assert/strict";
import test from "node:test";
import { PaymentMethod } from "@prisma/client";
import { buildWeeklyMoneyBreakdown, computeWeekChangePercent } from "@/modules/treasury/branch-money-summary";
import { businessDateFromInput } from "@/modules/operations/business-date";

const MONDAY = businessDateFromInput("2026-08-10");

function tender(method: PaymentMethod, amount: number, dateStr: string) {
  return { method, amount, businessDate: businessDateFromInput(dateStr) };
}

test("Prueba 1 (doc): semana con 39,421 en efectivo, 21,627 en transferencia y 8,300 en tarjeta — los tres totales y el total 69,348", () => {
  const { totals } = buildWeeklyMoneyBreakdown([
    tender(PaymentMethod.CASH, 39421, "2026-08-11"),
    tender(PaymentMethod.TRANSFER, 21627, "2026-08-12"),
    tender(PaymentMethod.CARD, 8300, "2026-08-13"),
  ], MONDAY);
  assert.equal(totals.cash, 39421);
  assert.equal(totals.transfer, 21627);
  assert.equal(totals.card, 8300);
  assert.equal(totals.total, 69348);
});

test("Prueba 2 (doc): una venta mixta (efectivo + transferencia) se reparte entre las dos columnas, no cae entera en una", () => {
  // Una venta mixta ya llega como dos PaymentTender separados (uno por método) — nunca uno solo.
  const { totals, days } = buildWeeklyMoneyBreakdown([
    tender(PaymentMethod.CASH, 300, "2026-08-11"),
    tender(PaymentMethod.TRANSFER, 700, "2026-08-11"),
  ], MONDAY);
  assert.equal(totals.cash, 300);
  assert.equal(totals.transfer, 700);
  assert.equal(totals.total, 1000);
  const monday = days.find((d) => d.businessDate === "2026-08-11")!;
  assert.equal(monday.cash, 300);
  assert.equal(monday.transfer, 700);
  assert.equal(monday.total, 1000);
});

test("Prueba 4 (doc): día sin ventas — la fila está presente, en blanco (no se omite)", () => {
  const { days } = buildWeeklyMoneyBreakdown([tender(PaymentMethod.CASH, 100, "2026-08-11")], MONDAY);
  assert.equal(days.length, 7);
  const saturday = days.find((d) => d.businessDate === "2026-08-15")!;
  assert.ok(saturday);
  assert.equal(saturday.total, 0);
  assert.deepEqual(saturday, { businessDate: "2026-08-15", cash: 0, transfer: 0, card: 0, other: 0, total: 0 });
});

test("zero-fill: los 7 días de la semana existen incluso sin ningún tender", () => {
  const { days, totals } = buildWeeklyMoneyBreakdown([], MONDAY);
  assert.equal(days.length, 7);
  assert.deepEqual(days.map((d) => d.businessDate), ["2026-08-10", "2026-08-11", "2026-08-12", "2026-08-13", "2026-08-14", "2026-08-15", "2026-08-16"]);
  assert.equal(totals.total, 0);
});

test("CREDIT (u otro método no listado en la pantalla) se agrupa en 'other' — nunca se descarta plata del total", () => {
  const { totals } = buildWeeklyMoneyBreakdown([
    tender(PaymentMethod.CASH, 100, "2026-08-11"),
    tender(PaymentMethod.CREDIT, 50, "2026-08-11"),
  ], MONDAY);
  assert.equal(totals.other, 50);
  assert.equal(totals.total, 150); // 100 + 50, no 100
});

test("computeWeekChangePercent: aumento vs. semana pasada", () => {
  assert.equal(computeWeekChangePercent(112, 100), 12);
});

test("computeWeekChangePercent: caída vs. semana pasada", () => {
  assert.equal(computeWeekChangePercent(80, 100), -20);
});

test("computeWeekChangePercent: semana anterior en cero — null, no división por cero/Infinity", () => {
  assert.equal(computeWeekChangePercent(500, 0), null);
});
