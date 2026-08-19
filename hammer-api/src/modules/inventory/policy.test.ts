import assert from "node:assert/strict";
import test from "node:test";
import { canExecuteDirectStockAdjustment, canRequestStockAdjustment } from "@/modules/inventory/policy";

test("inventory policy: BRANCH_ADMIN requests stock adjustments but does not execute direct adjustments", () => {
  assert.equal(canRequestStockAdjustment("BRANCH_ADMIN"), true);
  assert.equal(canExecuteDirectStockAdjustment("BRANCH_ADMIN"), false);
});

test("inventory policy: master roles can execute direct stock adjustments", () => {
  assert.equal(canExecuteDirectStockAdjustment("MASTER"), true);
  assert.equal(canExecuteDirectStockAdjustment("OWNER"), true);
  assert.equal(canExecuteDirectStockAdjustment("SYSTEM_ADMIN"), true);
});
