import assert from "node:assert/strict";
import test, { describe } from "node:test";
import { parsePeriodUrlState, periodUrlParams } from "@/lib/finance-period-url";

/** prompt-gastos-semana-quincena.md Fase 3 — navegación de período por URL. */

describe("parsePeriodUrlState", () => {
  test("sin parámetros, cae a MONTH / PAID / sin fecha / sin sucursal", () => {
    const state = parsePeriodUrlState(new URLSearchParams(""));
    assert.deepEqual(state, { kind: "MONTH", date: null, branchId: null, basis: "PAID" });
  });

  test("lee kind/date/branchId/basis de la URL", () => {
    const state = parsePeriodUrlState(new URLSearchParams("kind=WEEK&date=2026-10-09&branchId=b1&basis=ACCRUED"));
    assert.deepEqual(state, { kind: "WEEK", date: "2026-10-09", branchId: "b1", basis: "ACCRUED" });
  });

  test("un kind inválido cae a MONTH en vez de romper", () => {
    const state = parsePeriodUrlState(new URLSearchParams("kind=NOPE"));
    assert.equal(state.kind, "MONTH");
  });

  test("un basis distinto de ACCRUED siempre cae a PAID", () => {
    const state = parsePeriodUrlState(new URLSearchParams("basis=algo-raro"));
    assert.equal(state.basis, "PAID");
  });
});

describe("periodUrlParams", () => {
  test("ida y vuelta: parsear lo que arma periodUrlParams da el mismo estado", () => {
    const original = { kind: "QUINCENA" as const, date: "2026-10-01", branchId: "branch-1", basis: "ACCRUED" as const };
    const roundTripped = parsePeriodUrlState(periodUrlParams(original));
    assert.deepEqual(roundTripped, original);
  });

  test("basis PAID (el default) no se escribe en la URL — queries más cortas", () => {
    const params = periodUrlParams({ kind: "MONTH", date: null, branchId: null, basis: "PAID" });
    assert.equal(params.has("basis"), false);
    assert.equal(params.toString(), "kind=MONTH");
  });
});
