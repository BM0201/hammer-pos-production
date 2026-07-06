/**
 * ════════════════════════════════════════════════════════════════
 * PASSWORD HASHING — Unit Tests
 *
 * Cubre el formato actual (Argon2id) y la compatibilidad hacia atrás
 * con el formato legado (PBKDF2-SHA512), incluida la señal de re-hash
 * perezoso que usa authenticate().
 * ════════════════════════════════════════════════════════════════
 */
import assert from "node:assert/strict";
import test from "node:test";
import {
  hashPassword,
  hashPasswordLegacyPbkdf2,
  verifyPassword,
  needsRehash,
} from "@/modules/auth/password";

// ─── Argon2id (formato actual) ──────────────────────────────────

test("hashPassword produce un hash PHC Argon2id", () => {
  const hash = hashPassword("Secreta#2026");
  assert.ok(hash.startsWith("$argon2id$"), `formato inesperado: ${hash.slice(0, 20)}...`);
});

test("verifyPassword acepta la contraseña correcta con Argon2id", () => {
  const hash = hashPassword("Secreta#2026");
  assert.equal(verifyPassword("Secreta#2026", hash), true);
});

test("verifyPassword rechaza contraseña incorrecta con Argon2id", () => {
  const hash = hashPassword("Secreta#2026");
  assert.equal(verifyPassword("otra-clave", hash), false);
});

test("dos hashes Argon2id de la misma contraseña difieren (salt aleatorio)", () => {
  assert.notEqual(hashPassword("misma"), hashPassword("misma"));
});

// ─── PBKDF2 (formato legado) ────────────────────────────────────

test("verifyPassword sigue aceptando hashes legados PBKDF2", () => {
  const legacy = hashPasswordLegacyPbkdf2("ClaveVieja#1");
  assert.ok(legacy.startsWith("pbkdf2$"));
  assert.equal(verifyPassword("ClaveVieja#1", legacy), true);
});

test("verifyPassword rechaza contraseña incorrecta con hash legado", () => {
  const legacy = hashPasswordLegacyPbkdf2("ClaveVieja#1");
  assert.equal(verifyPassword("intruso", legacy), false);
});

test("verifyPassword rechaza hashes malformados sin lanzar", () => {
  assert.equal(verifyPassword("x", "no-es-un-hash"), false);
  assert.equal(verifyPassword("x", "pbkdf2$abc$sha512$$"), false);
  assert.equal(verifyPassword("x", "$argon2id$basura"), false);
  assert.equal(verifyPassword("x", ""), false);
});

// ─── needsRehash (migración perezosa) ───────────────────────────

test("needsRehash: true para PBKDF2, false para Argon2id", () => {
  assert.equal(needsRehash(hashPasswordLegacyPbkdf2("a")), true);
  assert.equal(needsRehash(hashPassword("a")), false);
});
