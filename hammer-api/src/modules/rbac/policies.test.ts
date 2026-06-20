import assert from "node:assert/strict";
import test from "node:test";
import { can, CAPABILITIES } from "@/modules/rbac/policies";

test("rbac: BRANCH_ADMIN can complete POS draft and submit flow", () => {
  assert.equal(can("BRANCH_ADMIN", CAPABILITIES.POS_VIEW), true);
  assert.equal(can("BRANCH_ADMIN", CAPABILITIES.POS_SELL), true);
  assert.equal(can("BRANCH_ADMIN", CAPABILITIES.SALES_DRAFT_MANAGE), true);
  assert.equal(can("BRANCH_ADMIN", CAPABILITIES.SALES_SUBMIT_PAYMENT), true);
});
