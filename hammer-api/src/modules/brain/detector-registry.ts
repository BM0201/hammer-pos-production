/**
 * prompt-brain-centro-decisiones.md Fase 1 — las `key` de los detectores
 * reales (engine.ts), en un archivo propio para que engine.ts (que las usa
 * al armar el array de detectores) y service.ts (que las necesita en
 * expireStaleBrainDecisions, para saber si un detectorKey guardado "ya no
 * existe en el motor") no tengan que importarse en círculo entre sí.
 */
export const KNOWN_DETECTOR_KEYS = [
  "inventory-detector",
  "wac-health-detector",
  "reorder-detector",
  "pricing-detector",
  "cash-detector",
  "sales-detector",
  "dispatch-detector",
  "purchasing-detector",
  "security-detector",
  "system-detector",
  "ai-insights",
] as const;

export type KnownDetectorKey = (typeof KNOWN_DETECTOR_KEYS)[number];
