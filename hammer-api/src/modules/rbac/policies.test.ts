import assert from "node:assert/strict";
import test from "node:test";
import { can, CAPABILITIES } from "@/modules/rbac/policies";

test("rbac: BRANCH_ADMIN can complete POS draft and submit flow", () => {
  assert.equal(can("BRANCH_ADMIN", CAPABILITIES.POS_VIEW), true);
  assert.equal(can("BRANCH_ADMIN", CAPABILITIES.POS_SELL), true);
  assert.equal(can("BRANCH_ADMIN", CAPABILITIES.SALES_DRAFT_MANAGE), true);
  assert.equal(can("BRANCH_ADMIN", CAPABILITIES.SALES_SUBMIT_PAYMENT), true);
});

test("rbac: CASHIER can open and operate the shared cash session", () => {
  // La caja física es compartida: el cajero debe poder abrirla, no solo usarla.
  assert.equal(can("CASHIER", CAPABILITIES.CASH_SESSION_OPEN), true);
  assert.equal(can("CASHIER", CAPABILITIES.CASH_SESSION_OPERATE), true);
  assert.equal(can("CASHIER", CAPABILITIES.CASH_SESSION_USE), true);
  assert.equal(can("CASHIER", CAPABILITIES.CASH_SESSION_CLOSE_REQUEST), true);
  // BRANCH_ADMIN y MASTER también pueden abrir.
  assert.equal(can("BRANCH_ADMIN", CAPABILITIES.CASH_SESSION_OPEN), true);
  assert.equal(can("MASTER", CAPABILITIES.CASH_SESSION_OPEN), true);
  // SALES (vendedor puro) NO abre caja.
  assert.equal(can("SALES", CAPABILITIES.CASH_SESSION_OPEN), false);
});
