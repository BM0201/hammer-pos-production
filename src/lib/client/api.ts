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

/**
 * Fetch a fresh CSRF token from the server.
 * Stores it in the module-level cache so subsequent calls reuse it.
 */
async function fetchCsrfToken(): Promise<string> {
  const res = await fetch("/api/auth/csrf", { credentials: "include" });
  if (!res.ok) throw new Error("Failed to obtain CSRF token");
  const data = (await res.json()) as { csrfToken: string };
  _csrfTokenCache = data.csrfToken;
  return _csrfTokenCache;
}

// ─────────────────────────────────────────────────────────────────────────────
// apiFetch
// ─────────────────────────────────────────────────────────────────────────────

export interface ApiFetchOptions extends Omit<RequestInit, "headers"> {
  headers?: Record<string, string>;
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
  const method = (options.method ?? "GET").toUpperCase();
  const isSafe = ["GET", "HEAD", "OPTIONS"].includes(method);

  // Ensure we have a CSRF token for mutating requests
  if (!isSafe && !_csrfTokenCache) {
    await fetchCsrfToken();
  }

  const buildHeaders = (): Record<string, string> => {
    const h: Record<string, string> = {
      "Content-Type": "application/json",
      ...options.headers,
    };
    if (!isSafe && _csrfTokenCache) {
      h["x-csrf-token"] = _csrfTokenCache;
    }
    return h;
  };

  let res = await fetch(url, {
    ...options,
    credentials: options.credentials ?? "include",
    headers: buildHeaders(),
  });

  // If CSRF was rejected, refresh token and retry exactly once
  if (!isSafe && res.status === 403) {
    try {
      const body = (await res.clone().json()) as { reason?: string };
      if (body.reason === "INVALID_CSRF_TOKEN") {
        await fetchCsrfToken();
        res = await fetch(url, {
          ...options,
          credentials: options.credentials ?? "include",
          headers: buildHeaders(),
        });
      }
    } catch {
      // If we can't parse the body, just return the original response
    }
  }

  return res;
}
