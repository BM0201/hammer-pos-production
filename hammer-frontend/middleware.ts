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
 *
 * Role-based redirects (master vs branch vs sysadmin) live in
 * `src/app/app/page.tsx`, which calls `GET /api/auth/session` and routes
 * the user to the correct landing page.
 */
const PUBLIC_PATHS = new Set([
  "/login",
  "/unauthorized",
  "/forbidden",
  "/health",
]);

const SESSION_COOKIE = "hammer_session";

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

  if (PUBLIC_PATHS.has(pathname)) {
    return NextResponse.next();
  }

  const hasSession = request.cookies.has(SESSION_COOKIE);

  // Gate /app/* on cookie presence (a stale cookie will be cleared by the
  // backend's 401 on the first apiFetch).
  if (!hasSession && pathname.startsWith("/app")) {
    const url = new URL("/login", request.url);
    return NextResponse.redirect(url);
  }

  // Already authenticated visitors should not see the login page.
  if (hasSession && pathname === "/login") {
    return NextResponse.redirect(new URL("/app", request.url));
  }

  return NextResponse.next();
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico).*)"],
};
