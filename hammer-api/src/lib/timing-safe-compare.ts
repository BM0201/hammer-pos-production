import { timingSafeEqual } from "node:crypto";

/**
 * Comparación de strings en tiempo constante — evita el side-channel de
 * timing de comparar secretos (ej. CRON_SECRET) con === directo. Si las
 * longitudes difieren, igual hace un trabajo equivalente (contra sí mismo)
 * para no filtrar la longitud real por el tiempo de respuesta.
 */
export function timingSafeEqualStrings(a: string, b: string): boolean {
  const bufA = Buffer.from(a);
  const bufB = Buffer.from(b);
  if (bufA.length !== bufB.length) {
    timingSafeEqual(bufA, bufA);
    return false;
  }
  return timingSafeEqual(bufA, bufB);
}
