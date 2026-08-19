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

/**
 * `apiFetch` — drop-in replacement for `fetch()` that:
 *  1. Automatically attaches the `x-csrf-token` header to mutating requests.
 *  2. On a 403 with `reason === "INVALID_CSRF_TOKEN"`, refreshes the CSRF
 *     token and retries the request **once**.
 *
 * Safe methods (GET / HEAD / OPTIONS) skip CSRF handling entirely.
 */
export async function apiFetch(
  url: string,
  options: ApiFetchOptions = {},
): Promise<Response> {
  const { suppressAuthRedirect = false, ...fetchOptions } = options;
  const method = (fetchOptions.method ?? "GET").toUpperCase();
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
