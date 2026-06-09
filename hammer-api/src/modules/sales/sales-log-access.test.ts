import assert from "node:assert/strict";
import test from "node:test";
import type { RoleCode } from "@prisma/client";
import type { SessionPayload } from "@/types/auth";
import { assertCanViewSaleInBranch, resolveBranchSalesLogAccess } from "@/modules/sales/sales-log-access";

function session(overrides: Partial<SessionPayload> = {}): SessionPayload {
  return {
    userId: "user-1",
    username: "user",
    globalRoles: [],
    branchMemberships: [{ branchId: "branch-a", roleCode: "CASHIER" }],
    primaryBranchId: "branch-a",
    roleCode: "CASHIER",
    branchIds: ["branch-a"],
    sessionVersion: 0,
    exp: 9999999999,
    ...overrides,
  };
}

test("cashier can view the sales log of their own branch", () => {
  const access = resolveBranchSalesLogAccess({ session: session(), requestedBranchId: "branch-a" });
  assert.equal(access.branchId, "branch-a");
});

test("branchId defaults to the primary branch when not provided", () => {
  const access = resolveBranchSalesLogAccess({ session: session() });
  assert.equal(access.branchId, "branch-a");
});

test("cashier cannot view the sales log of another branch (FORBIDDEN_BRANCH)", () => {
  assert.throws(
    () => resolveBranchSalesLogAccess({ session: session(), requestedBranchId: "branch-b" }),
    /FORBIDDEN_BRANCH/,
  );
});

test("sales role (has SALES_HISTORY_VIEW) can view the sales log of their branch", () => {
  const access = resolveBranchSalesLogAccess({
    session: session({
      branchMemberships: [{ branchId: "branch-a", roleCode: "SALES" }],
      roleCode: "SALES",
    }),
    requestedBranchId: "branch-a",
  });
  assert.equal(access.branchId, "branch-a");
});

test("warehouse role (no sales-log capability) is forbidden by capability", () => {
  assert.throws(
    () => resolveBranchSalesLogAccess({
      session: session({
        branchMemberships: [{ branchId: "branch-a", roleCode: "WAREHOUSE" }],
        roleCode: "WAREHOUSE",
      }),
      requestedBranchId: "branch-a",
    }),
    /FORBIDDEN_CAPABILITY/,
  );
});

test("user with no assigned branch is forbidden", () => {
  assert.throws(
    () => resolveBranchSalesLogAccess({
      session: session({ branchMemberships: [], branchIds: [], primaryBranchId: null }),
    }),
    /FORBIDDEN_BRANCH/,
  );
});

test("privileged global role can view any branch sales log", () => {
  const access = resolveBranchSalesLogAccess({
    session: session({
      globalRoles: ["MASTER" as RoleCode],
      branchMemberships: [],
      branchIds: [],
      primaryBranchId: null,
      roleCode: "MASTER",
    }),
    requestedBranchId: "branch-z",
  });
  assert.equal(access.branchId, "branch-z");
});

test("assertCanViewSaleInBranch blocks a sale from another branch", () => {
  assert.throws(() => assertCanViewSaleInBranch(session(), "branch-b"), /FORBIDDEN_BRANCH/);
});

test("assertCanViewSaleInBranch allows a sale from the user's branch", () => {
  assert.doesNotThrow(() => assertCanViewSaleInBranch(session(), "branch-a"));
});

test("assertCanViewSaleInBranch allows privileged global for any sale", () => {
  assert.doesNotThrow(() =>
    assertCanViewSaleInBranch(
      session({ globalRoles: ["OWNER" as RoleCode], roleCode: "OWNER", branchMemberships: [] }),
      "branch-x",
    ),
  );
});
