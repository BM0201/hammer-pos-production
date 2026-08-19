import { meanLuminance, laplacianVariance, frameDifference, luminanceHistogram, histogramDistance, type GrayFrame } from "./frame-metrics.ts";
import { frozenThreshold, blurryThreshold, type CameraBaseline } from "./baseline.ts";
import { isWithinExpectedLitHours, type BranchLitHours } from "./schedule.ts";

export const CAMERA_HEALTH_STATES = [
  "OFFLINE", "NO_STREAM", "NO_FRAMES", "FROZEN", "BLACK", "BLURRY", "MOVED", "DEGRADED", "OK",
] as const;
export type CameraHealthState = (typeof CAMERA_HEALTH_STATES)[number];

export type ConnectivityProbe = {
  icmpReachable: boolean;
  tcpReachable: boolean;
  rtspOpened: boolean;
};

export type StreamProfile = {
  expectedBitrateKbps: number;
  expectedWidth: number;
  expectedHeight: number;
  actualBitrateKbps: number;
  actualWidth: number;
  actualHeight: number;
};

// Por debajo de este porcentaje del perfil declarado (bitrate o resolución),
// se considera DEGRADED. 60% deja margen a variación normal de red sin
// disparar por ruido.
const DEGRADED_RATIO_FLOOR = 0.6;
const BLACK_LUMINANCE_FLOOR = 20; // 0-255
const MOVED_HISTOGRAM_DISTANCE_FLOOR = 0.35; // 0-1, ver frame-metrics.histogramDistance

export type ClassifyInput = {
  connectivity: ConnectivityProbe;
  /** null si no llegó ningún cuadro en este ciclo (aunque RTSP haya abierto). */
  frame: GrayFrame | null;
  /** Cuadro del ciclo anterior, para FROZEN/MOVED. null en el primer ciclo. */
  previousFrame: GrayFrame | null;
  baseline: CameraBaseline;
  localHour: number;
  litHours: BranchLitHours;
  streamProfile: StreamProfile | null;
};

/**
 * Clasificación de UN ciclo de sondeo — sin memoria de ciclos anteriores más
 * allá del cuadro previo recibido explícitamente. La confirmación "sostenido
 * por N minutos/ciclos" que pide el prompt para FROZEN/MOVED es
 * responsabilidad del caller vía sustain.ts — mezclar ambas cosas acá haría
 * el clasificador con estado y mucho más difícil de probar.
 *
 * Orden de evaluación = orden de la tabla del prompt: gates de conectividad
 * primero, después señales dentro del stream. Primera que aplica, gana.
 */
export function classify(input: ClassifyInput): CameraHealthState {
  const { connectivity, frame, previousFrame, baseline, localHour, litHours, streamProfile } = input;

  if (!connectivity.icmpReachable && !connectivity.tcpReachable) return "OFFLINE";
  if (!connectivity.rtspOpened) return "NO_STREAM";
  if (!frame) return "NO_FRAMES";

  if (previousFrame && previousFrame.width === frame.width && previousFrame.height === frame.height) {
    const diff = frameDifference(frame, previousFrame);
    if (diff <= frozenThreshold(baseline)) return "FROZEN";

    const prevHist = luminanceHistogram(previousFrame);
    const currHist = luminanceHistogram(frame);
    if (histogramDistance(currHist, prevHist) >= MOVED_HISTOGRAM_DISTANCE_FLOOR) return "MOVED";
  }

  if (meanLuminance(frame) <= BLACK_LUMINANCE_FLOOR && isWithinExpectedLitHours(localHour, litHours)) {
    return "BLACK";
  }

  if (laplacianVariance(frame) <= blurryThreshold(baseline)) return "BLURRY";

  if (streamProfile) {
    const bitrateRatio = streamProfile.expectedBitrateKbps > 0
      ? streamProfile.actualBitrateKbps / streamProfile.expectedBitrateKbps
      : 1;
    const resolutionRatio = (streamProfile.expectedWidth * streamProfile.expectedHeight) > 0
      ? (streamProfile.actualWidth * streamProfile.actualHeight) / (streamProfile.expectedWidth * streamProfile.expectedHeight)
      : 1;
    if (bitrateRatio < DEGRADED_RATIO_FLOOR || resolutionRatio < DEGRADED_RATIO_FLOOR) return "DEGRADED";
  }

  return "OK";
}
