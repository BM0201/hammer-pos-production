/**
 * ════════════════════════════════════════════════════════════════
 * EFFECTIVE PERMISSIONS — Unit Tests
 * ════════════════════════════════════════════════════════════════
 */
import assert from "node:assert/strict";
import test from "node:test";
import type { RoleCode } from "@prisma/client";
import type { SessionPayload } from "@/types/auth";
import {
  canUseBranchRole,
  canUseBranchCapability,
  requireEffectiveBranchCapability,
  getBranchIdsWithEffectiveCapability,
} from "@/modules/rbac/effective-permissions";
import { CAPABILITIES } from "@/modules/rbac/policies";

/* ── Helper: build a session ── */
function makeSession(overrides: Partial<SessionPayload> = {}): SessionPayload {
  return {
    userId: "u1",
    username: "test",
    globalRoles: [],
    branchMemberships: [{ branchId: "b1", roleCode: "SALES" }],
    primaryBranchId: "b1",
    roleCode: "SALES",
    branchIds: ["b1"],
    sessionVersion: 0,
    exp: 9999999999,
    ...overrides,
  };
}

// ─── canUseBranchRole ───────────────────────────────────────────

test("canUseBranchRole: returns false for null session", () => {
  assert.equal(canUseBranchRole(null, "b1", "SALES"), false);
});

test("canUseBranchRole: global SYSTEM_ADMIN always returns true", () => {
  const s = makeSession({
    globalRoles: ["SYSTEM_ADMIN" as RoleCode],
    branchMemberships: [],
  });
  assert.equal(canUseBranchRole(s, "any-branch", "CASHIER"), true);
});

test("canUseBranchRole: branch user can use own role in own branch", () => {
  const s = makeSession();
  assert.equal(canUseBranchRole(s, "b1", "SALES"), true);
});

test("canUseBranchRole: branch user cannot use role in other branch", () => {
  const s = makeSession();
  assert.equal(canUseBranchRole(s, "b2", "SALES"), false);
});

test("canUseBranchRole: branch user cannot use a role they don't have", () => {
  const s = makeSession();
  assert.equal(canUseBranchRole(s, "b1", "CASHIER"), false);
});

// ─── canUseBranchCapability ─────────────────────────────────────

test("canUseBranchCapability: null session returns false", () => {
  assert.equal(canUseBranchCapability(null, "b1", CAPABILITIES.SALES_VIEW), false);
});

test("canUseBranchCapability: SALES role has SALES_VIEW", () => {
  const s = makeSession();
  assert.equal(canUseBranchCapability(s, "b1", CAPABILITIES.SALES_VIEW), true);
});

test("canUseBranchCapability: SALES role does NOT have DISPATCH_MARK", () => {
  const s = makeSession();
  assert.equal(canUseBranchCapability(s, "b1", CAPABILITIES.DISPATCH_MARK), false);
});

test("canUseBranchCapability: SYSTEM_ADMIN has any capability", () => {
  const s = makeSession({
    globalRoles: ["SYSTEM_ADMIN" as RoleCode],
    branchMemberships: [],
  });
  assert.equal(canUseBranchCapability(s, "b1", CAPABILITIES.DISPATCH_MARK), true);
});

test("canUseBranchCapability: wrong branch returns false", () => {
  const s = makeSession();
  assert.equal(canUseBranchCapability(s, "b-other", CAPABILITIES.SALES_VIEW), false);
});

// ─── requireEffectiveBranchCapability ───────────────────────────

test("requireEffectiveBranchCapability: throws for missing capability", () => {
  const s = makeSession();
  assert.throws(
    () => requireEffectiveBranchCapability(s, "b1", CAPABILITIES.DISPATCH_MARK),
    /FORBIDDEN_CAPABILITY/,
  );
});

test("requireEffectiveBranchCapability: does not throw for valid capability", () => {
  const s = makeSession();
  assert.doesNotThrow(() =>
    requireEffectiveBranchCapability(s, "b1", CAPABILITIES.SALES_DRAFT_MANAGE),
  );
});

// ─── getBranchIdsWithEffectiveCapability ─────────────────────────

test("getBranchIdsWithEffectiveCapability: returns matching branches", () => {
  const s = makeSession({
    branchMemberships: [
      { branchId: "b1", roleCode: "SALES" },
      { branchId: "b2", roleCode: "WAREHOUSE" },
    ],
  });
  const result = getBranchIdsWithEffectiveCapability(s, CAPABILITIES.SALES_VIEW);
  assert.deepEqual(result, ["b1"]);
});

test("getBranchIdsWithEffectiveCapability: returns empty for global admin (no filter)", () => {
  const s = makeSession({ globalRoles: ["SYSTEM_ADMIN" as RoleCode] });
  const result = getBranchIdsWithEffectiveCapability(s, CAPABILITIES.SALES_VIEW);
  assert.deepEqual(result, []);
});

test("getBranchIdsWithEffectiveCapability: returns empty for null session", () => {
  assert.deepEqual(getBranchIdsWithEffectiveCapability(null, CAPABILITIES.SALES_VIEW), []);
});
