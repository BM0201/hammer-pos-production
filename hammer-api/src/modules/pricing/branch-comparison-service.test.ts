import assert from "node:assert/strict";
import test from "node:test";
import { branchPriceSpread } from "@/modules/pricing/branch-comparison-service";

test("branchPriceSpread: dispersión entre sucursales, ignora ceros y una sola sucursal", () => {
  assert.deepEqual(branchPriceSpread([100, 112, 105]), { min: 100, max: 112, spreadPercent: 12 });
  assert.equal(branchPriceSpread([100]), null);
  assert.equal(branchPriceSpread([0, 100]), null);
});
