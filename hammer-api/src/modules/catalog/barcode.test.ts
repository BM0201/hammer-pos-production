import assert from "node:assert/strict";
import test from "node:test";
import { normalizeScannedCode, buildInternalBarcode } from "@/modules/catalog/barcode";

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
