import assert from "node:assert/strict";
import test from "node:test";
import { buildNoReceiptAlert } from "@/modules/finance/expense-alerts";
import type { ExpenseLedgerRow } from "@/modules/finance/expense-ledger";

function row(overrides: Partial<ExpenseLedgerRow> = {}): ExpenseLedgerRow {
  return {
    id: "row-1",
    date: new Date("2026-10-08"),
    branchId: "branch-1",
    branchCode: "RIV",
    branchName: "Rivas",
    category: "OTHER",
    conceptId: null,
    conceptName: null,
    description: "arena",
    payee: null,
    receiptNumber: null,
    receiptPhotoUrl: null,
    amount: 5000,
    source: "CAJA",
    registeredBy: null,
    approvedBy: null,
    reference: null,
    ...overrides,
  };
}

test("sin número de recibo ni foto, por encima del umbral → alerta", () => {
  const alert = buildNoReceiptAlert([row()]);
  assert.ok(alert);
  assert.match(alert!.message, /1 gasto sin recibo/);
});

/** prompt-caja-gastos-pos-cobro.md Commit 2 — la foto satisface "tiene recibo" igual que el número. */
test("con foto de recibo (receiptPhotoUrl) no cuenta como 'sin recibo'", () => {
  const alert = buildNoReceiptAlert([row({ receiptPhotoUrl: "https://blob.vercel-storage.com/recibo-1.jpg" })]);
  assert.equal(alert, null);
});

test("con número de recibo tampoco cuenta", () => {
  const alert = buildNoReceiptAlert([row({ receiptNumber: "FAC-001" })]);
  assert.equal(alert, null);
});

test("por debajo del umbral no alerta aunque no tenga recibo", () => {
  const alert = buildNoReceiptAlert([row({ amount: 500 })]);
  assert.equal(alert, null);
});

test("fuente DEVENGADO nunca entra (la planilla no tiene recibo por naturaleza)", () => {
  const alert = buildNoReceiptAlert([row({ source: "DEVENGADO" })]);
  assert.equal(alert, null);
});
