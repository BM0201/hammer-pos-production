import assert from "node:assert/strict";
import test from "node:test";
import { timberTripAccount } from "@/modules/timber/service";

test("cuenta del viaje: madera − adelantos − abonos − otros abonos − restas = lo que falta pagar", () => {
  const account = timberTripAccount(562074.5, [
    { kind: "ADELANTO", amount: 100000 },
    { kind: "ABONO", amount: 250000.25 },
    { kind: "OTRO_ABONO", amount: 20000 }, // otro negocio que cuenta como abono
    { kind: "RESTA", amount: 12500 }, // madera mala o faltante
  ]);
  assert.deepEqual(account, { woodTotal: 562074.5, paid: 370000.25, deductions: 12500, balance: 179574.25 });
});

test("cuenta del viaje: si se le pagó de más, el saldo queda negativo (a favor)", () => {
  assert.equal(timberTripAccount(1000, [{ kind: "ABONO", amount: 1200 }]).balance, -200);
});

test("cuenta del viaje: sin movimientos se debe todo", () => {
  assert.deepEqual(timberTripAccount(1000, []), { woodTotal: 1000, paid: 0, deductions: 0, balance: 1000 });
});
