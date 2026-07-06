/**
 * ════════════════════════════════════════════════════════════════
 * CLOUDFLARE TURNSTILE — verificación server-side del challenge
 *
 * Se activa en el login solo tras fallos repetidos para el mismo usuario
 * (ver `requiresLoginChallenge` en rate-limiter.ts). Si TURNSTILE_SECRET_KEY
 * no está configurada, la funcionalidad queda deshabilitada y el login
 * funciona igual que antes.
 *
 * Env: TURNSTILE_SECRET_KEY (backend). El frontend usa
 * NEXT_PUBLIC_TURNSTILE_SITE_KEY para renderizar el widget.
 * ════════════════════════════════════════════════════════════════
 */

const SITEVERIFY_URL = "https://challenges.cloudflare.com/turnstile/v0/siteverify";

export function isTurnstileConfigured(): boolean {
  return Boolean(process.env.TURNSTILE_SECRET_KEY?.trim());
}

/**
 * Valida un token de Turnstile contra la API de Cloudflare.
 * - Sin secret configurado → true (funcionalidad apagada, no bloquear).
 * - Token ausente/inválido → false.
 * - Error de red hablando con Cloudflare → false (fail-closed: este chequeo
 *   solo corre cuando la cuenta ya está bajo intentos fallidos repetidos,
 *   ahí preferimos bloquear a dejar pasar un bot).
 */
export async function verifyTurnstileToken(
  token: string | undefined,
  remoteIp?: string,
): Promise<boolean> {
  const secret = process.env.TURNSTILE_SECRET_KEY?.trim();
  if (!secret) return true;
  if (!token?.trim()) return false;

  try {
    const body = new URLSearchParams({ secret, response: token });
    if (remoteIp && remoteIp !== "unknown") {
      body.set("remoteip", remoteIp);
    }

    const response = await fetch(SITEVERIFY_URL, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body,
    });

    if (!response.ok) {
      console.error(`[turnstile] siteverify respondió ${response.status}`);
      return false;
    }

    const json = (await response.json()) as { success?: boolean; "error-codes"?: string[] };
    if (json.success !== true) {
      console.warn("[turnstile] Token rechazado", json["error-codes"] ?? []);
      return false;
    }

    return true;
  } catch (error) {
    console.error("[turnstile] Error verificando token", error);
    return false;
  }
}
