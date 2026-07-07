/**
 * IP del cliente detrás del proxy de Vercel. Única fuente para parsear
 * x-forwarded-for / x-real-ip — no dupliques esta lógica en rutas.
 */
export function getClientIp(request: Request): string {
  const forwardedFor = request.headers.get("x-forwarded-for");
  const forwardedIp = forwardedFor?.split(",")[0]?.trim();
  if (forwardedIp) return forwardedIp;

  const realIp = request.headers.get("x-real-ip")?.trim();
  return realIp || "unknown";
}
