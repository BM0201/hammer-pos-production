import { NextResponse, type NextRequest } from "next/server";
import { decodeSession, makeSessionCookieName } from "@/modules/auth/session";

/**
 * Backend (hammer-api) middleware.
 *
 * Scope:
 *  - Runs ONLY for `/api/*` routes (matcher below).
 *  - Performs a fast-fail gate before route handlers run:
 *      • Session decode for protected endpoints
 *      • Shallow CSRF check (header presence) for mutating requests
 *  - Real CSRF token validation still happens inside each route via
 *    `requireCsrf()` (DB lookup + hash + expiry).
 *
 * Public endpoints (no session required):
 *  - /api/auth/login, /api/auth/session, /api/auth/csrf
 *  - /api/cron/* — protected by `Authorization: Bearer <CRON_SECRET>` header
 *    inside the route handler, not by session.
 */
const PUBLIC_API_PATHS = new Set([
  "/api/auth/login",
  "/api/auth/session",
  "/api/auth/csrf",
]);

const SAFE_METHODS = new Set(["GET", "HEAD", "OPTIONS"]);

function isCronPath(pathname: string): boolean {
  return pathname.startsWith("/api/cron/");
}

export function middleware(request: NextRequest) {
  const { pathname } = request.nextUrl;

  // ── Public, unauthenticated API endpoints ──
  if (PUBLIC_API_PATHS.has(pathname) || isCronPath(pathname)) {
    return NextResponse.next();
  }

  // ── Session check ──
  const token = request.cookies.get(makeSessionCookieName())?.value;
  const session = token ? decodeSession(token) : null;

  if (!session) {
    return NextResponse.json(
      { message: "Unauthorized", reason: "NO_SESSION" },
      { status: 401 },
    );
  }

  // ── Shallow CSRF check (header presence only) ──
  // Real validation occurs inside each route handler via requireCsrf().
  if (!SAFE_METHODS.has(request.method.toUpperCase())) {
    const csrfHeader = request.headers.get("x-csrf-token");
    if (!csrfHeader) {
      return NextResponse.json(
        { message: "CSRF validation failed", reason: "MISSING_CSRF_TOKEN" },
        { status: 403 },
      );
    }
  }

  return NextResponse.next();
}

export const config = {
  // Apply middleware only to API routes. Health/ready run unauthenticated.
  matcher: ["/api/:path*"],
};
