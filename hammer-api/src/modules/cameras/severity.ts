import type { CameraLocation } from "@prisma/client";
import type { BrainDecisionSeverity } from "@prisma/client";

/**
 * Severidad por UBICACIÓN, no por tipo de falla (prompt §4.1): una cámara
 * caída sobre la caja o el patio de despacho pesa más que una de pasillo,
 * sin importar si es OFFLINE o BLURRY.
 */
export function severityForCameraLocation(location: CameraLocation): BrainDecisionSeverity {
  switch (location) {
    case "CAJA":
      return "CRITICAL";
    case "DESPACHO":
      return "HIGH";
    case "PATIO":
      return "MEDIUM";
    case "PASILLO":
    case "OTRO":
      return "LOW";
  }
}
