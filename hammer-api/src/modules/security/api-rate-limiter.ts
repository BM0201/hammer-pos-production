/**
 * ════════════════════════════════════════════════════════════════
 * API RATE LIMITER — límites generales por tipo de endpoint
 *
 * Complementa (NO reemplaza) a `rate-limiter.ts`:
 *  - `checkLoginRateLimit` sigue en Postgres: volumen bajo, ya probado,
 *    y necesita persistencia por ventana de 15 min.
 *  - Este módulo cubre el resto del API con Upstash Redis (sliding window),
 *    apto para el volumen alto de un POS sin escribir en la BD por request.
 *
 * Backend: Upstash Redis (integración nativa de Vercel, fetch-based, corre
 * en edge y node). Variables de entorno:
 *   UPSTASH_REDIS_REST_URL, UPSTASH_REDIS_REST_TOKEN
 *
 * Si Redis no está configurado o falla, el limiter FALLA ABIERTO (permite
 * la request y loguea una advertencia una sola vez): la disponibilidad del
 * POS pesa más que el límite, y el login conserva su propio limiter en BD.
 * ════════════════════════════════════════════════════════════════
 */
import { Ratelimit } from "@upstash/ratelimit";
import { Redis } from "@upstash/redis";

export type ApiRateLimitPolicy = {
  /** Nombre del grupo de límite (aparece en la clave de Redis) */
  name: "public" | "mutation" | "analytics" | "import";
  /** Cómo se identifica al cliente */
  scope: "user" | "ip";
  limit: number;
  windowSeconds: number;
};

const SAFE_METHODS = new Set(["GET", "HEAD", "OPTIONS"]);

/** Endpoints públicos sin sesión — limitados por IP */
const PUBLIC_RATE_LIMITED_PATHS = new Set(["/api/auth/csrf", "/api/auth/session"]);

/**
 * Endpoints de reportes/analytics ($queryRaw / agregaciones pesadas).
 * ⚠️ Si agregas una ruta de reportes fuera de estos prefijos, agrégala aquí
 * y a api-rate-limiter.test.ts — si no, queda sin límite (los GETs generales
 * no se limitan).
 */
const ANALYTICS_PATH_PREFIXES = [
  "/api/reports/",
  "/api/analytics/",
  "/api/master/analytics/",
  "/api/cash-closure/reports",
];

function isAnalyticsPath(pathname: string): boolean {
  if (ANALYTICS_PATH_PREFIXES.some((prefix) => pathname.startsWith(prefix))) return true;
  // /api/branch/operations/[id]/daily-report — reporte diario pesado
  return pathname.endsWith("/daily-report");
}

const POLICIES: Record<ApiRateLimitPolicy["name"], ApiRateLimitPolicy> = {
  // Punto de partida — ajustar según uso real observado en producción.
  public: { name: "public", scope: "ip", limit: 30, windowSeconds: 60 },
  mutation: { name: "mutation", scope: "user", limit: 60, windowSeconds: 60 },
  analytics: { name: "analytics", scope: "user", limit: 20, windowSeconds: 60 },
  import: { name: "import", scope: "user", limit: 5, windowSeconds: 60 },
};

/**
 * Clasifica una request del API en una política de rate limit.
 * Devuelve `null` cuando la request no se limita aquí:
 *  - /api/auth/login → tiene su propio limiter en BD (checkLoginRateLimit)
 *  - /api/cron/* → protegidos por CRON_SECRET (machine-to-machine)
 *  - GETs autenticados generales → sin límite (el polling normal del POS
 *    los usa intensivamente; limitar aquí generaría falsos positivos)
 */
export function classifyApiRequest(pathname: string, method: string): ApiRateLimitPolicy | null {
  if (!pathname.startsWith("/api/")) return null;
  if (pathname === "/api/auth/login") return null;
  if (pathname.startsWith("/api/cron/") || pathname.startsWith("/api/system/cron/")) return null;

  if (PUBLIC_RATE_LIMITED_PATHS.has(pathname)) return POLICIES.public;

  if (pathname.startsWith("/api/master/import/excel")) return POLICIES.import;

  if (isAnalyticsPath(pathname)) return POLICIES.analytics;

  if (!SAFE_METHODS.has(method.toUpperCase())) return POLICIES.mutation;

  return null;
}

export type ApiRateLimitResult =
  | { allowed: true }
  | { allowed: false; retryAfterSeconds: number };

let _redis: Redis | null | undefined;
let _warnedNotConfigured = false;
const _limiters = new Map<string, Ratelimit>();

export function isApiRateLimiterConfigured(): boolean {
  return Boolean(
    process.env.UPSTASH_REDIS_REST_URL?.trim() && process.env.UPSTASH_REDIS_REST_TOKEN?.trim(),
  );
}

function getRedis(): Redis | null {
  if (_redis !== undefined) return _redis;
  if (!isApiRateLimiterConfigured()) {
    _redis = null;
    return null;
  }
  _redis = new Redis({
    url: process.env.UPSTASH_REDIS_REST_URL!,
    token: process.env.UPSTASH_REDIS_REST_TOKEN!,
  });
  return _redis;
}

function getLimiter(limit: number, windowSeconds: number): Ratelimit | null {
  const redis = getRedis();
  if (!redis) return null;

  const cacheKey = `${limit}:${windowSeconds}`;
  const existing = _limiters.get(cacheKey);
  if (existing) return existing;

  const limiter = new Ratelimit({
    redis,
    limiter: Ratelimit.slidingWindow(limit, `${windowSeconds} s`),
    prefix: "hammer:api-rl",
  });
  _limiters.set(cacheKey, limiter);
  return limiter;
}

/**
 * Verifica el rate limit para una clave (`<política>:<userId|ip>`).
 * Falla abierto si Redis no está configurado o no responde.
 */
export async function checkApiRateLimit(
  key: string,
  opts: { limit: number; windowSeconds: number },
): Promise<ApiRateLimitResult> {
  const limiter = getLimiter(opts.limit, opts.windowSeconds);
  if (!limiter) {
    if (!_warnedNotConfigured) {
      _warnedNotConfigured = true;
      console.warn(
        "[api-rate-limiter] UPSTASH_REDIS_REST_URL/TOKEN no configurados. Rate limiting general deshabilitado (fail-open).",
      );
    }
    return { allowed: true };
  }

  try {
    const result = await limiter.limit(key);
    if (result.success) return { allowed: true };

    const retryAfterSeconds = Math.max(1, Math.ceil((result.reset - Date.now()) / 1000));
    return { allowed: false, retryAfterSeconds };
  } catch (error) {
    console.error("[api-rate-limiter] Error consultando Redis; se permite la request (fail-open)", error);
    return { allowed: true };
  }
}

/**
 * Chequeo integrado para el middleware: clasifica y verifica en un paso.
 * `userId` es null para requests sin sesión (se usa la IP).
 */
export async function enforceApiRateLimit(input: {
  pathname: string;
  method: string;
  userId: string | null;
  ip: string;
}): Promise<{ policy: ApiRateLimitPolicy; result: ApiRateLimitResult } | null> {
  const policy = classifyApiRequest(input.pathname, input.method);
  if (!policy) return null;

  const identity = policy.scope === "user" ? input.userId ?? input.ip : input.ip;
  const result = await checkApiRateLimit(`${policy.name}:${identity}`, {
    limit: policy.limit,
    windowSeconds: policy.windowSeconds,
  });

  return { policy, result };
}
