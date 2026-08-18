import assert from "node:assert/strict";
import test from "node:test";
import { weekStartForBusinessDate, businessDateWeekRange, businessDateFromInput } from "@/modules/operations/business-date";

function ymd(date: Date) {
  return date.toISOString().slice(0, 10);
}

test("weekStartForBusinessDate: un lunes es el inicio de su propia semana", () => {
  const monday = businessDateFromInput("2026-08-10"); // lunes
  assert.equal(ymd(weekStartForBusinessDate(monday)), "2026-08-10");
});

test("weekStartForBusinessDate: un domingo pertenece a la semana que empezó el lunes anterior", () => {
  const sunday = businessDateFromInput("2026-08-16"); // domingo
  assert.equal(ymd(weekStartForBusinessDate(sunday)), "2026-08-10");
});

test("weekStartForBusinessDate: un miércoles cae dentro de la semana de su lunes", () => {
  const wednesday = businessDateFromInput("2026-08-12");
  assert.equal(ymd(weekStartForBusinessDate(wednesday)), "2026-08-10");
});

test("businessDateWeekRange: lunes-domingo completo alrededor de una fecha cualquiera", () => {
  const { weekStart, weekEnd } = businessDateWeekRange(businessDateFromInput("2026-08-13"));
  assert.equal(ymd(weekStart), "2026-08-10");
  assert.equal(ymd(weekEnd), "2026-08-16");
});

test("Prueba 5 (doc): semana que cruza fin de mes — se agrupa por semana, no se corta por el mes", () => {
  // Viernes 28-ago-2026 a domingo 30-ago pertenecen a la semana del lunes 24;
  // el resto de esa misma semana ya está en septiembre.
  const { weekStart, weekEnd } = businessDateWeekRange(businessDateFromInput("2026-08-28"));
  assert.equal(ymd(weekStart), "2026-08-24");
  assert.equal(ymd(weekEnd), "2026-08-30");
});
