import assert from "node:assert/strict";
import test from "node:test";
import { weekStartForBusinessDate, businessDateWeekRange, businessDateFromInput, nextBusinessDayFrom } from "@/modules/operations/business-date";

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

/**
 * Parte A (prompt-corregir-siguiente-dia-y-desplegar.md) — nextBusinessDayFrom
 * usaba el criterio lunes-viernes de countBusinessDaysBetween
 * (treasury/exposure.ts), que mide días con el banco abierto, no días en
 * que la sucursal opera. Una posposición declarada el viernes prometía
 * "hasta el lunes" mientras la sucursal vendía sábado y domingo. Ahora es
 * siempre +1 día calendario, sin filtro de día de semana.
 *
 * 18:00 UTC = 12:00 mediodía en America/Managua (UTC-6 fijo, sin horario de
 * verano) — bien adentro del mismo día calendario sin importar la hora de
 * corte del día de negocio (medianoche por defecto).
 */
function managuaNoonOn(isoDate: string): Date {
  const [year, month, day] = isoDate.split("-").map(Number);
  return new Date(Date.UTC(year, month - 1, day, 18, 0, 0, 0));
}

test("nextBusinessDayFrom: un viernes devuelve sábado (2026-08-14 → 2026-08-15)", () => {
  assert.equal(ymd(nextBusinessDayFrom(managuaNoonOn("2026-08-14"))), "2026-08-15");
});

test("nextBusinessDayFrom: un sábado devuelve domingo (2026-08-15 → 2026-08-16)", () => {
  assert.equal(ymd(nextBusinessDayFrom(managuaNoonOn("2026-08-15"))), "2026-08-16");
});

test("nextBusinessDayFrom: un domingo devuelve lunes (2026-08-16 → 2026-08-17)", () => {
  assert.equal(ymd(nextBusinessDayFrom(managuaNoonOn("2026-08-16"))), "2026-08-17");
});
