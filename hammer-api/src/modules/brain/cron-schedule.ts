/**
 * prompt-brain-centro-decisiones.md Fase 2.3 — "próximo escaneo programado,
 * calculado del cron", no un valor fijo aparte que se desincroniza del
 * `vercel.json` real. Si esa expresión cambia, esto también hay que
 * actualizarlo — es la MISMA regla, escrita dos veces porque vercel.json no
 * se puede importar desde código de runtime.
 *
 * vercel.json: "35 0-3,12-23 * * *" (hora UTC) = cada hora de 6:35 a 21:35,
 * hora de Managua (UTC-6 fijo, sin horario de verano).
 */
const CRON_HOURS_UTC = [0, 1, 2, 3, 12, 13, 14, 15, 16, 17, 18, 19, 20, 21, 22, 23];
const CRON_MINUTE_UTC = 35;

export function nextScheduledScanAt(now: Date): Date {
  const candidate = new Date(now);
  candidate.setUTCMinutes(CRON_MINUTE_UTC, 0, 0);
  if (candidate.getTime() <= now.getTime()) candidate.setUTCHours(candidate.getUTCHours() + 1);
  while (!CRON_HOURS_UTC.includes(candidate.getUTCHours())) {
    candidate.setUTCHours(candidate.getUTCHours() + 1);
  }
  return candidate;
}
