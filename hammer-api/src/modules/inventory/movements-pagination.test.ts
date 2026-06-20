import assert from "node:assert/strict";
import test from "node:test";
import { clampInventoryMovementPagination } from "@/modules/inventory/service";

test("inventory movements pagination returns page 1 offset", () => {
  assert.deepEqual(clampInventoryMovementPagination({ page: 1, limit: 30 }), {
    page: 1,
    limit: 30,
    skip: 0,
  });
});

test("inventory movements pagination returns page 2 offset", () => {
  assert.deepEqual(clampInventoryMovementPagination({ page: 2, limit: 30 }), {
    page: 2,
    limit: 30,
    skip: 30,
  });
});

test("inventory movements pagination clamps invalid values and caps limit", () => {
  assert.deepEqual(clampInventoryMovementPagination({ page: -5, limit: 500 }), {
    page: 1,
    limit: 100,
    skip: 0,
  });
});
