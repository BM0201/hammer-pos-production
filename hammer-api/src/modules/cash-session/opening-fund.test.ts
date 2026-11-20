import assert from "node:assert/strict";
import test from "node:test";
import { pickOpeningCashFund } from "@/modules/cash-session/opening-fund";

const declaration = { retainCashFundPortion: "678", notes: "Sencillo: 20 × C$10", createdAt: new Date("2026-11-19T23:00:00Z") };

test("abre con el sencillo del último cierre si Master no lo fijó después", () => {
  const fund = pickOpeningCashFund(declaration, { cashFundAmount: "400", cashFundSetAt: null });
  assert.deepEqual(fund, { amount: 678, note: "Sencillo: 20 × C$10", declaredAt: "2026-11-19T23:00:00.000Z", setByMaster: false });
  // Master lo fijó ANTES del cierre: manda el cierre contado.
  assert.equal(pickOpeningCashFund(declaration, { cashFundAmount: "400", cashFundSetAt: new Date("2026-11-19T12:00:00Z") })?.setByMaster, false);
});

test("abre con el sencillo de Master si lo fijó después del último cierre o no hay cierres", () => {
  const after = pickOpeningCashFund(declaration, { cashFundAmount: "550", cashFundSetAt: new Date("2026-11-20T15:00:00Z") });
  assert.deepEqual(after, { amount: 550, note: null, declaredAt: "2026-11-20T15:00:00.000Z", setByMaster: true });
  assert.equal(pickOpeningCashFund(null, { cashFundAmount: "550", cashFundSetAt: new Date("2026-11-20T15:00:00Z") })?.amount, 550);
});

test("sin cierre declarado ni sencillo fijado por Master no propone nada", () => {
  assert.equal(pickOpeningCashFund(null, { cashFundAmount: "400", cashFundSetAt: null }), null);
  assert.equal(pickOpeningCashFund(null, null), null);
});
