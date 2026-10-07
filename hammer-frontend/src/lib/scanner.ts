/**
 * lib/scanner.ts — lector de código de barras/QR por cámara.
 *
 * Requisito citado por prompt-alta-productos-qr.md ("el commit 1 del
 * prompt del lector de cámara") — no existía ningún prompt previo con su
 * especificación exacta, así que este módulo se diseñó desde cero, en
 * sincronía con lo que ese doc ya daba por sentado: un normalizador
 * (trim + sin espacios) y un debounce de 1.5s para ignorar el mismo código
 * repetido entre cuadros continuos de cámara.
 *
 * `@zxing/browser` decodifica EAN-13/UPC/Code128 (códigos de fábrica) y QR
 * (nuestras propias etiquetas HMR-) por igual — una librería solo-QR no
 * cubriría el caso "cemento, pintura, tornillería empacada" del doc.
 */
import { BrowserMultiFormatReader, type IScannerControls } from "@zxing/browser";
import { NotFoundException, type Exception } from "@zxing/library";

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

export type ScannerHandle = {
  stop: () => void;
};

export type StartContinuousScanOptions = {
  videoElement: HTMLVideoElement;
  /** Id de cámara (MediaDeviceInfo.deviceId); sin esto, zxing prefiere la trasera si hay varias. */
  deviceId?: string;
  /** Texto CRUDO (sin normalizar) de cada lectura exitosa — el caller decide cuándo normalizar/debounce, igual que el lector USB entrando por el mismo campo Código. */
  onDecode: (rawText: string) => void;
  /** Solo errores REALES (permiso denegado, cámara ocupada) — "no hay código en este cuadro" es el caso normal entre lecturas y nunca llega acá. */
  onError?: (error: unknown) => void;
};

/**
 * Arranca el lector en modo CONTINUO sobre un <video> ya montado en el DOM.
 * Nunca lanza de forma síncrona: cualquier falla (permiso denegado, sin
 * cámara) llega por `onError`, nunca por throw — así el caller no necesita
 * un try/catch propio alrededor de una función que en los hechos es
 * asíncrona por dentro.
 */
export function startContinuousScan(options: StartContinuousScanOptions): ScannerHandle {
  const reader = new BrowserMultiFormatReader();
  let controls: IScannerControls | null = null;
  let stopped = false;

  reader
    .decodeFromVideoDevice(options.deviceId, options.videoElement, (result, error) => {
      if (stopped) return;
      if (result) {
        options.onDecode(result.getText());
        return;
      }
      if (error && !(error instanceof NotFoundException)) {
        options.onError?.(error as Exception);
      }
    })
    .then((c) => {
      if (stopped) {
        c.stop();
        return;
      }
      controls = c;
    })
    .catch((error: unknown) => {
      options.onError?.(error);
    });

  return {
    stop: () => {
      stopped = true;
      controls?.stop();
    },
  };
}
