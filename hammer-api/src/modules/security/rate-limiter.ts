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
  | { allowed: true; userFailures: number }
  | { allowed: false; reason: "pair" | "user_global" | "ip_global"; retryAfterSeconds: number };

/**
 * Umbral de fallos recientes por usuario a partir del cual el login exige
 * resolver un challenge (Cloudflare Turnstile) antes de reintentar.
 * Frena bots ANTES del límite duro y evita que rotar de IP lo esquive
 * (el conteo es por username, no por IP). El route de login lo compara
 * contra `userFailures` que checkLoginRateLimit ya calculó — sin COUNTs
 * adicionales a la BD.
 */
export const LOGIN_CHALLENGE_AFTER_FAILURES = 2;

/**
 * Verifica los tres niveles de rate limit para un intento de login:
 *   1. `username:ip`  — 5 fallos / 15 min  (más restrictivo)
 *   2. `u:<username>` — 10 fallos / 15 min  (global por usuario)
 *   3. `i:<ip>`       — 30 fallos / 15 min  (global por IP)
 *
 * Cuando permite el intento, expone `userFailures` (fallos recientes por
 * username) para que el caller decida si exige challenge sin re-consultar.
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

  return { allowed: true, userFailures: userCount };
}

// ── Re-autenticación (desbloqueo por inactividad en terminales POS) ────────
// Namespace propio (`reauth:<userId>`) en la misma tabla loginAttempt: los
// fallos de desbloqueo NO cuentan contra los límites del login normal ni
// activan el challenge de Turnstile, y la retención (90 días) ya los cubre.

const REAUTH_LIMIT = 5;

export type ReauthRateLimitResult =
  | { allowed: true }
  | { allowed: false; retryAfterSeconds: number };

/** Límite de intentos de re-autenticación: 5 fallos / 15 min por usuario. */
export async function checkReauthRateLimit(userId: string): Promise<ReauthRateLimitResult> {
  const key = `reauth:${userId}`;
  const failures = await countRecentFailed(key);
  if (failures >= REAUTH_LIMIT) {
    return { allowed: false, retryAfterSeconds: retryAfter(await oldestInWindow(key)) };
  }
  return { allowed: true };
}

/** Registra un intento de re-autenticación; el éxito limpia los fallos recientes. */
export async function recordReauthAttempt(userId: string, success: boolean): Promise<void> {
  const key = `reauth:${userId}`;
  await prisma.loginAttempt.create({ data: { identifier: key, success } });

  if (success) {
    await prisma.loginAttempt.deleteMany({
      where: {
        identifier: key,
        attemptedAt: { gte: new Date(Date.now() - WINDOW_MS) },
        success: false,
      },
    });
  }
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
