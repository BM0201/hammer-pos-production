import { prisma } from "@/lib/prisma";

const WINDOW_MINUTES = 15;
const WINDOW_MS = WINDOW_MINUTES * 60 * 1000;

/** Límites por tipo de clave */
const LIMITS: Record<string, number> = {
  "pair":            5,   // username:ip   — más estricto
  "user_global":    10,   // u:<username>  — previene credential stuffing
  "ip_global":      30,   // i:<ip>        — previene escaneo distribuido
};

async function countRecentFailed(identifier: string): Promise<number> {
  return prisma.loginAttempt.count({
    where: {
      identifier,
      attemptedAt: { gte: new Date(Date.now() - WINDOW_MS) },
      success: false,
    },
  });
}

async function oldestInWindow(identifier: string): Promise<Date | null> {
  const row = await prisma.loginAttempt.findFirst({
    where: {
      identifier,
      attemptedAt: { gte: new Date(Date.now() - WINDOW_MS) },
      success: false,
    },
    orderBy: { attemptedAt: "asc" },
    select: { attemptedAt: true },
  });
  return row?.attemptedAt ?? null;
}

function retryAfter(oldest: Date | null): number {
  if (!oldest) return WINDOW_MINUTES * 60;
  return Math.max(0, Math.ceil((oldest.getTime() + WINDOW_MS - Date.now()) / 1000));
}

export type RateLimitResult =
  | { allowed: true }
  | { allowed: false; reason: "pair" | "user_global" | "ip_global"; retryAfterSeconds: number };

/**
 * Verifica los tres niveles de rate limit para un intento de login:
 *   1. `username:ip`  — 5 fallos / 15 min  (más restrictivo)
 *   2. `u:<username>` — 10 fallos / 15 min  (global por usuario)
 *   3. `i:<ip>`       — 30 fallos / 15 min  (global por IP)
 */
export async function checkLoginRateLimit(
  username: string,
  ip: string,
): Promise<RateLimitResult> {
  const pairKey = `${username}:${ip}`;
  const userKey = `u:${username}`;
  const ipKey   = `i:${ip}`;

  const [pairCount, userCount, ipCount] = await Promise.all([
    countRecentFailed(pairKey),
    countRecentFailed(userKey),
    countRecentFailed(ipKey),
  ]);

  if (pairCount >= LIMITS.pair) {
    return { allowed: false, reason: "pair", retryAfterSeconds: retryAfter(await oldestInWindow(pairKey)) };
  }
  if (userCount >= LIMITS.user_global) {
    return { allowed: false, reason: "user_global", retryAfterSeconds: retryAfter(await oldestInWindow(userKey)) };
  }
  if (ipCount >= LIMITS.ip_global) {
    return { allowed: false, reason: "ip_global", retryAfterSeconds: retryAfter(await oldestInWindow(ipKey)) };
  }

  return { allowed: true };
}

/**
 * Umbral de fallos recientes por usuario a partir del cual el login exige
 * resolver un challenge (Cloudflare Turnstile) antes de reintentar.
 * Frena bots ANTES del límite duro y evita que rotar de IP lo esquive
 * (el conteo es por username, no por IP).
 */
const CHALLENGE_AFTER_FAILURES = 2;

/**
 * ¿Debe exigirse challenge (Turnstile) para el próximo intento de login de
 * este usuario? True cuando acumuló >= 2 fallos recientes en la ventana.
 */
export async function requiresLoginChallenge(username: string): Promise<boolean> {
  const failures = await countRecentFailed(`u:${username}`);
  return failures >= CHALLENGE_AFTER_FAILURES;
}

/**
 * Registra un intento de login en los tres identificadores.
 * Si el intento fue exitoso, limpia los fallos recientes para ese par y usuario.
 */
export async function recordLoginAttempt(
  username: string,
  ip: string,
  success: boolean,
): Promise<void> {
  const pairKey = `${username}:${ip}`;
  const userKey = `u:${username}`;
  const ipKey   = `i:${ip}`;

  await prisma.loginAttempt.createMany({
    data: [
      { identifier: pairKey, success },
      { identifier: userKey, success },
      { identifier: ipKey,   success },
    ],
  });

  if (success) {
    const windowStart = new Date(Date.now() - WINDOW_MS);
    await prisma.loginAttempt.deleteMany({
      where: {
        identifier: { in: [pairKey, userKey] },
        attemptedAt: { gte: windowStart },
        success: false,
      },
    });
  }
}

/**
 * Limpieza periódica de intentos antiguos (llamar desde cron).
 * Delegada a la política central (90 días — modules/retention/policy.ts), la
 * misma que aplica /api/cron/cleanup, para que no existan dos umbrales.
 */
export async function cleanupOldAttempts(): Promise<void> {
  const { LOGIN_ATTEMPT_RETENTION_DAYS, retentionCutoff } = await import("@/modules/retention/policy");
  await prisma.loginAttempt.deleteMany({
    where: { attemptedAt: { lt: retentionCutoff(LOGIN_ATTEMPT_RETENTION_DAYS) } },
  });
}
