/**
 * lib/scanner.ts — lector de código de barras/QR por cámara (v2).
 *
 * E · Fase 1 (prompt-completo-pendientes-2026-10.md) — reescritura completa.
 * La firma pública que ya usaba Alta rápida se mantiene: `startContinuousScan`,
 * `ScannerHandle` (como superset — solo agrega campos), `normalizeScannedCode`,
 * `shouldIgnoreRepeatedCode`, `SCAN_REPEAT_DEBOUNCE_MS`.
 *
 * Motor en capas (1.1): nativo `BarcodeDetector` → polyfill WASM
 * (ZXing-C++, `barcode-detector`) cargado solo al abrir la cámara → último
 * recurso `@zxing/browser`, configurado (formatos acotados, TRY_HARDER,
 * 120ms entre intentos) — el camino de hoy, pero ya no el único ni el
 * primero. El nativo y el WASM comparten la MISMA interfaz `detect(image)`
 * (la razón de ser de `barcode-detector`: un polyfill fiel al spec), así que
 * ambos corren por el mismo bucle propio con ROI; zxing-js corre su propio
 * bucle interno (es "último recurso", no necesita el mismo refinamiento).
 */
import type { BarcodeDetector as PonyfillBarcodeDetector, BarcodeFormat as PonyfillBarcodeFormat, DetectedBarcode } from "barcode-detector/pure";

/** Espejo documentado de catalog/barcode.ts (hammer-api) — misma regla, lado cliente. */
export function normalizeScannedCode(raw: string): string {
  return raw.trim().replace(/\s+/g, "");
}

/** Ventana para ignorar el MISMO código leído dos veces seguidas (doble disparo del lector continuo, o doble Enter). */
export const SCAN_REPEAT_DEBOUNCE_MS = 1500;

export function shouldIgnoreRepeatedCode(
  code: string,
  now: number,
  last: { code: string; at: number } | null,
  debounceMs: number = SCAN_REPEAT_DEBOUNCE_MS,
): boolean {
  if (!last) return false;
  return last.code === code && now - last.at < debounceMs;
}

// ────────────────────────────────────────────────────────────────────────
// 1.2 — Formatos. Menos formatos = más rápido y menos falsos positivos.
// ────────────────────────────────────────────────────────────────────────
export const SUPPORTED_FORMATS = ["ean_13", "ean_8", "upc_a", "upc_e", "code_128", "code_39", "itf", "qr_code"] as const;
export type SupportedFormat = (typeof SUPPORTED_FORMATS)[number];

/** Formatos GTIN de longitud fija validable directo (UPC-E se valida aparte — ver acceptCandidate). */
const GTIN_FORMATS = new Set<SupportedFormat>(["ean_13", "ean_8", "upc_a"]);

// ────────────────────────────────────────────────────────────────────────
// 1.4 — Validación antes de aceptar. Puras, sin DOM: se prueban con códigos
// reales (válidos e inválidos) sin montar cámara.
// ────────────────────────────────────────────────────────────────────────

/**
 * Dígito verificador GTIN (EAN-13, EAN-8, UPC-A — 13/8/12 dígitos): suma
 * ponderada 3/1 alternada desde el dígito MENOS significativo (excluyendo
 * el propio verificador), redondeada al múltiplo de 10 superior. UPC-E no
 * entra acá directo — se expande primero con `expandUpcEToUpcA` y se valida
 * esa forma (el verificador real vive en la forma expandida, no en la
 * comprimida); el caller (acceptCandidate) hace esa expansión según el
 * formato que reportó el detector, porque un string de 8 dígitos por sí
 * solo es ambiguo entre EAN-8 y UPC-E forma completa.
 */
export function isValidGtinChecksum(code: string): boolean {
  if (!/^\d+$/.test(code)) return false;
  if (!isValidGtinLength(code.length)) return false;
  const payload = code.slice(0, -1);
  const checkDigit = Number(code[code.length - 1]);
  let sum = 0;
  // Desde el dígito MENOS significativo del payload (el más cercano al
  // verificador), alternando peso 3 y 1.
  for (let i = 0; i < payload.length; i++) {
    const posFromRight = payload.length - 1 - i;
    const weight = posFromRight % 2 === 0 ? 3 : 1;
    sum += Number(payload[i]) * weight;
  }
  const expectedCheck = (10 - (sum % 10)) % 10;
  return expectedCheck === checkDigit;
}

function isValidGtinLength(length: number): boolean {
  return length === 8 || length === 12 || length === 13;
}

/**
 * Expande un UPC-E (6 dígitos comprimidos, o 8 con número de sistema +
 * verificador ya incluidos) a su UPC-A equivalente (12 dígitos), según el
 * algoritmo estándar GS1 de zero-suppression. Solo número de sistema "0" o
 * "1" (los dos que define el estándar); cualquier otra cosa, o una longitud
 * distinta de 6/8, devuelve null. El verificador del resultado se RECALCULA
 * siempre — el de un input de 8 dígitos no se confía ciegamente.
 */
export function expandUpcEToUpcA(upcE: string): string | null {
  if (!/^\d+$/.test(upcE)) return null;
  let core: string;
  let systemDigit = "0";
  if (upcE.length === 8) {
    systemDigit = upcE[0];
    if (systemDigit !== "0" && systemDigit !== "1") return null;
    core = upcE.slice(1, 7);
  } else if (upcE.length === 6) {
    core = upcE;
  } else {
    return null;
  }
  const lastDigit = core[5];
  const mfr = core.slice(0, 5);
  let body: string;
  switch (lastDigit) {
    case "0": case "1": case "2":
      body = `${mfr.slice(0, 2)}${lastDigit}0000${mfr.slice(2)}`;
      break;
    case "3":
      body = `${mfr.slice(0, 3)}00000${mfr.slice(3)}`;
      break;
    case "4":
      body = `${mfr.slice(0, 4)}00000${mfr.slice(4)}`;
      break;
    default:
      body = `${mfr.slice(0, 5)}0000${lastDigit}`;
      break;
  }
  const payload = `${systemDigit}${body}`;
  let sum = 0;
  for (let i = 0; i < payload.length; i++) {
    const posFromRight = payload.length - 1 - i;
    const weight = posFromRight % 2 === 0 ? 3 : 1;
    sum += Number(payload[i]) * weight;
  }
  const checkDigit = (10 - (sum % 10)) % 10;
  return `${payload}${checkDigit}`;
}

/**
 * prompt-codigos-editar-eliminar.md Fase 1.1/3.1 — "aviso de dígito
 * verificador inválido" en vivo, mientras se teclea/edita un código (antes
 * de guardar). Espejo documentado de catalog/barcode.ts (hammer-api) —
 * mismo criterio ahí para el `warnings` que devuelve updateBarcode, nunca
 * bloquea el guardado, solo avisa. Ver ese archivo para por qué 8 dígitos
 * es ambiguo (EAN-8 autocontenido vs. UPC-E con sistema+verificador).
 */
export function checksumWarningForCode(code: string): boolean {
  if (!/^\d+$/.test(code)) return false;
  if (code.length === 12 || code.length === 13) return !isValidGtinChecksum(code);
  if (code.length === 8) {
    if (isValidGtinChecksum(code)) return false;
    const expanded = expandUpcEToUpcA(code);
    return !(expanded && isValidGtinChecksum(expanded));
  }
  if (code.length === 6) {
    const expanded = expandUpcEToUpcA(code);
    return !(expanded && isValidGtinChecksum(expanded));
  }
  return false;
}

export type ReadConsensus = {
  /** Registra una lectura; true cuando se alcanzó el consenso (y lo reinicia). */
  feed: (code: string, now: number) => boolean;
};

/**
 * "La misma lectura 2 veces dentro de 700ms antes de emitirla" (1.4) — para
 * 1D del motor no-nativo. Pura (recibe `now`, no usa Date.now() internamente)
 * para poder probarla con tiempos fijos.
 */
export function createReadConsensus(opts: { required: number; windowMs: number }): ReadConsensus {
  let buffer: Array<{ code: string; at: number }> = [];
  return {
    feed(code: string, now: number): boolean {
      buffer = buffer.filter((entry) => now - entry.at < opts.windowMs);
      buffer.push({ code, at: now });
      const matching = buffer.filter((entry) => entry.code === code);
      if (matching.length >= opts.required) {
        buffer = buffer.filter((entry) => entry.code !== code);
        return true;
      }
      return false;
    },
  };
}

const CONSENSUS_REQUIRED = 2;
const CONSENSUS_WINDOW_MS = 700;

// ────────────────────────────────────────────────────────────────────────
// 1.3 — "Nunca hay dos detecciones en paralelo: si una sigue en curso, se
// salta el cuadro." Pura (sin DOM) para poder probarla con un detector fake
// lento, sin montar cámara ni video real.
// ────────────────────────────────────────────────────────────────────────
export type FrameGate = { tryEnter: () => boolean; exit: () => void };

export function createFrameGate(): FrameGate {
  let busy = false;
  return {
    tryEnter: () => {
      if (busy) return false;
      busy = true;
      return true;
    },
    exit: () => { busy = false; },
  };
}

// ────────────────────────────────────────────────────────────────────────
// 1.3 — Zona de lectura (ROI). Pura: recibe el tamaño del video y el modo,
// devuelve el rectángulo a recortar.
// ────────────────────────────────────────────────────────────────────────
export type Roi = { x: number; y: number; width: number; height: number };
export type RoiMode = "band" | "square" | "full";

/**
 * "Banda central de ~80% de ancho × 35% de alto para 1D, que alterne cada
 * intento con un cuadrado central de ~60% para QR... si después de 3s no
 * hay lectura, probar también el cuadro completo, intercalado."
 */
export function computeRoi(videoW: number, videoH: number, mode: RoiMode): Roi {
  if (videoW <= 0 || videoH <= 0) return { x: 0, y: 0, width: 0, height: 0 };
  if (mode === "full") return { x: 0, y: 0, width: videoW, height: videoH };
  if (mode === "square") {
    const size = Math.round(Math.min(videoW, videoH) * 0.6);
    return { x: Math.round((videoW - size) / 2), y: Math.round((videoH - size) / 2), width: size, height: size };
  }
  // "band"
  const width = Math.round(videoW * 0.8);
  const height = Math.round(videoH * 0.35);
  return { x: Math.round((videoW - width) / 2), y: Math.round((videoH - height) / 2), width, height };
}

/** Después de cuánto tiempo sin lectura se empieza a intercalar el cuadro completo (1.3). */
export const ROI_FULL_FRAME_FALLBACK_MS = 3000;

/**
 * Secuencia de modos ROI para el intento número `attemptIndex` (0-based),
 * desde que se abrió la cámara (`elapsedMs`). Alterna band/square siempre;
 * una vez pasado ROI_FULL_FRAME_FALLBACK_MS, intercala "full" cada 3er intento.
 */
export function roiModeForAttempt(attemptIndex: number, elapsedMs: number): RoiMode {
  if (elapsedMs >= ROI_FULL_FRAME_FALLBACK_MS && attemptIndex % 3 === 2) return "full";
  return attemptIndex % 2 === 0 ? "band" : "square";
}

// ────────────────────────────────────────────────────────────────────────
// 1.5 — Cámara trasera correcta. Pura: recibe la lista de dispositivos (ya
// enumerados, con permiso) y la preferencia recordada.
// ────────────────────────────────────────────────────────────────────────
export type CameraDeviceLike = { deviceId: string; label: string; kind: string };

const AVOID_LABEL_RE = /wide|ultra|0\.5x?/i;
const FRONT_LABEL_RE = /front|user|selfie/i;

/**
 * "Si hay varias traseras, preferir la que NO diga 'wide', 'ultra' ni
 * '0.5': la gran angular no enfoca a 15cm." La recordada (si sigue
 * conectada) siempre gana — es una decisión explícita del usuario.
 */
export function pickBackCamera(devices: CameraDeviceLike[], remembered: string | null): string | null {
  const videoInputs = devices.filter((d) => d.kind === "videoinput");
  if (videoInputs.length === 0) return null;
  if (remembered && videoInputs.some((d) => d.deviceId === remembered)) return remembered;

  const notFront = videoInputs.filter((d) => !FRONT_LABEL_RE.test(d.label));
  const candidates = notFront.length > 0 ? notFront : videoInputs;

  const notWide = candidates.filter((d) => !AVOID_LABEL_RE.test(d.label));
  const best = notWide.length > 0 ? notWide : candidates;

  return best[0].deviceId;
}

const CAMERA_STORAGE_PREFIX = "hammer_scanner_camera_";

function storageKeyForDevice(): string {
  // Por dispositivo FÍSICO (no por producto/usuario) — "se recuerdan en
  // localStorage por dispositivo" (1.5). localStorage ya es por-origen y
  // por-navegador-instalado, que en la práctica es "por tablet".
  return `${CAMERA_STORAGE_PREFIX}default`;
}

export function readRememberedCameraId(): string | null {
  if (typeof window === "undefined") return null;
  try {
    return window.localStorage.getItem(storageKeyForDevice());
  } catch {
    return null;
  }
}

export function writeRememberedCameraId(deviceId: string): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(storageKeyForDevice(), deviceId);
  } catch {
    /* localStorage no disponible (privado, cuota) — no es crítico recordar. */
  }
}

// ────────────────────────────────────────────────────────────────────────
// Motor en capas (1.1)
// ────────────────────────────────────────────────────────────────────────
export type ScannerEngine = "native" | "wasm" | "zxing-js";

type FrameDetector = {
  detect: (image: ImageBitmapSource) => Promise<Array<{ rawValue: string; format: string }>>;
};

declare global {
  interface Window {
    BarcodeDetector?: typeof PonyfillBarcodeDetector;
  }
}

let wasmLocateFileConfigured = false;

/** El .wasm SIEMPRE se sirve desde este mismo dominio — nunca de un CDN (restricción de CSP citada en el prompt). */
async function configureWasmLocateFile(): Promise<void> {
  if (wasmLocateFileConfigured) return;
  const { setZXingModuleOverrides } = await import("barcode-detector/pure");
  setZXingModuleOverrides({
    locateFile: (path: string) => (path.endsWith(".wasm") ? "/vendor/zxing/zxing_reader.wasm" : path),
  });
  wasmLocateFileConfigured = true;
}

async function tryNativeDetector(): Promise<FrameDetector | null> {
  if (typeof window === "undefined" || !window.BarcodeDetector) return null;
  try {
    const formats = await window.BarcodeDetector.getSupportedFormats();
    if (!formats.includes("ean_13" as never)) return null;
    const detector = new window.BarcodeDetector({ formats: [...SUPPORTED_FORMATS] as PonyfillBarcodeFormat[] });
    return {
      detect: async (image) => (await detector.detect(image as never)).map((d: DetectedBarcode) => ({ rawValue: d.rawValue, format: d.format })),
    };
  } catch {
    return null;
  }
}

async function tryWasmDetector(): Promise<FrameDetector | null> {
  try {
    await configureWasmLocateFile();
    const { BarcodeDetector } = await import("barcode-detector/pure");
    const detector = new BarcodeDetector({ formats: [...SUPPORTED_FORMATS] as PonyfillBarcodeFormat[] });
    // Prueba de humo: si el módulo WASM no instancia (CSP, fetch del
    // binario, etc.), esto lanza acá — antes de depender de él en el bucle.
    await detector.detect(new ImageData(1, 1));
    return {
      detect: async (image) => (await detector.detect(image as never)).map((d) => ({ rawValue: d.rawValue, format: d.format })),
    };
  } catch {
    return null;
  }
}

/** Resuelve (y cachea para esta sesión de página) qué motor está realmente disponible, en el orden de la capa 1.1. */
let cachedEngine: { engine: ScannerEngine; detector: FrameDetector | null } | null = null;
let cachedEnginePromise: Promise<{ engine: ScannerEngine; detector: FrameDetector | null }> | null = null;

async function resolveEngine(): Promise<{ engine: ScannerEngine; detector: FrameDetector | null }> {
  if (cachedEngine) return cachedEngine;
  if (!cachedEnginePromise) {
    cachedEnginePromise = (async () => {
      const native = await tryNativeDetector();
      if (native) return { engine: "native" as const, detector: native };
      const wasm = await tryWasmDetector();
      if (wasm) return { engine: "wasm" as const, detector: wasm };
      return { engine: "zxing-js" as const, detector: null };
    })();
  }
  cachedEngine = await cachedEnginePromise;
  return cachedEngine;
}

/** 1.1 — "para el diagnóstico de la Fase 3": qué motor se usaría/se está usando ahora mismo. */
export async function getActiveEngine(): Promise<ScannerEngine> {
  return (await resolveEngine()).engine;
}

// ────────────────────────────────────────────────────────────────────────
// Handle público y arranque
// ────────────────────────────────────────────────────────────────────────
export type ScannerStats = {
  engine: ScannerEngine | null;
  resolutionWidth: number | null;
  resolutionHeight: number | null;
  attemptsPerSecond: number;
  avgDecodeMs: number | null;
};

export type ScannerHandle = {
  stop: () => void;
  /** 1.6 — todo lo de acá es seguro de llamar aunque la capacidad no exista (no-op/false/null). El caller (CameraScanner) decide si muestra el botón. */
  setTorch: (on: boolean) => Promise<void>;
  hasTorch: () => boolean;
  setZoom: (value: number) => Promise<void>;
  getZoomRange: () => { min: number; max: number; step: number } | null;
  switchCamera: (deviceId: string) => Promise<void>;
  listCameras: () => Promise<CameraDeviceLike[]>;
  /** deviceId de la cámara ACTIVA ahora mismo (la elegida automáticamente por pickBackCamera, o la última pasada a switchCamera) — para que el botón "cambiar cámara" sepa cuál es la siguiente en la lista. null antes de que la cámara abra. */
  getCurrentDeviceId: () => string | null;
  getStats: () => ScannerStats;
};

export type StartContinuousScanOptions = {
  videoElement: HTMLVideoElement;
  /** Id de cámara (MediaDeviceInfo.deviceId); sin esto, se elige la trasera correcta (1.5). */
  deviceId?: string;
  /** Texto CRUDO (sin normalizar) de cada lectura exitosa, YA validada (checksum + consenso) — el caller decide cuándo normalizar/debounce, igual que el lector USB entrando por el mismo campo Código. */
  onDecode: (rawText: string) => void;
  /** Solo errores REALES (permiso denegado, cámara ocupada) — "no hay código en este cuadro" es el caso normal entre lecturas y nunca llega acá. */
  onError?: (error: unknown) => void;
  /** E · Fase 3 — detalle opcional de cada lectura ACEPTADA (formato, si el dígito verificador aplicaba y pasó, milisegundos desde que se abrió la cámara) para la página de diagnóstico. Nadie más lo necesita — CameraScanner no lo usa. */
  onDecodeDetail?: (detail: { code: string; format: SupportedFormat | "unknown"; checksumValid: boolean | null; elapsedSinceOpenMs: number }) => void;
};

type ExtendedCapabilities = MediaTrackCapabilities & { torch?: boolean; zoom?: { min: number; max: number; step: number }; focusMode?: string[]; exposureMode?: string[] };
type ExtendedConstraintSet = MediaTrackConstraintSet & { torch?: boolean; zoom?: number; focusMode?: string; exposureMode?: string };

const ATTEMPTS_PER_SECOND_TARGET = 10;
const FRAME_INTERVAL_MS = 1000 / ATTEMPTS_PER_SECOND_TARGET;

/**
 * Arranca el lector en modo CONTINUO sobre un <video> ya montado en el DOM.
 * Nunca lanza de forma síncrona: cualquier falla (permiso denegado, sin
 * cámara) llega por `onError`, nunca por throw.
 */
export function startContinuousScan(options: StartContinuousScanOptions): ScannerHandle {
  let stopped = false;
  let stream: MediaStream | null = null;
  let track: MediaStreamTrack | null = null;
  let engine: ScannerEngine | null = null;
  let detector: FrameDetector | null = null;
  let zxingControls: { stop: () => void } | null = null;
  let roiCanvas: HTMLCanvasElement | null = null;
  const frameGate = createFrameGate();
  let attemptIndex = 0;
  let startedAt = 0;
  let lastFrameAt = 0;
  let frameTimerId: number | null = null;
  let usingRvfc = false;
  let paused = false;

  // Estadísticas en vivo (1.6/getStats, Fase 3 las muestra).
  let attemptsInWindow = 0;
  let attemptsWindowStart = 0;
  let attemptsPerSecond = 0;
  let decodeDurationsMs: number[] = [];

  const consensus = createReadConsensus({ required: CONSENSUS_REQUIRED, windowMs: CONSENSUS_WINDOW_MS });

  function recordAttempt(now: number) {
    attemptsInWindow += 1;
    if (now - attemptsWindowStart >= 1000) {
      attemptsPerSecond = attemptsInWindow / ((now - attemptsWindowStart) / 1000);
      attemptsInWindow = 0;
      attemptsWindowStart = now;
    }
  }

  function recordDecodeDuration(ms: number) {
    decodeDurationsMs.push(ms);
    if (decodeDurationsMs.length > 20) decodeDurationsMs = decodeDurationsMs.slice(-20);
  }

  /** Única puerta de salida de una lectura candidata — checksum + consenso, sin importar qué bucle la trajo (frame-loop o zxing-js). */
  function acceptCandidate(rawValue: string, format: string, now: number) {
    let checksumValid: boolean | null = null;
    if (format === "upc_e") {
      const expanded = expandUpcEToUpcA(rawValue);
      checksumValid = Boolean(expanded) && isValidGtinChecksum(expanded!);
      if (!checksumValid) return; // descartado en silencio (1.4).
    } else if (GTIN_FORMATS.has(format as SupportedFormat)) {
      checksumValid = isValidGtinChecksum(rawValue);
      if (!checksumValid) return; // descartado en silencio (1.4).
    }
    const needsConsensus = format !== "qr_code" && engine !== "native";
    if (needsConsensus && !consensus.feed(rawValue, now)) return;
    options.onDecode(rawValue);
    options.onDecodeDetail?.({
      code: rawValue,
      format: (SUPPORTED_FORMATS as readonly string[]).includes(format) ? (format as SupportedFormat) : "unknown",
      checksumValid,
      elapsedSinceOpenMs: Math.round(now - startedAt),
    });
  }

  async function runFrameLoop() {
    if (stopped || paused) return;
    const video = options.videoElement;
    const now = performance.now();
    if (now - lastFrameAt < FRAME_INTERVAL_MS) {
      scheduleNextFrame();
      return;
    }
    lastFrameAt = now;
    if (!detector || video.readyState < 2 || video.videoWidth === 0) {
      scheduleNextFrame();
      return;
    }
    if (!frameGate.tryEnter()) {
      scheduleNextFrame();
      return;
    }
    recordAttempt(now);
    try {
      if (!roiCanvas) roiCanvas = document.createElement("canvas");
      const elapsedMs = now - startedAt;
      const mode = roiModeForAttempt(attemptIndex, elapsedMs);
      attemptIndex += 1;
      const roi = computeRoi(video.videoWidth, video.videoHeight, mode);
      if (roi.width > 0 && roi.height > 0) {
        roiCanvas.width = roi.width;
        roiCanvas.height = roi.height;
        const ctx = roiCanvas.getContext("2d", { willReadFrequently: true });
        if (ctx) {
          ctx.drawImage(video, roi.x, roi.y, roi.width, roi.height, 0, 0, roi.width, roi.height);
          const decodeStart = performance.now();
          const results = await detector.detect(roiCanvas);
          recordDecodeDuration(performance.now() - decodeStart);
          if (!stopped && results.length > 0) {
            acceptCandidate(results[0].rawValue, results[0].format, performance.now());
          }
        }
      }
    } catch {
      // Un cuadro sin lectura o un frame corrupto NO es un error real — se
      // sigue intentando (ver doc en StartContinuousScanOptions.onError).
    } finally {
      frameGate.exit();
      scheduleNextFrame();
    }
  }

  function scheduleNextFrame() {
    if (stopped) return;
    const video = options.videoElement;
    if (typeof video.requestVideoFrameCallback === "function") {
      usingRvfc = true;
      frameTimerId = video.requestVideoFrameCallback(() => void runFrameLoop());
    } else {
      frameTimerId = window.requestAnimationFrame(() => void runFrameLoop());
    }
  }

  function cancelScheduledFrame() {
    if (frameTimerId === null) return;
    const video = options.videoElement;
    if (usingRvfc && typeof video.cancelVideoFrameCallback === "function") video.cancelVideoFrameCallback(frameTimerId);
    else window.cancelAnimationFrame(frameTimerId);
    frameTimerId = null;
  }

  function onVisibilityChange() {
    if (typeof document === "undefined") return;
    paused = document.hidden;
    if (!paused && engine !== "zxing-js") scheduleNextFrame();
  }

  async function applyCameraCapabilities(t: MediaStreamTrack) {
    try {
      const caps = t.getCapabilities?.() as ExtendedCapabilities | undefined;
      const advanced: ExtendedConstraintSet[] = [];
      if (caps?.focusMode?.includes("continuous")) advanced.push({ focusMode: "continuous" });
      if (caps?.exposureMode?.includes("continuous")) advanced.push({ exposureMode: "continuous" });
      if (advanced.length > 0) await t.applyConstraints({ advanced } as MediaTrackConstraints);
    } catch {
      /* best-effort — una cámara que no soporta estos modos no debe bloquear el escaneo. */
    }
  }

  async function openCamera(deviceId: string | undefined) {
    try {
      const constraints: MediaStreamConstraints = {
        video: deviceId
          ? { deviceId: { exact: deviceId }, width: { ideal: 1920 }, height: { ideal: 1080 }, frameRate: { ideal: 30 } }
          : { facingMode: { ideal: "environment" }, width: { ideal: 1920 }, height: { ideal: 1080 }, frameRate: { ideal: 30 } },
      };
      stream = await navigator.mediaDevices.getUserMedia(constraints);
      if (stopped) { stream.getTracks().forEach((t) => t.stop()); return; }
      track = stream.getVideoTracks()[0] ?? null;
      options.videoElement.srcObject = stream;
      await options.videoElement.play().catch(() => {});
      if (track) {
        await applyCameraCapabilities(track);
        if (!deviceId) {
          const settings = track.getSettings();
          if (settings.deviceId) writeRememberedCameraId(settings.deviceId);
        }
      }

      const resolved = await resolveEngine();
      engine = resolved.engine;
      startedAt = performance.now();
      attemptsWindowStart = startedAt;

      if (resolved.engine === "zxing-js") {
        await startZxingFallback();
      } else {
        detector = resolved.detector;
        document.addEventListener("visibilitychange", onVisibilityChange);
        scheduleNextFrame();
      }
    } catch (error) {
      options.onError?.(error);
    }
  }

  async function startZxingFallback() {
    const { BrowserMultiFormatReader } = await import("@zxing/browser");
    const { DecodeHintType, BarcodeFormat, NotFoundException } = await import("@zxing/library");
    const formatMap: Record<SupportedFormat, number> = {
      ean_13: BarcodeFormat.EAN_13, ean_8: BarcodeFormat.EAN_8, upc_a: BarcodeFormat.UPC_A, upc_e: BarcodeFormat.UPC_E,
      code_128: BarcodeFormat.CODE_128, code_39: BarcodeFormat.CODE_39, itf: BarcodeFormat.ITF, qr_code: BarcodeFormat.QR_CODE,
    };
    const reverseFormatMap = new Map(Object.entries(formatMap).map(([k, v]) => [v, k]));
    const hints = new Map<number, unknown>([
      [DecodeHintType.TRY_HARDER, true],
      [DecodeHintType.POSSIBLE_FORMATS, Object.values(formatMap)],
    ]);
    const reader = new BrowserMultiFormatReader(hints as never, { delayBetweenScanAttempts: 120, delayBetweenScanSuccess: 120 });
    const controls = await reader.decodeFromVideoDevice(undefined, options.videoElement, (result, error) => {
      if (stopped) return;
      if (result) {
        const formatName = reverseFormatMap.get(result.getBarcodeFormat()) ?? "unknown";
        acceptCandidate(result.getText(), formatName, performance.now());
        return;
      }
      if (error && !(error instanceof NotFoundException)) options.onError?.(error);
    });
    if (stopped) { controls.stop(); return; }
    zxingControls = controls;
  }

  openCamera(options.deviceId ?? readRememberedCameraId() ?? undefined);

  return {
    stop: () => {
      stopped = true;
      cancelScheduledFrame();
      document.removeEventListener("visibilitychange", onVisibilityChange);
      zxingControls?.stop();
      // "Siempre detener todos los tracks al desmontar" (1.5) — apaga la luz de la cámara.
      stream?.getTracks().forEach((t) => t.stop());
    },
    setTorch: async (on: boolean) => {
      if (!track) return;
      try {
        await track.applyConstraints({ advanced: [{ torch: on } as ExtendedConstraintSet] } as MediaTrackConstraints);
      } catch {
        /* sin linterna — no-op, el caller ya debería haber chequeado hasTorch(). */
      }
    },
    hasTorch: () => Boolean((track?.getCapabilities?.() as ExtendedCapabilities | undefined)?.torch),
    setZoom: async (value: number) => {
      if (!track) return;
      try {
        await track.applyConstraints({ advanced: [{ zoom: value } as ExtendedConstraintSet] } as MediaTrackConstraints);
      } catch {
        /* sin zoom — no-op. */
      }
    },
    getZoomRange: () => (track?.getCapabilities?.() as ExtendedCapabilities | undefined)?.zoom ?? null,
    switchCamera: async (deviceId: string) => {
      cancelScheduledFrame();
      zxingControls?.stop();
      zxingControls = null;
      stream?.getTracks().forEach((t) => t.stop());
      stream = null;
      track = null;
      writeRememberedCameraId(deviceId);
      await openCamera(deviceId);
    },
    listCameras: async () => {
      const all = await navigator.mediaDevices.enumerateDevices();
      return all.filter((d) => d.kind === "videoinput").map((d) => ({ deviceId: d.deviceId, label: d.label, kind: d.kind }));
    },
    getCurrentDeviceId: () => track?.getSettings().deviceId ?? null,
    getStats: (): ScannerStats => ({
      engine,
      resolutionWidth: track?.getSettings().width ?? null,
      resolutionHeight: track?.getSettings().height ?? null,
      attemptsPerSecond: Math.round(attemptsPerSecond * 10) / 10,
      avgDecodeMs: decodeDurationsMs.length > 0 ? Math.round((decodeDurationsMs.reduce((a, b) => a + b, 0) / decodeDurationsMs.length) * 10) / 10 : null,
    }),
  };
}
