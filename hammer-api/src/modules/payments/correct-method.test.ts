import assert from "node:assert/strict";
import test from "node:test";
import { assertTenderCorrectable } from "@/modules/payments/correct-method";

const ok = { method: "TRANSFER" as const, referenceNumber: "REF-77", bankAccountId: "acc-1", reason: "Se cobró como efectivo y fue transferencia" };
const cash = { method: "CASH", receivedUsdAmount: null };
const posted = { status: "POSTED" };

test("efectivo posteado → transferencia con cuenta y referencia: se puede", () => {
  assert.doesNotThrow(() => assertTenderCorrectable(cash, posted, "PAID", ok));
});

test("tarjeta no pide cuenta", () => {
  assert.doesNotThrow(() => assertTenderCorrectable(cash, posted, "PAID", { ...ok, method: "CARD", bankAccountId: null }));
});

test("no corrige lo que no es efectivo, ni dólares, ni ventas anuladas o pagos sin postear", () => {
  assert.throws(() => assertTenderCorrectable({ method: "CARD" }, posted, "PAID", ok), /TENDER_NOT_CASH/);
  assert.throws(() => assertTenderCorrectable({ method: "CASH", receivedUsdAmount: 40 }, posted, "PAID", ok), /TENDER_IS_USD/);
  assert.throws(() => assertTenderCorrectable(cash, posted, "CANCELLED", ok), /SALE_ORDER_CANCELLED/);
  assert.throws(() => assertTenderCorrectable(cash, { status: "VOIDED" }, "PAID", ok), /PAYMENT_NOT_POSTED/);
});

test("un día ya confirmado no se corrige por debajo", () => {
  assert.throws(() => assertTenderCorrectable(cash, posted, "PAID", ok, true), /OPERATIONAL_DAY_ALREADY_CONFIRMED/);
});

test("exige referencia, cuenta (transferencia) y motivo", () => {
  assert.throws(() => assertTenderCorrectable(cash, posted, "PAID", { ...ok, referenceNumber: " " }), /PAYMENT_REFERENCE_REQUIRED/);
  assert.throws(() => assertTenderCorrectable(cash, posted, "PAID", { ...ok, bankAccountId: null }), /PAYMENT_BANK_ACCOUNT_REQUIRED/);
  assert.throws(() => assertTenderCorrectable(cash, posted, "PAID", { ...ok, reason: "" }), /CORRECTION_REASON_REQUIRED/);
});
