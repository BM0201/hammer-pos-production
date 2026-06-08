import assert from "node:assert/strict";
import test from "node:test";
import { saleOrderDirectSaleSchema, saleOrderTransportSchema } from "@/modules/sales/validators";

test("sales: requiresTransport=true requires positive transportAmount on submit", () => {
  const result = saleOrderTransportSchema.safeParse({ requiresTransport: true });
  assert.equal(result.success, false);
  if (!result.success) {
    assert.equal(result.error.issues[0]?.message, "TRANSPORT_AMOUNT_REQUIRED");
  }
});

test("sales: requiresTransport=true requires positive transportAmount on direct sale", () => {
  const result = saleOrderDirectSaleSchema.safeParse({
    cashSessionId: "clxxxxxxxxxxxxxxxxxxxxxxxxx",
    requiresTransport: true,
    transportAmount: 0,
  });
  assert.equal(result.success, false);
  if (!result.success) {
    assert.equal(result.error.issues[0]?.message, "TRANSPORT_AMOUNT_REQUIRED");
  }
});

test("sales: requiresTransport=false allows missing transportAmount", () => {
  const result = saleOrderTransportSchema.safeParse({ requiresTransport: false });
  assert.equal(result.success, true);
});
