import assert from "node:assert/strict";
import test from "node:test";
import { openingBalanceBulkSchema } from "@/modules/inventory/validators";

const branchId = "clbranchxxxxxxxxxxxxxxxxxxx";
const productA = "clproductxxxxxxxxxxxxxxxxxx";
const productB = "clproductyyyyyyyyyyyyyyyyyy";

test("inventory validators: opening balance bulk rejects empty lines", () => {
  const result = openingBalanceBulkSchema.safeParse({
    branchId,
    mode: "SET_PHYSICAL_STOCK",
    reason: "Carga inicial local",
    lines: [],
  });
  assert.equal(result.success, false);
});

test("inventory validators: opening balance bulk rejects duplicated products", () => {
  const line = {
    productId: productA,
    quantity: 1,
    unitCost: 10,
    costMode: "SET_WAC",
    salePrice: 15,
    priceMode: "SET_BRANCH_PRICE",
  };
  const result = openingBalanceBulkSchema.safeParse({
    branchId,
    mode: "SET_PHYSICAL_STOCK",
    reason: "Carga inicial local",
    lines: [line, line],
  });
  assert.equal(result.success, false);
});

test("inventory validators: opening balance bulk accepts multiple valid lines", () => {
  const result = openingBalanceBulkSchema.safeParse({
    branchId,
    mode: "ADD_OPENING_STOCK",
    reason: "Carga inicial local",
    lines: [
      { productId: productA, quantity: 1, unitCost: 10, costMode: "SET_WAC", salePrice: 15, priceMode: "SET_BRANCH_PRICE" },
      { productId: productB, quantity: 2, costMode: "QUANTITY_ONLY", priceMode: "NO_PRICE_CHANGE" },
    ],
  });
  assert.equal(result.success, true);
});
