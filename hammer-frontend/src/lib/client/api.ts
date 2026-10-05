/**
 * Centralised client-side HTTP helper.
 *
 * This module contains the `apiFetch` function directly (not re-exported from
 * `@/lib/http`) to avoid pulling server-only dependencies (node:crypto via
 * csrf.ts → http.ts) into client bundles, which causes Webpack build failures.
 *
 * Usage:
 *   import { apiFetch } from "@/lib/client/api";
 */

// ─────────────────────────────────────────────────────────────────────────────
// CSRF token cache & helpers (client-side only)
// ─────────────────────────────────────────────────────────────────────────────

/** Module-level CSRF token cache (client-side only). */
let _csrfTokenCache: string | null = null;
const PUBLIC_MUTATION_PATHS = new Set(["/api/auth/login"]);

/**
 * Fetch a fresh CSRF token from the server.
 * Stores it in the module-level cache so subsequent calls reuse it.
 */
async function fetchCsrfToken(): Promise<string> {
  const res = await fetch("/api/auth/csrf", { credentials: "include" });
  if (!res.ok) throw new Error("Failed to obtain CSRF token");
  const json = (await res.json()) as ApiResponse<{ csrfToken: string }>;
  const data = unwrapApiData(json);
  _csrfTokenCache = data.csrfToken;
  return _csrfTokenCache;
}

function clearCsrfTokenCache(): void {
  _csrfTokenCache = null;
}

// ─────────────────────────────────────────────────────────────────────────────
// apiFetch
// ─────────────────────────────────────────────────────────────────────────────

export interface ApiFetchOptions extends Omit<RequestInit, "headers"> {
  headers?: Record<string, string>;
  /**
   * Evita la redirección global a /login cuando una llamada opcional recibe 401.
   * Úsalo únicamente para requests no críticos que pueden fallar sin invalidar la UI
   * actual, por ejemplo datos decorativos de la pantalla pública de login.
   */
  suppressAuthRedirect?: boolean;
  /**
   * prompt-seguridad-basica.md Fase 2 — por defecto, apiFetch deduplica
   * mutaciones IDÉNTICAS en vuelo (mismo método+URL+body): un doble click
   * que dispara dos requests antes de que la primera responda comparte la
   * MISMA respuesta en vez de pegarle al servidor dos veces. Pasar true solo
   * cuando dos llamadas con el mismo cuerpo son legítimamente independientes
   * (poco común).
   */
  allowDuplicate?: boolean;
}

export type ApiSuccess<T> = {
  ok: true;
  data: T;
};

export type ApiErrorBody = {
  code: string;
  message: string;
  details?: unknown;
};

export type ApiError = {
  ok: false;
  error: ApiErrorBody;
};

export type ApiResponse<T> = ApiSuccess<T> | ApiError;

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function getCsrfErrorCode(payload: unknown): string | undefined {
  if (!isObject(payload)) return undefined;

  if (typeof payload.reason === "string") {
    return payload.reason;
  }

  if (isObject(payload.error) && typeof payload.error.code === "string") {
    return payload.error.code;
  }

  return undefined;
}

export function unwrapApiData<T>(payload: ApiResponse<T> | T): T {
  if (isObject(payload) && payload.ok === true && "data" in payload) {
    return payload.data as T;
  }

  return payload as T;
}

// ─────────────────────────────────────────────────────────────────────────────
// Deduplicación de mutaciones en vuelo (prompt-seguridad-basica.md Fase 2)
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Clave pura para deduplicar una mutación en vuelo — exportada para poder
 * testearla sin red. `null` significa "nunca deduplicar esta llamada":
 * métodos seguros (GET/HEAD), o un body que no se puede serializar barato
 * y sin riesgo (FormData/Blob/ArrayBuffer/stream) — mejor no deduplicar que
 * arriesgar un falso-positivo comparando referencias de objeto.
 */
export function buildMutationDedupeKey(
  method: string,
  url: string,
  body: BodyInit | null | undefined,
): string | null {
  const m = method.toUpperCase();
  if (m === "GET" || m === "HEAD") return null;
  if (body == null) return `${m} ${url}`;
  if (typeof body === "string") return `${m} ${url}\n${body}`;
  return null;
}

/** Promesas de mutaciones actualmente en vuelo, por clave de deduplicación. */
const _inFlightMutations = new Map<string, Promise<Response>>();

/**
 * `apiFetch` — drop-in replacement for `fetch()` that:
 *  1. Automatically attaches the `x-csrf-token` header to mutating requests.
 *  2. On a 403 with `reason === "INVALID_CSRF_TOKEN"`, refreshes the CSRF
 *     token and retries the request **once**.
 *  3. Deduplica mutaciones IDÉNTICAS en vuelo (mismo método+URL+body): un
 *     doble click/reintento antes de que la primera respuesta llegue
 *     comparte la MISMA respuesta (clonada por llamador) en vez de disparar
 *     la operación dos veces contra el servidor.
 *
 * Safe methods (GET / HEAD / OPTIONS) skip CSRF handling entirely.
 */
export async function apiFetch(
  url: string,
  options: ApiFetchOptions = {},
): Promise<Response> {
  const { suppressAuthRedirect = false, allowDuplicate = false, ...fetchOptions } = options;
  const method = (fetchOptions.method ?? "GET").toUpperCase();

  const dedupeKey = allowDuplicate ? null : buildMutationDedupeKey(method, url, fetchOptions.body ?? null);
  if (!dedupeKey) {
    return performApiFetch(url, fetchOptions, method, suppressAuthRedirect);
  }

  let promise = _inFlightMutations.get(dedupeKey);
  if (!promise) {
    promise = performApiFetch(url, fetchOptions, method, suppressAuthRedirect);
    _inFlightMutations.set(dedupeKey, promise);
    // Limpia la entrada al asentarse (éxito o error) — nunca deja un registro
    // colgado que bloquearía reintentos legítimos futuros. La propia promesa
    // devuelta al llamador original no se toca acá (su rechazo sigue siendo
    // responsabilidad de quien llamó a apiFetch).
    promise
      .finally(() => {
        if (_inFlightMutations.get(dedupeKey) === promise) {
          _inFlightMutations.delete(dedupeKey);
        }
      })
      .catch(() => {});
  }

  // TODOS los llamadores (incluido el que disparó el fetch real) reciben un
  // clone — nunca la respuesta original sin clonar. Así el orden en que cada
  // llamador lee el body (json()/text()) no puede romper el clone() de otro:
  // clonar una Response no leída es seguro sin importar cuántas veces se haga.
  const shared = await promise;
  return shared.clone();
}

async function performApiFetch(
  url: string,
  fetchOptions: Omit<ApiFetchOptions, "suppressAuthRedirect" | "allowDuplicate">,
  method: string,
  suppressAuthRedirect: boolean,
): Promise<Response> {
  const isSafe = ["GET", "HEAD", "OPTIONS"].includes(method);
  const pathname = typeof window === "undefined" ? url : new URL(url, window.location.origin).pathname;
  const requiresCsrf = !isSafe && !PUBLIC_MUTATION_PATHS.has(pathname);

  // Ensure we have a CSRF token for mutating requests
  if (requiresCsrf && !_csrfTokenCache) {
    await fetchCsrfToken();
  }

  const buildHeaders = (): Record<string, string> => {
    const h: Record<string, string> = {
      "Content-Type": "application/json",
      ...fetchOptions.headers,
    };
    if (requiresCsrf && _csrfTokenCache) {
      h["x-csrf-token"] = _csrfTokenCache;
    }
    return h;
  };

  let res = await fetch(url, {
    ...fetchOptions,
    credentials: fetchOptions.credentials ?? "include",
    headers: buildHeaders(),
  });

  // A successful login changes the authenticated user/session. Any CSRF token
  // cached for the previous session must not be reused for the first mutation
  // after login, especially the mandatory first-password-change flow.
  if (pathname === "/api/auth/login" && res.ok) {
    clearCsrfTokenCache();
  }

  // If CSRF was rejected, refresh token and retry exactly once
  if (requiresCsrf && res.status === 403) {
    try {
      const body = await res.clone().json();
      if (getCsrfErrorCode(body) === "INVALID_CSRF_TOKEN") {
        // Token expired or invalid — clear cache so we fetch a fresh one on retry.
        clearCsrfTokenCache();
        await fetchCsrfToken();
        res = await fetch(url, {
          ...fetchOptions,
          credentials: fetchOptions.credentials ?? "include",
          headers: buildHeaders(),
        });
      }
    } catch {
      // If we can't parse the body, just return the original response
    }
  }

  // Tokens are reusable until TTL — do NOT clear cache on successful mutations.
  // Only clear on 401 (session gone) so the next mutation gets a fresh token
  // for the new session.

  if (typeof window !== "undefined" && res.status === 401 && !suppressAuthRedirect && pathname !== "/api/auth/session" && pathname !== "/api/auth/login") {
    clearCsrfTokenCache();
    window.location.assign("/login");
  }

  if (typeof window !== "undefined" && res.status === 403) {
    window.dispatchEvent(new CustomEvent("hammer:access-changed", { detail: { pathname } }));
  }

  return res;
}
