/**
 * Línea base por cámara (prompt §3): "una bodega quieta de noche tiene
 * cuadros casi idénticos de forma legítima" — sin esto, FROZEN y BLURRY
 * disparan sobre cualquier cámara tranquila. Se aprende de la propia
 * cámara, nunca de un umbral global.
 *
 * Estilo puro/inmutable, igual que el resto del repo: observe() devuelve un
 * baseline NUEVO en vez de mutar — el llamador decide cuándo persistir.
 */

const MAX_SAMPLES = 500; // ~8h a un ciclo por minuto; suficiente para aprender el patrón sin crecer sin límite.
const MIN_SAMPLES_TO_CALIBRATE = 30;

export type CameraBaseline = {
  frameDiffSamples: number[];
  laplacianSamples: number[];
};

export function createBaseline(): CameraBaseline {
  return { frameDiffSamples: [], laplacianSamples: [] };
}

function pushSample(samples: number[], value: number): number[] {
  const next = [...samples, value];
  return next.length > MAX_SAMPLES ? next.slice(next.length - MAX_SAMPLES) : next;
}

export function observe(baseline: CameraBaseline, input: { frameDifference: number; laplacianVariance: number }): CameraBaseline {
  return {
    frameDiffSamples: pushSample(baseline.frameDiffSamples, input.frameDifference),
    laplacianSamples: pushSample(baseline.laplacianSamples, input.laplacianVariance),
  };
}

export function isCalibrated(baseline: CameraBaseline): boolean {
  return baseline.frameDiffSamples.length >= MIN_SAMPLES_TO_CALIBRATE
    && baseline.laplacianSamples.length >= MIN_SAMPLES_TO_CALIBRATE;
}

function meanStddev(values: number[]): { mean: number; stddev: number } {
  if (values.length === 0) return { mean: 0, stddev: 0 };
  const mean = values.reduce((a, b) => a + b, 0) / values.length;
  const variance = values.reduce((acc, v) => acc + (v - mean) ** 2, 0) / values.length;
  return { mean, stddev: Math.sqrt(variance) };
}

// Umbrales absolutos usados mientras la cámara no tiene suficiente historia
// (instalación reciente) — conservadores a propósito: mejor no avisar de
// más los primeros días que generar ruido antes de que haya línea base.
const DEFAULT_FROZEN_FLOOR = 0.001;
const DEFAULT_BLURRY_FLOOR = 15;

/**
 * Un cuadro se considera "sospechoso de FROZEN" cuando su diferencia contra
 * el anterior cae muy por debajo de lo que esta cámara considera normal
 * incluso en sus momentos más quietos — no un umbral fijo compartido entre
 * todas las cámaras.
 */
export function frozenThreshold(baseline: CameraBaseline): number {
  if (!isCalibrated(baseline)) return DEFAULT_FROZEN_FLOOR;
  const { mean, stddev } = meanStddev(baseline.frameDiffSamples);
  // La cola inferior de la distribución normal de esta cámara, con un piso
  // absoluto: nunca por encima del umbral por defecto (evita que una cámara
  // con mucho movimiento constante "aprenda" un umbral tan alto que un
  // freeze real no lo cruce).
  return Math.min(DEFAULT_FROZEN_FLOOR, Math.max(0, mean - 3 * stddev));
}

/** Análogo a frozenThreshold, para nitidez (varianza del laplaciano). */
export function blurryThreshold(baseline: CameraBaseline): number {
  if (!isCalibrated(baseline)) return DEFAULT_BLURRY_FLOOR;
  const { mean, stddev } = meanStddev(baseline.laplacianSamples);
  return Math.max(DEFAULT_BLURRY_FLOOR, mean - 3 * stddev);
}
