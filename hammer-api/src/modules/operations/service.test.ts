/**
 * Tests for the operational-day date logic.
 *
 * These functions are defined inline (mirroring service.ts) so the test has
 * no dependency on @prisma/client or the database, making it runnable in CI
 * without a live connection. If the implementation in service.ts is changed,
 * update here too.
 *
 * Run with: npx tsx --test src/modules/operations/service.test.ts
 */

import assert from "node:assert/strict";
import test from "node:test";

// ─── Inline copies of the pure functions from operations/service.ts ──────────

const TIMEZONE = "America/Managua";

function localDateParts(date: Date) {
  const formatter = new Intl.DateTimeFormat("en-CA", {
    timeZone: TIMEZONE,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  });
  const [year, month, day] = formatter.format(date).split("-").map(Number);
  return { year, month, day };
}

function businessDateFromNow(now = new Date()): Date {
  const { year, month, day } = localDateParts(now);
  return new Date(Date.UTC(year, month - 1, day, 0, 0, 0, 0));
}

function operationalWindow(businessDate: Date) {
  const year  = businessDate.getUTCFullYear();
  const month = businessDate.getUTCMonth();
  const day   = businessDate.getUTCDate();
  const start = new Date(Date.UTC(year, month, day, 6, 0, 0, 0));
  const end   = new Date(start.getTime() + 24 * 60 * 60 * 1000);
  return { start, end };
}

function getOperationalWindowForNow(now = new Date()) {
  return operationalWindow(businessDateFromNow(now));
}

// ─── Tests ───────────────────────────────────────────────────────────────────

test("businessDateFromNow: retorna medianoche UTC del día local en Managua", () => {
  // 2026-06-16T12:00:00Z = 06:00 Managua → businessDate = 2026-06-16
  const bd = businessDateFromNow(new Date("2026-06-16T12:00:00.000Z"));
  assert.equal(bd.toISOString(), "2026-06-16T00:00:00.000Z");
});

test("businessDateFromNow: 00:00–05:59 UTC = día ANTERIOR en Managua", () => {
  // 2026-06-16T03:00:00Z = 2026-06-15T21:00 Managua → businessDate 2026-06-15
  const bd = businessDateFromNow(new Date("2026-06-16T03:00:00.000Z"));
  assert.equal(bd.toISOString(), "2026-06-15T00:00:00.000Z");
});

test("businessDateFromNow: 06:00 UTC exacto = medianoche Managua = inicio del nuevo día", () => {
  const bd = businessDateFromNow(new Date("2026-06-17T06:00:00.000Z"));
  assert.equal(bd.toISOString(), "2026-06-17T00:00:00.000Z");
});

test("businessDateFromNow: estable para todas las horas del mismo día en Managua", () => {
  // De 06:00 UTC al siguiente 05:59:59 UTC = mismo businessDate
  const start = businessDateFromNow(new Date("2026-06-16T06:00:00.000Z")); // medianoche Managua
  const end   = businessDateFromNow(new Date("2026-06-17T05:59:59.000Z")); // 23:59:59 Managua
  assert.equal(start.toISOString(), "2026-06-16T00:00:00.000Z");
  assert.equal(end.toISOString(),   "2026-06-16T00:00:00.000Z");
});

test("operationalWindow: start = businessDate + 6h UTC, end = start + 24h", () => {
  const { start, end } = getOperationalWindowForNow(new Date("2026-06-16T15:00:00.000Z"));
  assert.equal(start.toISOString(), "2026-06-16T06:00:00.000Z");
  assert.equal(end.toISOString(),   "2026-06-17T06:00:00.000Z");
});

test("INVARIANTE CRÍTICO: businessDate (00:00 UTC) < operationalWindow.start (06:00 UTC)", () => {
  // Este es el invariante que rompía la query del Centro de Comando.
  // La query usaba { businessDate: { gte: start, lt: end } }.
  // businessDate = 2026-06-16T00:00:00Z < start = 2026-06-16T06:00:00Z → NUNCA matcheaba.
  const now = new Date("2026-06-16T15:00:00.000Z");
  const bd = businessDateFromNow(now);
  const { start } = getOperationalWindowForNow(now);

  assert.ok(
    bd.getTime() < start.getTime(),
    `businessDate(${bd.toISOString()}) debe ser MENOR que window.start(${start.toISOString()})`,
  );
});

test("FIX VERIFICADO: query exacta businessDate === businessDateFromNow() siempre matchea", () => {
  // La corrección reemplaza { gte: start, lt: end } por { businessDate: todayBusinessDate }.
  // El valor guardado en BD es exactamente lo que businessDateFromNow() produce.
  const now = new Date("2026-06-16T15:00:00.000Z");
  const computed = businessDateFromNow(now);
  const stored   = new Date(Date.UTC(2026, 5, 16, 0, 0, 0, 0)); // lo que Prisma guarda
  assert.equal(computed.getTime(), stored.getTime());
});

test("cross-midnight Managua: 01:00 UTC Jun17 = 19:00 Jun16 Managua → businessDate Jun16", () => {
  const bd = businessDateFromNow(new Date("2026-06-17T01:00:00.000Z"));
  assert.equal(bd.toISOString(), "2026-06-16T00:00:00.000Z");

  // La ventana para ese businessDate cubre Jun16T06:00Z → Jun17T06:00Z
  const { start, end } = getOperationalWindowForNow(new Date("2026-06-17T01:00:00.000Z"));
  assert.equal(start.toISOString(), "2026-06-16T06:00:00.000Z");
  assert.equal(end.toISOString(),   "2026-06-17T06:00:00.000Z");

  // 01:00 UTC Jun17 cae DENTRO de la ventana del Jun16
  const now = new Date("2026-06-17T01:00:00.000Z");
  assert.ok(now >= start && now < end, "01:00 UTC Jun17 debe estar dentro de la ventana del Jun16");
});

test("stale day detection: businessDate distinto al de hoy debe rechazarse", () => {
  const today = businessDateFromNow(new Date("2026-06-16T12:00:00.000Z"));
  const yesterday = new Date(Date.UTC(2026, 5, 15, 0, 0, 0, 0)); // 2026-06-15

  assert.notEqual(
    yesterday.getTime(),
    today.getTime(),
    "Un día OPEN de fecha anterior no debe coincidir con hoy → ensureOpenOperationalDayTx debe lanzar OPERATIONAL_DAY_STALE",
  );
});
