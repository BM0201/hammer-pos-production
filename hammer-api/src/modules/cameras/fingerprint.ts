/**
 * Constantes de fingerprint compartidas entre apertura y resolución — el
 * bug que dejó las decisiones del auto-cierre de caja abiertas para
 * siempre fue exactamente esto: una se creaba con makeDecisionFingerprint
 * y la otra se buscaba con un literal sin hashear. Una sola función acá,
 * usada en los dos lados del ciclo (ver service.ts).
 */
import { makeDecisionFingerprint } from "@/modules/brain/scoring";

export function cameraDecisionFingerprint(cameraId: string): string {
  return makeDecisionFingerprint(["camera", "health", cameraId]);
}

export function branchInfraDecisionFingerprint(branchId: string): string {
  return makeDecisionFingerprint(["camera", "infra", branchId]);
}

export function branchAgentUnreachableFingerprint(branchId: string): string {
  return makeDecisionFingerprint(["camera", "agent-unreachable", branchId]);
}
