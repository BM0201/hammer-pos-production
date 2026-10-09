import assert from "node:assert/strict";
import test from "node:test";
import { resolvePeriod, splitRangeByManaguaMonth } from "@/modules/finance/periods";

/**
 * prompt-gastos-semana-quincena.md Fase 2.1 — resolvePeriod. Managua es
 * UTC-6 fijo: medianoche Managua del día D = 06:00 UTC del día D.
 */
function managuaMidnight(year: number, month: number, day: number): Date {
  return new Date(Date.UTC(year, month - 1, day, 6, 0, 0, 0));
}

test("DAY — un día cualquiera: start/end son medianoche a medianoche Managua", () => {
  const p = resolvePeriod("DAY", new Date("2026-10-06T15:00:00Z"));
  assert.deepEqual(p.start, managuaMidnight(2026, 10, 6));
  assert.deepEqual(p.end, managuaMidnight(2026, 10, 7));
  assert.equal(p.label, "6 oct 2026");
});

test("DAY — previous/next son el día de antes/después", () => {
  const p = resolvePeriod("DAY", new Date("2026-10-06T15:00:00Z"));
  assert.deepEqual(p.previous.start, managuaMidnight(2026, 10, 5));
  assert.deepEqual(p.next.start, managuaMidnight(2026, 10, 7));
});

test("WEEK — lunes a lunes siguiente, dentro del mismo mes", () => {
  // 2026-10-06 es martes.
  const p = resolvePeriod("WEEK", new Date("2026-10-06T15:00:00Z"));
  assert.deepEqual(p.start, managuaMidnight(2026, 10, 5)); // lunes 5
  assert.deepEqual(p.end, managuaMidnight(2026, 10, 12)); // lunes 12 (exclusivo)
  assert.equal(p.label, "Semana 5–11 oct 2026");
});

test("LA QUE IMPORTA — WEEK que cruza DOS MESES: el label muestra los dos meses", () => {
  // 2026-09-29 es martes; esa semana es lunes 28 sep a domingo 4 oct.
  const p = resolvePeriod("WEEK", new Date("2026-09-29T15:00:00Z"));
  assert.deepEqual(p.start, managuaMidnight(2026, 9, 28));
  assert.deepEqual(p.end, managuaMidnight(2026, 10, 5));
  assert.equal(p.label, "Semana 28 sept – 4 oct 2026"); // Intl "es-NI" abrevia septiembre como "sept", no "sep"
});

test("WEEK — previous/next de una semana que cruza meses siguen siendo semanas de 7 días correctas", () => {
  const p = resolvePeriod("WEEK", new Date("2026-09-29T15:00:00Z"));
  assert.deepEqual(p.previous.start, managuaMidnight(2026, 9, 21));
  assert.deepEqual(p.previous.end, managuaMidnight(2026, 9, 28));
  assert.deepEqual(p.next.start, managuaMidnight(2026, 10, 5));
  assert.deepEqual(p.next.end, managuaMidnight(2026, 10, 12));
});

test("QUINCENA — 1ª quincena (día 1-15)", () => {
  const p = resolvePeriod("QUINCENA", new Date("2026-10-06T15:00:00Z"));
  assert.deepEqual(p.start, managuaMidnight(2026, 10, 1));
  assert.deepEqual(p.end, managuaMidnight(2026, 10, 16));
  assert.equal(p.label, "1ª quincena oct 2026");
});

test("QUINCENA — 2ª quincena, mes de 31 días", () => {
  const p = resolvePeriod("QUINCENA", new Date("2026-10-20T15:00:00Z"));
  assert.deepEqual(p.start, managuaMidnight(2026, 10, 16));
  assert.deepEqual(p.end, managuaMidnight(2026, 11, 1)); // hasta fin de mes (31), exclusivo
  assert.equal(p.label, "2ª quincena oct 2026");
});

test("LA QUE IMPORTA — QUINCENA en FEBRERO (28 días): la 2ª quincena termina el 28, no el 30/31", () => {
  const p = resolvePeriod("QUINCENA", new Date("2026-02-20T15:00:00Z"));
  assert.deepEqual(p.start, managuaMidnight(2026, 2, 16));
  assert.deepEqual(p.end, managuaMidnight(2026, 3, 1));
});

test("LA QUE IMPORTA — QUINCENA previous/next CRUZANDO FEBRERO: nunca aterriza en la mitad equivocada", () => {
  // 1ª quincena de marzo → anterior debe ser la 2ª quincena de FEBRERO (16-28), no caer en la 1ª (1-15).
  const marchFirst = resolvePeriod("QUINCENA", new Date("2026-03-05T15:00:00Z"));
  assert.deepEqual(marchFirst.previous.start, managuaMidnight(2026, 2, 16));
  assert.deepEqual(marchFirst.previous.end, managuaMidnight(2026, 3, 1));
  assert.equal(marchFirst.previous.label, "2ª quincena feb 2026");

  // 2ª quincena de enero → siguiente debe ser la 1ª quincena de FEBRERO (1-15), no la 2ª.
  const januarySecond = resolvePeriod("QUINCENA", new Date("2026-01-20T15:00:00Z"));
  assert.deepEqual(januarySecond.next.start, managuaMidnight(2026, 2, 1));
  assert.deepEqual(januarySecond.next.end, managuaMidnight(2026, 2, 16));
  assert.equal(januarySecond.next.label, "1ª quincena feb 2026");
});

test("QUINCENA — previous/next dentro del MISMO mes (la otra mitad) cuando no hay cruce de mes", () => {
  const first = resolvePeriod("QUINCENA", new Date("2026-10-06T15:00:00Z"));
  assert.deepEqual(first.next.start, managuaMidnight(2026, 10, 16));
  assert.equal(first.next.label, "2ª quincena oct 2026");

  const second = resolvePeriod("QUINCENA", new Date("2026-10-20T15:00:00Z"));
  assert.deepEqual(second.previous.start, managuaMidnight(2026, 10, 1));
  assert.equal(second.previous.label, "1ª quincena oct 2026");
});

test("MONTH — mes completo, hora Managua", () => {
  const p = resolvePeriod("MONTH", new Date("2026-10-06T15:00:00Z"));
  assert.deepEqual(p.start, managuaMidnight(2026, 10, 1));
  assert.deepEqual(p.end, managuaMidnight(2026, 11, 1));
  assert.equal(p.label, "Octubre 2026");
});

test("LA QUE IMPORTA — MONTH cruzando AÑO: diciembre → enero", () => {
  const december = resolvePeriod("MONTH", new Date("2026-12-15T15:00:00Z"));
  assert.deepEqual(december.next.start, managuaMidnight(2027, 1, 1));
  assert.deepEqual(december.next.end, managuaMidnight(2027, 2, 1));
  assert.equal(december.next.label, "Enero 2027");

  const january = resolvePeriod("MONTH", new Date("2027-01-15T15:00:00Z"));
  assert.deepEqual(january.previous.start, managuaMidnight(2026, 12, 1));
  assert.equal(january.previous.label, "Diciembre 2026");
});

test("LA QUE IMPORTA — MONTH hacia/desde FEBRERO: el rango de febrero mismo tiene 28 días, no se cuela un 29/30/31 de más", () => {
  const march = resolvePeriod("MONTH", new Date("2026-03-10T15:00:00Z"));
  assert.deepEqual(march.previous.start, managuaMidnight(2026, 2, 1));
  assert.deepEqual(march.previous.end, managuaMidnight(2026, 3, 1)); // fin de feb = inicio de marzo, 28 días exactos
});

test("CUSTOM — rango a medida, from/to inclusive", () => {
  const p = resolvePeriod("CUSTOM", new Date(), { from: new Date("2026-10-03T12:00:00Z"), to: new Date("2026-10-09T12:00:00Z") });
  assert.deepEqual(p.start, managuaMidnight(2026, 10, 3));
  assert.deepEqual(p.end, managuaMidnight(2026, 10, 10));
});

test("splitRangeByManaguaMonth — rango dentro de un solo mes: un solo segmento", () => {
  const p = resolvePeriod("QUINCENA", new Date("2026-10-06T15:00:00Z"));
  const segments = splitRangeByManaguaMonth(p.start, p.end);
  assert.equal(segments.length, 1);
  assert.equal(segments[0].year, 2026);
  assert.equal(segments[0].month, 10);
  assert.equal(segments[0].daysInSegment, 15);
  assert.equal(segments[0].daysInMonth, 31);
});

test("LA QUE IMPORTA — splitRangeByManaguaMonth — semana que cruza sep/oct: dos segmentos, días correctos de CADA mes", () => {
  const p = resolvePeriod("WEEK", new Date("2026-09-29T15:00:00Z")); // lunes 28 sep a lunes 5 oct (exclusivo)
  const segments = splitRangeByManaguaMonth(p.start, p.end);
  assert.equal(segments.length, 2);
  assert.equal(segments[0].year, 2026);
  assert.equal(segments[0].month, 9);
  assert.equal(segments[0].daysInSegment, 3); // 28, 29, 30
  assert.equal(segments[0].daysInMonth, 30);
  assert.equal(segments[1].year, 2026);
  assert.equal(segments[1].month, 10);
  assert.equal(segments[1].daysInSegment, 4); // 1, 2, 3, 4
  assert.equal(segments[1].daysInMonth, 31);
});

test("resolvePeriod sin anchorDate explícito usa 'ahora' (no revienta)", () => {
  const p = resolvePeriod("MONTH");
  assert.ok(p.start instanceof Date);
  assert.ok(p.end > p.start);
});
