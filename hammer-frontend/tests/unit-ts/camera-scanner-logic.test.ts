import assert from "node:assert/strict";
import test from "node:test";
import {
  shouldShowScanHelp,
  HELP_NOTICE_THRESHOLD_MS,
  toggleZoomValue,
  computeContainDisplayRect,
  mapRoiToOverlayRect,
} from "@/lib/camera-scanner-logic";

/**
 * E · Fase 2 (prompt-completo-pendientes-2026-10.md) — lógica pura del
 * componente CameraScanner: el aviso "no lee" (temporizador que se reinicia
 * con cada lectura) y el mapeo del recuadro guía real sobre el video.
 */

// ── shouldShowScanHelp — "temporizador que se reinicia con cada lectura" ──

test("LA QUE IMPORTA — antes de los 6s, no muestra el aviso", () => {
  assert.equal(shouldShowScanHelp(0, 5999), false);
});
test("a los 6s exactos (o más), muestra el aviso", () => {
  assert.equal(shouldShowScanHelp(0, HELP_NOTICE_THRESHOLD_MS), true);
  assert.equal(shouldShowScanHelp(0, 7000), true);
});
test("una lectura reinicia lastActivityAt — el aviso deja de mostrarse hasta que pasen otros 6s", () => {
  // lectura a los 5000ms: lastActivityAt pasa a 5000. A los 10000ms (5000 después de la lectura) todavía no.
  assert.equal(shouldShowScanHelp(5000, 10000), false);
  assert.equal(shouldShowScanHelp(5000, 11000), true);
});

// ── toggleZoomValue — "zoom 1x/2x, un toque alterna" ─────────────────────

test("LA QUE IMPORTA — en 1x, un toque sube a 2x", () => {
  assert.equal(toggleZoomValue(1, { min: 1, max: 5, step: 0.1 }), 2);
});
test("en 2x o más, un toque baja a 1x", () => {
  assert.equal(toggleZoomValue(2, { min: 1, max: 5, step: 0.1 }), 1);
  assert.equal(toggleZoomValue(3, { min: 1, max: 5, step: 0.1 }), 1);
});
test("el objetivo se recorta al rango real de la cámara (una cámara que no llega a 2x)", () => {
  assert.equal(toggleZoomValue(1, { min: 1, max: 1.5, step: 0.1 }), 1.5);
});

// ── computeContainDisplayRect / mapRoiToOverlayRect ──────────────────────

test("LA QUE IMPORTA — video más ancho que el contenedor (relativamente): barras arriba/abajo", () => {
  // video 16:9 en un contenedor 4:3 (más angosto relativo) — el video se ajusta al ancho completo, con barras arriba/abajo.
  const rect = computeContainDisplayRect(1920, 1080, 800, 800);
  assert.equal(rect.widthPercent, 100);
  assert.ok(rect.heightPercent < 100);
  assert.ok(rect.topPercent > 0);
});
test("video más angosto que el contenedor (relativamente): barras a los lados", () => {
  const rect = computeContainDisplayRect(1080, 1920, 800, 800);
  assert.equal(rect.heightPercent, 100);
  assert.ok(rect.widthPercent < 100);
  assert.ok(rect.leftPercent > 0);
});
test("mismo aspect ratio: ocupa el 100% sin barras", () => {
  const rect = computeContainDisplayRect(1600, 900, 800, 450);
  assert.equal(Math.round(rect.widthPercent), 100);
  assert.equal(Math.round(rect.heightPercent), 100);
  assert.equal(Math.round(rect.leftPercent), 0);
  assert.equal(Math.round(rect.topPercent), 0);
});

test("LA QUE IMPORTA — el ROI del centro del video mapea al centro del contenedor, sin importar las barras", () => {
  // video 1920x1080 en contenedor cuadrado 800x800 → barras arriba/abajo.
  // ROI = banda central 80%x35% (computeRoi band) ya centrada en el video.
  const roi = { x: 192, y: 351, width: 1536, height: 378 }; // aprox band de 1920x1080
  const rect = mapRoiToOverlayRect(1920, 1080, 800, 800, roi);
  // El centro horizontal del rect debe caer cerca del 50% del contenedor (el ROI ya está centrado en el video).
  const centerPercent = rect.leftPercent + rect.widthPercent / 2;
  assert.ok(Math.abs(centerPercent - 50) < 1, `esperaba ~50%, dio ${centerPercent}`);
});
test("ROI vacío (video sin dimensiones todavía) no produce NaN", () => {
  const rect = mapRoiToOverlayRect(0, 0, 800, 800, { x: 0, y: 0, width: 0, height: 0 });
  assert.deepEqual(rect, { leftPercent: 0, topPercent: 0, widthPercent: 0, heightPercent: 0 });
});
