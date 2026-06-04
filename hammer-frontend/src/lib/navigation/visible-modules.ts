import type { SessionPayload } from "@/types/auth";

export function getEffectiveCapabilitySet(session: Pick<SessionPayload, "effectiveCapabilities"> | null) {
  return new Set(session?.effectiveCapabilities ?? []);
}

export function hasEffectiveCapability(
  session: Pick<SessionPayload, "effectiveCapabilities"> | null,
  capabilities: readonly string[],
) {
  const effectiveCapabilities = getEffectiveCapabilitySet(session);
  if (effectiveCapabilities.size === 0) return true;
  return capabilities.some((capability) => effectiveCapabilities.has(capability));
}
