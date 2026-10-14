/**
 * E · Fase 2 (prompt-completo-pendientes-2026-10.md) — lógica pura del
 * componente `CameraScanner`: preferencias, el temporizador del aviso
 * "no lee", el toggle de zoom, y el mapeo del ROI real (lib/scanner.ts) al
 * rectángulo que se DIBUJA sobre un <video object-contain> — para que el
 * recuadro guía corresponda de verdad a la zona que se decodifica, en vez
 * de ser decorativo (el bug #6 del diagnóstico).
 */

const SOUND_PREFERENCE_KEY = "hammer_scanner_sound_on_decode";

/** "Preferencia 'Sonido al escanear' en localStorage, encendida por defecto." */
export function readSoundPreference(): boolean {
  if (typeof window === "undefined") return true;
  try {
    const raw = window.localStorage.getItem(SOUND_PREFERENCE_KEY);
    return raw === null ? true : raw === "true";
  } catch {
    return true;
  }
}

export function writeSoundPreference(enabled: boolean): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(SOUND_PREFERENCE_KEY, enabled ? "true" : "false");
  } catch {
    /* localStorage no disponible — no es crítico recordar la preferencia. */
  }
}

/** "Si pasan 6s sin lectura con la cámara abierta, mostrar un aviso discreto." */
export const HELP_NOTICE_THRESHOLD_MS = 6000;

/** Pura: el caller reinicia `lastActivityAt` a `now` en cada lectura (y al abrir la cámara) — así "se reinicia con cada lectura" sin que esta función necesite saber de lecturas. */
export function shouldShowScanHelp(lastActivityAt: number, now: number, thresholdMs: number = HELP_NOTICE_THRESHOLD_MS): boolean {
  return now - lastActivityAt >= thresholdMs;
}

export type ZoomRange = { min: number; max: number; step: number };

/** "Zoom 1x/2x... un toque alterna" — si ya está en 2x o más, vuelve a 1x; si no, sube a 2x. Siempre dentro del rango real de la cámara. */
export function toggleZoomValue(current: number, range: ZoomRange): number {
  const target = current >= 2 ? 1 : 2;
  return Math.min(range.max, Math.max(range.min, target));
}

export type DisplayRect = { leftPercent: number; topPercent: number; widthPercent: number; heightPercent: number };

/** object-contain: el video dibuja su contenido en un sub-rectángulo del contenedor que preserva el aspect ratio (con barras a los lados o arriba/abajo). */
export function computeContainDisplayRect(videoW: number, videoH: number, containerW: number, containerH: number): DisplayRect {
  if (videoW <= 0 || videoH <= 0 || containerW <= 0 || containerH <= 0) return { leftPercent: 0, topPercent: 0, widthPercent: 100, heightPercent: 100 };
  const videoAspect = videoW / videoH;
  const containerAspect = containerW / containerH;
  let displayW: number;
  let displayH: number;
  if (videoAspect > containerAspect) {
    displayW = containerW;
    displayH = containerW / videoAspect;
  } else {
    displayH = containerH;
    displayW = containerH * videoAspect;
  }
  const leftPx = (containerW - displayW) / 2;
  const topPx = (containerH - displayH) / 2;
  return {
    leftPercent: (leftPx / containerW) * 100,
    topPercent: (topPx / containerH) * 100,
    widthPercent: (displayW / containerW) * 100,
    heightPercent: (displayH / containerH) * 100,
  };
}

/**
 * Mapea un ROI en coordenadas de PÍXEL DEL VIDEO (lib/scanner.ts, computeRoi
 * — la zona que de verdad se decodifica) a un rectángulo en % dentro del
 * contenedor, para dibujar el recuadro guía real sobre un <video
 * object-contain>. Sin esto, el recuadro es decorativo (bug #6).
 */
export function mapRoiToOverlayRect(
  videoW: number,
  videoH: number,
  containerW: number,
  containerH: number,
  roi: { x: number; y: number; width: number; height: number },
): DisplayRect {
  if (videoW <= 0 || videoH <= 0 || containerW <= 0 || containerH <= 0) return { leftPercent: 0, topPercent: 0, widthPercent: 0, heightPercent: 0 };
  const display = computeContainDisplayRect(videoW, videoH, containerW, containerH);
  const displayWidthPx = (display.widthPercent / 100) * containerW;
  const scale = displayWidthPx / videoW;
  const offsetXPx = (display.leftPercent / 100) * containerW;
  const offsetYPx = (display.topPercent / 100) * containerH;
  const leftPx = offsetXPx + roi.x * scale;
  const topPx = offsetYPx + roi.y * scale;
  const widthPx = roi.width * scale;
  const heightPx = roi.height * scale;
  return {
    leftPercent: (leftPx / containerW) * 100,
    topPercent: (topPx / containerH) * 100,
    widthPercent: (widthPx / containerW) * 100,
    heightPercent: (heightPx / containerH) * 100,
  };
}
