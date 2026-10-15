import assert from "node:assert/strict";
import test from "node:test";
import { normalizeScannedCode, buildInternalBarcode, isValidGtinChecksum, expandUpcEToUpcA, checksumWarningForCode } from "@/modules/catalog/barcode";

test("normalizeScannedCode — trim y sin espacios internos", () => {
  assert.equal(normalizeScannedCode("  7501234567890  "), "7501234567890");
  assert.equal(normalizeScannedCode("HMR SKU 0001"), "HMRSKU0001");
  assert.equal(normalizeScannedCode(""), "");
  assert.equal(normalizeScannedCode("   "), "");
});

test("buildInternalBarcode — prefijo HMR- estable, depende solo del sku", () => {
  assert.equal(buildInternalBarcode("MAD-0001"), "HMR-MAD-0001");
  assert.equal(buildInternalBarcode("FER-0042"), "HMR-FER-0042");
});

// ── isValidGtinChecksum / expandUpcEToUpcA — MISMOS vectores que
// hammer-frontend/tests/unit-ts/scanner.test.ts (espejo documentado, Fase 1.1) ──

test("isValidGtinChecksum — EAN-13 real", () => {
  assert.equal(isValidGtinChecksum("4006381333931"), true);
});

test("isValidGtinChecksum — EAN-13 con el verificador alterado, inválido", () => {
  assert.equal(isValidGtinChecksum("4006381333930"), false);
});

test("isValidGtinChecksum — UPC-A real", () => {
  assert.equal(isValidGtinChecksum("036000291452"), true);
});

test("isValidGtinChecksum — UPC-A con el verificador alterado, inválido", () => {
  assert.equal(isValidGtinChecksum("036000291451"), false);
});

test("isValidGtinChecksum — EAN-8 real", () => {
  assert.equal(isValidGtinChecksum("12345670"), true);
});

test("isValidGtinChecksum — largo no-GTIN, inválido", () => {
  assert.equal(isValidGtinChecksum("123456"), false);
});

test("isValidGtinChecksum — con letras, inválido", () => {
  assert.equal(isValidGtinChecksum("400638133393X"), false);
});

test("expandUpcEToUpcA — 6 dígitos, último 0/1/2", () => {
  const expanded = expandUpcEToUpcA("123000");
  assert.equal(isValidGtinChecksum(expanded!), true);
});

test("expandUpcEToUpcA — 6 dígitos, último 3", () => {
  const expanded = expandUpcEToUpcA("123403");
  assert.equal(isValidGtinChecksum(expanded!), true);
});

test("expandUpcEToUpcA — 6 dígitos, último 7 (caso default)", () => {
  const expanded = expandUpcEToUpcA("123457");
  assert.equal(isValidGtinChecksum(expanded!), true);
});

test("expandUpcEToUpcA — 8 dígitos (sistema + verificador incluidos)", () => {
  assert.equal(expandUpcEToUpcA("11230009"), "112000003001");
});

test("expandUpcEToUpcA — sistema inválido (solo 0/1), null", () => {
  assert.equal(expandUpcEToUpcA("21230009"), null);
});

test("expandUpcEToUpcA — largo inválido, null", () => {
  assert.equal(expandUpcEToUpcA("12345"), null);
});

// ── checksumWarningForCode — "aviso, no bloqueo" (Fase 1.1) ──────────────

test("LA QUE IMPORTA — checksumWarningForCode: EAN-13 válido no avisa", () => {
  assert.equal(checksumWarningForCode("4006381333931"), null);
});

test("LA QUE IMPORTA — checksumWarningForCode: EAN-13 con verificador roto SÍ avisa", () => {
  assert.equal(checksumWarningForCode("4006381333930"), "CHECKSUM_INVALID");
});

test("checksumWarningForCode: EAN-8 real y autocontenido no avisa", () => {
  assert.equal(checksumWarningForCode("12345670"), null);
});

test("checksumWarningForCode: 8 dígitos que no cuadra ni como EAN-8 ni como UPC-E expandido, avisa", () => {
  assert.equal(checksumWarningForCode("20003394"), "CHECKSUM_INVALID");
});

test("checksumWarningForCode: UPC-E de 6 dígitos válido no avisa", () => {
  assert.equal(checksumWarningForCode("123000"), null);
});

test("checksumWarningForCode: código con letras (SUPPLIER/QR) nunca avisa — no hay nada que verificar", () => {
  assert.equal(checksumWarningForCode("HMR-FER-0001"), null);
  assert.equal(checksumWarningForCode("ABC123"), null);
});

test("checksumWarningForCode: otro largo numérico (ni 6, 8, 12 ni 13) no avisa", () => {
  assert.equal(checksumWarningForCode("123"), null);
  assert.equal(checksumWarningForCode("123456789012345"), null);
});
