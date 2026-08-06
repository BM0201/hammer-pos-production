import { test } from "node:test";
import assert from "node:assert/strict";
import {
  encodeBase32,
  decodeBase32,
  generateTotpSecret,
  verifyTotp,
  getCurrentTotp,
  buildOtpauthUri,
  generateRecoveryCodes,
  verifyRecoveryCode,
} from "@/modules/auth/totp";

// ─── Base32 ──────────────────────────────────────────────────────────────────

test("base32: encodeBase32/decodeBase32 roundtrip", () => {
  const original = Buffer.from("Hello, TOTP test!");
  const encoded = encodeBase32(original);
  const decoded = decodeBase32(encoded);
  assert.deepStrictEqual(decoded, original);
});

test("base32: decodeBase32 lanza en caracter inválido", () => {
  assert.throws(() => decodeBase32("INVALID!@#"), /TOTP_INVALID_SECRET/);
});

// ─── Secret generation ────────────────────────────────────────────────────────

test("generateTotpSecret: devuelve string base32 de 32 caracteres (160 bits)", () => {
  const secret = generateTotpSecret();
  assert.match(secret, /^[A-Z2-7]+$/, "debe ser base32 válido");
  assert.ok(secret.length >= 32, "debe tener al menos 32 caracteres para 160 bits");
});

test("generateTotpSecret: dos secretos siempre son distintos", () => {
  const s1 = generateTotpSecret();
  const s2 = generateTotpSecret();
  assert.notStrictEqual(s1, s2);
});

// ─── TOTP verification ────────────────────────────────────────────────────────

test("verifyTotp: el código generado en el momento actual es válido", () => {
  const secret = generateTotpSecret();
  const code = getCurrentTotp(secret);
  assert.ok(verifyTotp(secret, code), "el código actual debe ser válido");
});

test("verifyTotp: rechaza código de 5 dígitos", () => {
  const secret = generateTotpSecret();
  assert.strictEqual(verifyTotp(secret, "12345"), false);
});

test("verifyTotp: rechaza código de 7 dígitos", () => {
  const secret = generateTotpSecret();
  assert.strictEqual(verifyTotp(secret, "1234567"), false);
});

test("verifyTotp: rechaza código incorrecto", () => {
  const secret = generateTotpSecret();
  const code = getCurrentTotp(secret);
  const wrong = code === "000000" ? "111111" : "000000";
  assert.strictEqual(verifyTotp(secret, wrong), false);
});

test("verifyTotp: rechaza código no numérico", () => {
  const secret = generateTotpSecret();
  assert.strictEqual(verifyTotp(secret, "ABCDEF"), false);
});

// ─── OTPAuth URI ─────────────────────────────────────────────────────────────

test("buildOtpauthUri: genera URI otpauth con secret y usuario", () => {
  const secret = "JBSWY3DPEHPK3PXP";
  const uri = buildOtpauthUri({ secret, username: "admin.central" });
  assert.ok(uri.startsWith("otpauth://totp/"), "debe iniciar con otpauth://totp/");
  assert.ok(uri.includes(`secret=${secret}`), "debe incluir el secreto");
  assert.ok(uri.includes("Hammer%20POS"), "debe incluir el issuer codificado");
  assert.ok(uri.includes("admin.central"), "debe incluir el usuario");
});

// ─── Recovery codes ───────────────────────────────────────────────────────────

test("generateRecoveryCodes: genera 8 códigos únicos", () => {
  const { plain, hashed } = generateRecoveryCodes();
  assert.strictEqual(plain.length, 8);
  assert.strictEqual(hashed.length, 8);
  const unique = new Set(plain);
  assert.strictEqual(unique.size, 8, "todos los códigos deben ser únicos");
});

test("generateRecoveryCodes: formato XXXXX-XXXXX", () => {
  const { plain } = generateRecoveryCodes();
  for (const code of plain) {
    assert.match(code, /^[A-Z2-9]{5}-[A-Z2-9]{5}$/, `formato incorrecto: ${code}`);
  }
});

test("verifyRecoveryCode: código válido retorna valid=true y lo elimina", () => {
  const { plain, hashed } = generateRecoveryCodes();
  const result = verifyRecoveryCode(plain[0], hashed);
  assert.strictEqual(result.valid, true);
  assert.strictEqual(result.remainingCodes.length, 7);
});

test("verifyRecoveryCode: código inválido retorna valid=false", () => {
  const { hashed } = generateRecoveryCodes();
  const result = verifyRecoveryCode("XXXXX-YYYYY", hashed);
  assert.strictEqual(result.valid, false);
  assert.strictEqual(result.remainingCodes.length, hashed.length);
});

test("verifyRecoveryCode: ignora guiones y espacios en el código", () => {
  const { plain, hashed } = generateRecoveryCodes();
  const withoutDash = plain[0].replace("-", "");
  const result = verifyRecoveryCode(withoutDash, hashed);
  assert.strictEqual(result.valid, true);
});

test("verifyRecoveryCode: código ya usado no puede verificarse nuevamente", () => {
  const { plain, hashed } = generateRecoveryCodes();
  const first = verifyRecoveryCode(plain[0], hashed);
  assert.strictEqual(first.valid, true);
  // Try again with remaining codes (plain[0] was removed)
  const second = verifyRecoveryCode(plain[0], first.remainingCodes);
  assert.strictEqual(second.valid, false);
});
