import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { postPaymentSchema } from "../../src/modules/payments/validators";

test("postPaymentSchema requires explicit cashSessionId", () => {
  const parsed = postPaymentSchema.safeParse({
    saleOrderId: "cm00000000000000000000001",
    method: "CASH",
    amount: 10,
  });
  assert.equal(parsed.success, false);

  const ok = postPaymentSchema.safeParse({
    saleOrderId: "cm00000000000000000000001",
    cashSessionId: "cm00000000000000000000002",
    method: "CASH",
    amount: 10,
  });
  assert.equal(ok.success, true);
});

test("cashier payments route maps critical reasons to explicit HTTP statuses", () => {
  const routePath = path.join(process.cwd(), "src/app/api/cashier/payments/route.ts");
  const routeText = fs.readFileSync(routePath, "utf8");

  assert.match(routeText, /INVALID_CASH_SESSION:\s*409/);
  assert.match(routeText, /CASH_SESSION_NOT_OPEN:\s*409/);
  assert.match(routeText, /CASH_BOX_BRANCH_MISMATCH:\s*403/);
  assert.match(routeText, /INVALID_PAYMENT_AMOUNT:\s*400/);
});

test("cashier payments UI disables submit without open cash session", () => {
  const uiPath = path.join(process.cwd(), "src/components/payments/cashier-payments.tsx");
  const uiText = fs.readFileSync(uiPath, "utf8");

  assert.match(uiText, /canSubmitPayment/);
  assert.match(uiText, /disabled=\{!canSubmitPayment\}/);
  assert.match(uiText, /cashSessionId: cashSessionState\.cashSessionId/);
});
