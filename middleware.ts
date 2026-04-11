import { NextResponse, type NextRequest } from "next/server";
import { decodeSession, makeSessionCookieName } from "@/modules/auth/session";
import { resolveRoleHome } from "@/modules/rbac/role-routing";

const PUBLIC_PATHS = new Set(["/login", "/unauthorized", "/forbidden"]);

// Paths that are exempt from CSRF checks (e.g., auth endpoints, read-only)
const CSRF_EXEMPT_PATHS = new Set([
  "/api/auth/login",
  "/api/auth/logout",
  "/api/auth/session",
  "/api/auth/csrf",
]);

export function middleware(request: NextRequest) {
  const { pathname } = request.nextUrl;

  // Always allow static assets and auth endpoints
  if (
    pathname.startsWith("/_next") ||
    pathname.startsWith("/api/auth") ||
    pathname.includes(".")
  ) {
    return NextResponse.next();
  }

  // Allow public page routes
  if (PUBLIC_PATHS.has(pathname)) {
    return NextResponse.next();
  }

  const token = request.cookies.get(makeSessionCookieName())?.value;
  const session = token ? decodeSession(token) : null;

  // ── API routes require authentication ──
  if (pathname.startsWith("/api/")) {
    if (!session) {
      return NextResponse.json(
        { message: "Unauthorized", reason: "NO_SESSION" },
        { status: 401 },
      );
    }

    // CSRF protection for state-changing methods (POST, PUT, PATCH, DELETE)
    const method = request.method.toUpperCase();
    if (["POST", "PUT", "PATCH", "DELETE"].includes(method) && !CSRF_EXEMPT_PATHS.has(pathname)) {
      const origin = request.headers.get("origin");
      const host = request.headers.get("host");

      // Double-submit check: verify origin matches host
      if (origin) {
        try {
          const originUrl = new URL(origin);
          const expectedHost = host?.split(":")[0];
          if (originUrl.hostname !== expectedHost && originUrl.hostname !== "localhost") {
            return NextResponse.json(
              { message: "CSRF validation failed", reason: "ORIGIN_MISMATCH" },
              { status: 403 },
            );
          }
        } catch {
          return NextResponse.json(
            { message: "CSRF validation failed", reason: "INVALID_ORIGIN" },
            { status: 403 },
          );
        }
      }

      // Also check X-Requested-With header or custom CSRF header
      const csrfHeader = request.headers.get("x-csrf-token");
      const requestedWith = request.headers.get("x-requested-with");

      // For API routes called from our own frontend, we accept either:
      // 1. Origin header matching (already checked above)
      // 2. Content-Type: application/json (browsers don't send this cross-origin without CORS)
      // 3. Valid x-csrf-token header
      const contentType = request.headers.get("content-type") ?? "";
      const isJsonRequest = contentType.includes("application/json");

      if (!origin && !csrfHeader && !requestedWith && !isJsonRequest) {
        return NextResponse.json(
          { message: "CSRF validation failed", reason: "NO_CSRF_INDICATORS" },
          { status: 403 },
        );
      }

      // If a CSRF token header was provided, validate it exists and belongs to the session user
      // Note: Full DB validation is done server-side in route handlers via validateCsrfToken()
      // Middleware performs structural checks; route handlers can perform DB-backed validation
    }

    return NextResponse.next();
  }

  // ── Page routes ──
  if (!session && pathname.startsWith("/app")) {
    return NextResponse.redirect(new URL("/login", request.url));
  }

  // Force password change: redirect users with mustChangePassword flag
  // The session payload doesn't carry this flag, but the login redirect handles it.
  // For API routes, the change-password page is always accessible.

  if (session && pathname === "/login") {
    const target = resolveRoleHome(session.roleCode as string, session.globalRoles as unknown as string[]);
    return NextResponse.redirect(new URL(target, request.url));
  }

  // SYSTEM_ADMIN has access to both /app/system-admin and /app/master
  if (
    session &&
    pathname.startsWith("/app/system-admin") &&
    !(session.globalRoles as unknown as string[]).includes("SYSTEM_ADMIN")
  ) {
    return NextResponse.redirect(new URL("/forbidden", request.url));
  }

  if (
    session &&
    pathname.startsWith("/app/master") &&
    !(session.globalRoles as unknown as string[]).includes("MASTER") &&
    !(session.globalRoles as unknown as string[]).includes("SYSTEM_ADMIN")
  ) {
    return NextResponse.redirect(new URL("/forbidden", request.url));
  }

  if (
    session &&
    pathname.startsWith("/app/branch") &&
    session.branchMemberships.length === 0 &&
    !(session.globalRoles as unknown as string[]).includes("MASTER")
  ) {
    return NextResponse.redirect(new URL("/forbidden", request.url));
  }

  return NextResponse.next();
}

// Process all routes through the middleware
export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico).*)"],
};
