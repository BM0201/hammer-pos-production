import test from "node:test";
import assert from "node:assert/strict";
import { hashPassword, verifyPassword } from "../../src/modules/auth/password";

test("hashPassword returns a non-empty string", () => {
  const hash = hashPassword("TestPassword123!");
  assert.ok(hash.length > 0);
});

test("verifyPassword returns true for correct password", () => {
  const password = "Super#Init2026!";
  const hash = hashPassword(password);
  assert.ok(verifyPassword(password, hash));
});

test("verifyPassword returns false for wrong password", () => {
  const hash = hashPassword("CorrectPassword!");
  assert.equal(verifyPassword("WrongPassword!", hash), false);
});

test("different passwords produce different hashes", () => {
  const hash1 = hashPassword("Password1!");
  const hash2 = hashPassword("Password2!");
  assert.notEqual(hash1, hash2);
});
