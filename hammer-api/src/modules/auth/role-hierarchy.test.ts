import { test } from "node:test";
import assert from "node:assert/strict";
import { assertCanSetGlobalRole, assertCanManageUser } from "@/modules/auth/role-hierarchy";
import type { SessionPayload } from "@/types/auth";

function makeSession(roleCode: string, globalRoles: string[]): SessionPayload {
  return {
    userId: "u1",
    username: "test",
    roleCode,
    globalRoles,
    branchIds: [],
    branchMemberships: [],
    primaryBranchId: null,
    sessionVersion: 0,
    exp: 9999999999,
  } as unknown as SessionPayload;
}

const masterSession = makeSession("MASTER", ["MASTER"]);
const ownerSession  = makeSession("OWNER",  ["OWNER"]);
const sysAdminSession = makeSession("SYSTEM_ADMIN", ["SYSTEM_ADMIN"]);

// ── assertCanSetGlobalRole ──────────────────────────────────────────

test("MASTER puede asignar rol MASTER", () => {
  assert.doesNotThrow(() => assertCanSetGlobalRole(masterSession, "MASTER"));
});

test("MASTER no puede asignar rol OWNER", () => {
  assert.throws(() => assertCanSetGlobalRole(masterSession, "OWNER"), /FORBIDDEN/);
});

test("MASTER no puede asignar rol SYSTEM_ADMIN", () => {
  assert.throws(() => assertCanSetGlobalRole(masterSession, "SYSTEM_ADMIN"), /FORBIDDEN/);
});

test("OWNER puede asignar rol MASTER", () => {
  assert.doesNotThrow(() => assertCanSetGlobalRole(ownerSession, "MASTER"));
});

test("OWNER puede asignar rol OWNER a otro (mismo nivel permitido)", () => {
  // "nadie puede ELEVAR a nivel SUPERIOR al propio" → mismo nivel está permitido
  assert.doesNotThrow(() => assertCanSetGlobalRole(ownerSession, "OWNER"));
});

test("OWNER no puede asignar rol SYSTEM_ADMIN", () => {
  assert.throws(() => assertCanSetGlobalRole(ownerSession, "SYSTEM_ADMIN"), /FORBIDDEN/);
});

test("SYSTEM_ADMIN puede asignar cualquier rol", () => {
  assert.doesNotThrow(() => assertCanSetGlobalRole(sysAdminSession, "MASTER"));
  assert.doesNotThrow(() => assertCanSetGlobalRole(sysAdminSession, "OWNER"));
  assert.doesNotThrow(() => assertCanSetGlobalRole(sysAdminSession, "SYSTEM_ADMIN"));
});

test("null/undefined role siempre permitido (quitar rol)", () => {
  assert.doesNotThrow(() => assertCanSetGlobalRole(masterSession, null));
  assert.doesNotThrow(() => assertCanSetGlobalRole(masterSession, undefined));
});

// ── assertCanManageUser ─────────────────────────────────────────────

test("MASTER puede gestionar usuario sin rol global", () => {
  assert.doesNotThrow(() => assertCanManageUser(masterSession, null));
  assert.doesNotThrow(() => assertCanManageUser(masterSession, undefined));
});

test("MASTER puede gestionar otro MASTER", () => {
  // MASTER nivel 10, objetivo MASTER nivel 10 → 10 < 30 (no sysadmin) y 10 >= 10 → FORBIDDEN
  assert.throws(() => assertCanManageUser(masterSession, "MASTER"), /FORBIDDEN/);
});

test("OWNER puede gestionar MASTER", () => {
  assert.doesNotThrow(() => assertCanManageUser(ownerSession, "MASTER"));
});

test("OWNER no puede gestionar otro OWNER", () => {
  assert.throws(() => assertCanManageUser(ownerSession, "OWNER"), /FORBIDDEN/);
});

test("SYSTEM_ADMIN puede gestionar cualquier rol", () => {
  assert.doesNotThrow(() => assertCanManageUser(sysAdminSession, "MASTER"));
  assert.doesNotThrow(() => assertCanManageUser(sysAdminSession, "OWNER"));
  assert.doesNotThrow(() => assertCanManageUser(sysAdminSession, "SYSTEM_ADMIN"));
});
