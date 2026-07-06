import { NextResponse, type NextRequest } from "next/server";

/**
 * Frontend (hammer-frontend) middleware.
 *
 * Scope: only protects the UI route surface. The backend (hammer-api) handles
 * its own auth/CSRF middleware.
 *
 * What this does:
 *  - Lets `_next/*`, static assets, and public pages through.
 *  - Lets `/api/*` requests through untouched (they are rewritten to the
 *    backend by `next.config.ts`).
 *  - Performs a SHALLOW cookie-presence check for `/app/*` pages. The HMAC
 *    of the session is validated by the backend on every API request, so
 *    we deliberately do NOT decode tokens here (no node:crypto, no DB).
 *  - Redirects authenticated users away from /login (cookie present).
 *  - Generates a per-request CSP nonce and sets the Content-Security-Policy
 *    header dynamically. In production, `script-src` uses
 *    `'nonce-...' 'strict-dynamic'` (NO 'unsafe-inline'); Next.js reads the
 *    CSP from the request headers and stamps the nonce on its own inline
 *    scripts. Custom inline scripts read the nonce via `headers()` →
 *    `x-nonce` (see src/app/layout.tsx). The rest of the security headers
 *    (HSTS, X-Frame-Options, etc.) still live in next.config.ts.
 *
 * Role-based redirects (master vs branch vs sysadmin) live in
 * `src/app/app/page.tsx`, which calls `GET /api/auth/session` and routes
 * the user to the correct landing page.
 */
// Páginas públicas (sin cookie de sesión): /login, /unauthorized, /forbidden,
// /health. No viven bajo /app, así que el gate de cookie no las toca; sí
// reciben CSP con nonce como cualquier página renderizada.
const SESSION_COOKIE = "__Host-hammer_session";

const isDev = process.env.NODE_ENV !== "production";

function buildCsp(nonce: string): string {
  // challenges.cloudflare.com: widget de Turnstile en el login (script + iframe
  // + verificación). fonts.googleapis.com/gstatic: @import de DM Mono en /login.
  const scriptSrc = isDev
    ? "script-src 'self' 'unsafe-inline' 'unsafe-eval' https://challenges.cloudflare.com"
    : `script-src 'self' 'nonce-${nonce}' 'strict-dynamic' https://challenges.cloudflare.com`;

  return [
    "default-src 'self'",
    scriptSrc,
    // 'unsafe-inline' se mantiene en style-src: la app usa <style> inline en
    // varios componentes (login, modales). Los style={{...}} de React son
    // atributos, no los bloquea style-src.
    "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com",
    "img-src 'self' data: https:",
    "font-src 'self' data: https://fonts.gstatic.com",
    "connect-src 'self' https://challenges.cloudflare.com",
    "frame-src https://challenges.cloudflare.com",
    "frame-ancestors 'none'",
    "base-uri 'self'",
    "form-action 'self'",
  ].join("; ");
}

export function middleware(request: NextRequest) {
  const { pathname } = request.nextUrl;

  // Static assets
  if (pathname.startsWith("/_next") || pathname.includes(".")) {
    return NextResponse.next();
  }

  // API requests → rewrites send them to the backend
  if (pathname.startsWith("/api/")) {
    return NextResponse.next();
  }

  const hasSession = request.cookies.has(SESSION_COOKIE);

  // Gate /app/* on cookie presence (a stale cookie will be cleared by the
  // backend's 401 on the first apiFetch). Las PUBLIC_PATHS no pasan por aquí
  // (ninguna vive bajo /app) pero sí reciben CSP con nonce más abajo.
  if (!hasSession && pathname.startsWith("/app")) {
    const url = new URL("/login", request.url);
    return NextResponse.redirect(url);
  }

  // Already authenticated visitors should not see the login page.
  if (hasSession && pathname === "/login") {
    return NextResponse.redirect(new URL("/app", request.url));
  }

  // CSP con nonce por request para las páginas que sí se renderizan.
  const nonce = btoa(crypto.randomUUID());
  const csp = buildCsp(nonce);

  const requestHeaders = new Headers(request.headers);
  requestHeaders.set("x-nonce", nonce);
  // Next.js lee este header para poner el nonce en sus scripts inline.
  requestHeaders.set("Content-Security-Policy", csp);

  const response = NextResponse.next({ request: { headers: requestHeaders } });
  response.headers.set("Content-Security-Policy", csp);
  return response;
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico).*)"],
};
