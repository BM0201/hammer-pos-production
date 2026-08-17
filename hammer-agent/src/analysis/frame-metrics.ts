/**
 * Aritmética pura sobre un cuadro ya reducido a escala de grises pequeña
 * (64×64 alcanza y sobra — ver adenda §1). Sin OpenCV ni `sharp`: con el
 * cuadro ya decodificado por ffmpeg, estas cuentas son suficientes.
 *
 * Formato de cuadro: Uint8Array row-major, 1 byte por píxel (0-255), tamaño
 * width*height. La extracción real (ffmpeg -> buffer) vive en capture.ts,
 * fuera de este módulo — acá no hay E/S, todo es data-in/data-out.
 */

export type GrayFrame = { width: number; height: number; pixels: Uint8Array };

function assertFrame(frame: GrayFrame) {
  if (frame.pixels.length !== frame.width * frame.height) {
    throw new Error("INVALID_FRAME: pixels.length no coincide con width*height");
  }
}

/** Luminancia media, 0-255. Base de la detección de BLACK. */
export function meanLuminance(frame: GrayFrame): number {
  assertFrame(frame);
  if (frame.pixels.length === 0) return 0;
  let sum = 0;
  for (let i = 0; i < frame.pixels.length; i += 1) sum += frame.pixels[i];
  return sum / frame.pixels.length;
}

/**
 * Varianza del laplaciano — proxy estándar de nitidez. Un cuadro desenfocado
 * tiene poco detalle de alta frecuencia, así que el laplaciano (que resalta
 * bordes) tiene poca varianza. Kernel de 4 vecinos: [0,1,0;1,-4,1;0,1,0],
 * solo sobre píxeles interiores (evita casos de borde en una imagen 64×64).
 */
export function laplacianVariance(frame: GrayFrame): number {
  assertFrame(frame);
  const { width, height, pixels } = frame;
  if (width < 3 || height < 3) return 0;

  const values: number[] = [];
  for (let y = 1; y < height - 1; y += 1) {
    for (let x = 1; x < width - 1; x += 1) {
      const idx = y * width + x;
      const lap =
        -4 * pixels[idx] +
        pixels[idx - 1] +
        pixels[idx + 1] +
        pixels[idx - width] +
        pixels[idx + width];
      values.push(lap);
    }
  }
  if (values.length === 0) return 0;

  const mean = values.reduce((a, b) => a + b, 0) / values.length;
  const variance = values.reduce((acc, v) => acc + (v - mean) ** 2, 0) / values.length;
  return variance;
}

/**
 * Diferencia media absoluta entre dos cuadros del mismo tamaño, normalizada
 * a 0-1. Cerca de 0 durante varios ciclos seguidos = FROZEN. Requiere mismo
 * width/height — lanza si no coinciden (comparar cuadros de fuentes
 * distintas es un error del caller, no un caso a tolerar en silencio).
 */
export function frameDifference(a: GrayFrame, b: GrayFrame): number {
  assertFrame(a);
  assertFrame(b);
  if (a.width !== b.width || a.height !== b.height) {
    throw new Error("FRAME_SIZE_MISMATCH: no se puede comparar cuadros de tamaños distintos");
  }
  if (a.pixels.length === 0) return 0;
  let sum = 0;
  for (let i = 0; i < a.pixels.length; i += 1) sum += Math.abs(a.pixels[i] - b.pixels[i]);
  return sum / a.pixels.length / 255;
}

/** Histograma normalizado de luminancia (bins baldes, suma = 1). */
export function luminanceHistogram(frame: GrayFrame, bins = 16): number[] {
  assertFrame(frame);
  const counts = new Array(bins).fill(0);
  const bucketSize = 256 / bins;
  for (let i = 0; i < frame.pixels.length; i += 1) {
    const bucket = Math.min(bins - 1, Math.floor(frame.pixels[i] / bucketSize));
    counts[bucket] += 1;
  }
  const total = frame.pixels.length || 1;
  return counts.map((c) => c / total);
}

/**
 * Distancia de variación total entre dos histogramas normalizados: mitad de
 * la suma de diferencias absolutas. Va de 0 (idénticos) a 1 (disjuntos).
 * Un salto abrupto y sostenido = MOVED (cambió la escena).
 */
export function histogramDistance(a: number[], b: number[]): number {
  if (a.length !== b.length) {
    throw new Error("HISTOGRAM_SIZE_MISMATCH: los histogramas deben tener el mismo número de bins");
  }
  let sum = 0;
  for (let i = 0; i < a.length; i += 1) sum += Math.abs(a[i] - b[i]);
  return sum / 2;
}
