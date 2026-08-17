/**
 * prompt-planilla-calendario-quincenas.md §5 — pruebas 1 a 3, sobre las
 * funciones REALES de payroll-calc.ts (sin dependencias de React/Prisma,
 * se puede importar y ejecutar directo bajo `node --import tsx --test`).
 *
 * La prueba 4 original (16 de agosto -> sigue devolviendo 2ª quincena,
 * correcto para el widget de próximo pago) migró junto con el cálculo de
 * fechas al backend — ahora es nextPayday() en
 * hammer-api/src/modules/payroll/payday-calendar.test.ts. Acá solo queda
 * pendingHalf (nunca hizo cálculo de fechas) y buildPaydayInfo, el
 * formateador puro que traduce la respuesta de la API a texto para la UI.
 *
 * Ejecutar: npm run test:unit:logic
 */
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { pendingHalf, buildPaydayInfo, type NextPaydayApiResult } from "@/components/finance/payroll-calc";

describe("Test 1: pendingHalf con FIRST_HALF pendiente (el bug reportado)", () => {
  it("hoy 20 de agosto, FIRST_HALF PENDING -> devuelve 1, no 2", () => {
    const disbursements = [
      { period: "FIRST_HALF" as const, status: "PENDING" },
      { period: "SECOND_HALF" as const, status: "PENDING" },
    ];
    assert.equal(pendingHalf(disbursements), 1);
  });
});

describe("Test 2: pendingHalf con FIRST_HALF ya pagada", () => {
  it("FIRST_HALF PAID, SECOND_HALF PENDING -> devuelve 2", () => {
    const disbursements = [
      { period: "FIRST_HALF" as const, status: "PAID" },
      { period: "SECOND_HALF" as const, status: "PENDING" },
    ];
    assert.equal(pendingHalf(disbursements), 2);
  });
});

describe("Test 3: pendingHalf con las dos pagadas", () => {
  it("ambas PAID -> devuelve null (la pantalla no debe ofrecer pagar)", () => {
    const disbursements = [
      { period: "FIRST_HALF" as const, status: "PAID" },
      { period: "SECOND_HALF" as const, status: "PAID" },
    ];
    assert.equal(pendingHalf(disbursements), null);
  });

  it("sin desembolsos todavía (corrida no posteada) -> null", () => {
    assert.equal(pendingHalf([]), null);
  });
});

describe("buildPaydayInfo formatea la respuesta de /api/payroll/next-payday sin recalcular fechas", () => {
  it("fecha sin ajuste -> adjustedNote null y label con la quincena correcta", () => {
    const raw: NextPaydayApiResult = {
      date: "2026-08-15T18:00:00.000Z",
      nominalDay: 15,
      adjusted: false,
      adjustedReason: null,
      half: 1,
      year: 2026,
      month: 8,
    };
    const info = buildPaydayInfo(raw, new Date("2026-08-01T12:00:00.000Z"));
    assert.equal(info.half, 1);
    assert.equal(info.baseDay, 15);
    assert.equal(info.adjusted, false);
    assert.equal(info.adjustedNote, null);
    assert.match(info.label, /^1ª quincena/);
  });

  it("fecha ajustada por domingo -> adjustedNote explica el corrimiento al sábado", () => {
    const raw: NextPaydayApiResult = {
      date: "2026-08-29T18:00:00.000Z",
      nominalDay: 30,
      adjusted: true,
      adjustedReason: "SUNDAY",
      half: 2,
      year: 2026,
      month: 8,
    };
    const info = buildPaydayInfo(raw, new Date("2026-08-01T12:00:00.000Z"));
    assert.equal(info.adjusted, true);
    assert.match(info.adjustedNote ?? "", /domingo/);
    assert.match(info.adjustedNote ?? "", /29/);
  });

  it("mes corto (SHORT_MONTH) -> adjustedNote explica que el mes no llega a 30", () => {
    const raw: NextPaydayApiResult = {
      date: "2026-02-27T18:00:00.000Z",
      nominalDay: 30,
      adjusted: true,
      adjustedReason: "SHORT_MONTH",
      half: 2,
      year: 2026,
      month: 2,
    };
    const info = buildPaydayInfo(raw, new Date("2026-02-01T12:00:00.000Z"));
    assert.equal(info.adjusted, true);
    assert.match(info.adjustedNote ?? "", /no tiene 30/);
  });
});
