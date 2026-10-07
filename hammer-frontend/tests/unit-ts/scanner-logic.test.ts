import assert from "node:assert/strict";
import test from "node:test";
import { normalizeScannedCode, shouldIgnoreRepeatedCode, SCAN_REPEAT_DEBOUNCE_MS } from "@/lib/scanner";

/**
 * prompt-alta-productos-qr.md — lib/scanner.ts es ahora el dueño canónico
 * del normalizador y el debounce (antes vivían duplicados/documentados
 * como "espejo" en quick-add-product.ts, que ahora solo re-exporta). El
 * comportamiento EXHAUSTIVO de shouldIgnoreRepeatedCode ya está cubierto en
 * quick-add-product-logic.test.ts (vía el re-export) — acá solo se prueba
 * lo nuevo: el normalizador, y que la constante/función se exportan desde
 * el lugar correcto.
 *
 * La decodificación real por cámara (@zxing/browser, CameraScanner) NO se
 * prueba acá: requiere un <video>/MediaStream reales — sin navegador/DOM no
 * hay forma honesta de probarlo en node:test.
 */

test("normalizeScannedCode — trim y sin espacios internos (espejo del backend)", () => {
  assert.equal(normalizeScannedCode("  7501234567890  "), "7501234567890");
  assert.equal(normalizeScannedCode("HMR SKU 0001"), "HMRSKU0001");
  assert.equal(normalizeScannedCode(""), "");
});

test("SCAN_REPEAT_DEBOUNCE_MS es 1.5s, como exige el doc", () => {
  assert.equal(SCAN_REPEAT_DEBOUNCE_MS, 1500);
});

test("shouldIgnoreRepeatedCode usa SCAN_REPEAT_DEBOUNCE_MS como default", () => {
  assert.equal(shouldIgnoreRepeatedCode("123", 1000, { code: "123", at: 0 }), true);
  assert.equal(shouldIgnoreRepeatedCode("123", SCAN_REPEAT_DEBOUNCE_MS, { code: "123", at: 0 }), false);
});
