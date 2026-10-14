import assert from "node:assert/strict";
import test from "node:test";
import {
  isValidGtinChecksum,
  expandUpcEToUpcA,
  createReadConsensus,
  computeRoi,
  roiModeForAttempt,
  pickBackCamera,
  createFrameGate,
  ROI_FULL_FRAME_FALLBACK_MS,
} from "@/lib/scanner";

/**
 * E · Fase 1 (prompt-completo-pendientes-2026-10.md) — lógica pura del
 * motor de lectura nuevo. startContinuousScan en sí (cámara, canvas, WASM)
 * no es testeable sin un navegador real — mismo criterio que el resto de
 * esta sesión (detectPricingDecisions, previewUnifiedCatalogInventoryImport,
 * etc.): se extraen y prueban las funciones puras, no la orquestación DOM.
 */

// ── isValidGtinChecksum — códigos reales ─────────────────────────────────

test("LA QUE IMPORTA — EAN-13 real y válido (ejemplo canónico de Wikipedia)", () => {
  assert.equal(isValidGtinChecksum("4006381333931"), true);
});
test("EAN-13 con el dígito verificador alterado: inválido", () => {
  assert.equal(isValidGtinChecksum("4006381333930"), false);
});
test("UPC-A real y válido (Oreo, ejemplo citado habitualmente)", () => {
  assert.equal(isValidGtinChecksum("036000291452"), true);
});
test("UPC-A con el dígito verificador alterado: inválido", () => {
  assert.equal(isValidGtinChecksum("036000291451"), false);
});
test("EAN-8 válido (verificador calculado con el mismo algoritmo)", () => {
  assert.equal(isValidGtinChecksum("12345670"), true);
});
test("longitud que no es 8/12/13: inválido sin más (ni se calcula)", () => {
  assert.equal(isValidGtinChecksum("123456"), false);
});
test("con letras: inválido", () => {
  assert.equal(isValidGtinChecksum("400638133393X"), false);
});

// ── expandUpcEToUpcA ──────────────────────────────────────────────────────

test("LA QUE IMPORTA — UPC-E de 6 dígitos se expande a su UPC-A válido (último dígito 0)", () => {
  const expanded = expandUpcEToUpcA("123000");
  assert.equal(expanded, "012000003004");
  assert.equal(isValidGtinChecksum(expanded!), true);
});
test("UPC-E con último dígito 3 (otra rama de compresión) expande y valida", () => {
  const expanded = expandUpcEToUpcA("123403");
  assert.equal(expanded, "012300000406");
  assert.equal(isValidGtinChecksum(expanded!), true);
});
test("UPC-E con último dígito 7 (rama por defecto, 5-9) expande y valida", () => {
  const expanded = expandUpcEToUpcA("123457");
  assert.equal(expanded, "012345000072");
  assert.equal(isValidGtinChecksum(expanded!), true);
});
test("UPC-E de 8 dígitos con número de sistema 1: expande con ese sistema", () => {
  assert.equal(expandUpcEToUpcA("11230009"), "112000003001");
});
test("UPC-E de 8 dígitos con número de sistema inválido (2): null", () => {
  assert.equal(expandUpcEToUpcA("21230009"), null);
});
test("longitud que no es 6 ni 8: null", () => {
  assert.equal(expandUpcEToUpcA("12345"), null);
});

// ── createReadConsensus (1.4 — "la misma lectura 2 veces dentro de 700ms") ──

test("LA QUE IMPORTA — dos lecturas iguales dentro de la ventana: emite", () => {
  const consensus = createReadConsensus({ required: 2, windowMs: 700 });
  assert.equal(consensus.feed("7501234567890", 0), false);
  assert.equal(consensus.feed("7501234567890", 300), true);
});
test("dos lecturas DISTINTAS: no emite ninguna", () => {
  const consensus = createReadConsensus({ required: 2, windowMs: 700 });
  assert.equal(consensus.feed("111", 0), false);
  assert.equal(consensus.feed("222", 100), false);
});
test("la misma lectura, pero FUERA de la ventana: no emite (se reinicia la cuenta)", () => {
  const consensus = createReadConsensus({ required: 2, windowMs: 700 });
  assert.equal(consensus.feed("111", 0), false);
  assert.equal(consensus.feed("111", 800), false, "pasaron 800ms > 700ms — la primera lectura ya no cuenta");
});
test("tras emitir, el contador de ESE código se reinicia (no emite de nuevo con una sola lectura más)", () => {
  const consensus = createReadConsensus({ required: 2, windowMs: 700 });
  assert.equal(consensus.feed("111", 0), false);
  assert.equal(consensus.feed("111", 100), true);
  assert.equal(consensus.feed("111", 150), false);
});

// ── computeRoi / roiModeForAttempt ────────────────────────────────────────

test("LA QUE IMPORTA — banda central 80% ancho × 35% alto para 1D", () => {
  const roi = computeRoi(1920, 1080, "band");
  assert.equal(roi.width, Math.round(1920 * 0.8));
  assert.equal(roi.height, Math.round(1080 * 0.35));
  assert.equal(roi.x, Math.round((1920 - roi.width) / 2));
  assert.equal(roi.y, Math.round((1080 - roi.height) / 2));
});
test("cuadrado central 60% para QR, centrado sobre el lado menor", () => {
  const roi = computeRoi(1920, 1080, "square");
  const expectedSize = Math.round(1080 * 0.6);
  assert.equal(roi.width, expectedSize);
  assert.equal(roi.height, expectedSize);
});
test("modo full devuelve el cuadro completo", () => {
  assert.deepEqual(computeRoi(640, 480, "full"), { x: 0, y: 0, width: 640, height: 480 });
});
test("video sin dimensiones todavía (0×0): rectángulo vacío, no NaN/negativo", () => {
  assert.deepEqual(computeRoi(0, 0, "band"), { x: 0, y: 0, width: 0, height: 0 });
});
test("roiModeForAttempt alterna band/square antes de los 3s", () => {
  assert.equal(roiModeForAttempt(0, 500), "band");
  assert.equal(roiModeForAttempt(1, 500), "square");
  assert.equal(roiModeForAttempt(2, 500), "band");
});
test("después de 3s sin lectura, intercala 'full' cada 3er intento", () => {
  assert.equal(roiModeForAttempt(2, ROI_FULL_FRAME_FALLBACK_MS), "full");
  assert.equal(roiModeForAttempt(0, ROI_FULL_FRAME_FALLBACK_MS), "band");
  assert.equal(roiModeForAttempt(1, ROI_FULL_FRAME_FALLBACK_MS), "square");
});

// ── pickBackCamera (1.5) ──────────────────────────────────────────────────

test("LA QUE IMPORTA — con varias traseras, evita la gran angular ('wide')", () => {
  const devices = [
    { deviceId: "a", label: "Back Camera 0.5x Wide", kind: "videoinput" },
    { deviceId: "b", label: "Back Camera", kind: "videoinput" },
    { deviceId: "c", label: "Front Camera", kind: "videoinput" },
  ];
  assert.equal(pickBackCamera(devices, null), "b");
});
test("la recordada (si sigue conectada) se respeta, aunque diga 'wide'", () => {
  const devices = [
    { deviceId: "a", label: "Back Camera Wide", kind: "videoinput" },
    { deviceId: "b", label: "Back Camera", kind: "videoinput" },
  ];
  assert.equal(pickBackCamera(devices, "a"), "a");
});
test("la recordada que ya NO está conectada se ignora, vuelve a elegir", () => {
  const devices = [{ deviceId: "b", label: "Back Camera", kind: "videoinput" }];
  assert.equal(pickBackCamera(devices, "desconectada"), "b");
});
test("sin ninguna cámara: null", () => {
  assert.equal(pickBackCamera([], null), null);
});
test("solo cámaras 'ultra'/ninguna normal: igual elige una (mejor algo que nada)", () => {
  const devices = [{ deviceId: "a", label: "Ultra Wide Back", kind: "videoinput" }];
  assert.equal(pickBackCamera(devices, null), "a");
});
test("excluye la frontal cuando hay otra opción", () => {
  const devices = [
    { deviceId: "front", label: "Front Camera", kind: "videoinput" },
    { deviceId: "back", label: "Back Camera", kind: "videoinput" },
  ];
  assert.equal(pickBackCamera(devices, null), "back");
});

// ── createFrameGate — "nunca hay dos detecciones en paralelo" ────────────

test("LA QUE IMPORTA — con un detector lento (sin salir todavía), el segundo intento se salta", () => {
  const gate = createFrameGate();
  assert.equal(gate.tryEnter(), true, "el primer intento entra");
  assert.equal(gate.tryEnter(), false, "el detector 'sigue en curso' — el segundo se salta");
  gate.exit();
  assert.equal(gate.tryEnter(), true, "una vez que el detector lento termina, el siguiente intento sí entra");
});
