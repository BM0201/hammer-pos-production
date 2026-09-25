import { test } from "node:test";
import assert from "node:assert/strict";
import { normalizeThemePreference, buildLoginSuccessBody, buildMfaRequiredBody } from "./login-response";
import type { SessionPayload } from "@/types/auth";

function fakeSession(userId: string): SessionPayload {
  return {
    userId,
    username: "operador",
    globalRoles: [],
    branchMemberships: [],
    primaryBranchId: null,
    roleCode: "BRANCH_ADMIN",
    branchIds: [],
    sessionVersion: 0,
  } as unknown as SessionPayload;
}

test("normalizeThemePreference: acepta light y dark", () => {
  assert.equal(normalizeThemePreference("light"), "light");
  assert.equal(normalizeThemePreference("dark"), "dark");
});

test("normalizeThemePreference: null/undefined/basura se tratan como sin preferencia", () => {
  assert.equal(normalizeThemePreference(null), null);
  assert.equal(normalizeThemePreference(undefined), null);
  assert.equal(normalizeThemePreference(""), null);
  assert.equal(normalizeThemePreference("SYSTEM"), null);
});

test("buildLoginSuccessBody: incluye userId y themePreference", () => {
  const body = buildLoginSuccessBody({
    role: "MASTER",
    mustChangePassword: false,
    fullName: "Ana Pérez",
    session: fakeSession("user-123"),
    themePreference: "dark",
  });
  assert.equal(body.userId, "user-123");
  assert.equal(body.themePreference, "dark");
  assert.equal(body.fullName, "Ana Pérez");
  assert.equal(body.mustChangePassword, false);
});

test("buildLoginSuccessBody: mustChangePassword redirige a change-password sin importar el rol", () => {
  const body = buildLoginSuccessBody({
    role: "MASTER",
    mustChangePassword: true,
    fullName: "Ana Pérez",
    session: fakeSession("user-123"),
    themePreference: null,
  });
  assert.equal(body.redirectTo, "/app/change-password");
  assert.equal(body.themePreference, null);
});

test("buildMfaRequiredBody: NO expone userId ni themePreference", () => {
  const body = buildMfaRequiredBody("pending-token", "Ana Pérez");
  assert.equal(body.mfaRequired, true);
  assert.equal(body.pendingToken, "pending-token");
  assert.equal(body.fullName, "Ana Pérez");
  assert.ok(!("userId" in body), "el paso mfaRequired no debe traer userId");
  assert.ok(!("themePreference" in body), "el paso mfaRequired no debe traer themePreference");
});
