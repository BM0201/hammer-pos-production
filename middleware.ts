import { NextResponse, type NextRequest } from "next/server";
import { decodeSession, makeSessionCookieName } from "@/modules/auth/session";
import { resolveRoleHome } from "@/modules/rbac/role-routing";

const PUBLIC_PATHS = new Set(["/login", "/unauthorized", "/forbidden", "/health"]);
const PUBLIC_API_PATHS = new Set(["/api/auth/login", "/api/auth/session", "/api/auth/csrf"]);
const SAFE_METHODS = new Set(["GET", "HEAD", "OPTIONS"]);

export function middleware(request: NextRequest) {
  const { pathname } = request.nextUrl;

  if (pathname.startsWith("/_next") || pathname.includes(".")) {
    return NextResponse.next();
  }

  if (PUBLIC_PATHS.has(pathname)) {
    return NextResponse.next();
  }

  const token = request.cookies.get(makeSessionCookieName())?.value;
  const session = token ? decodeSession(token) : null;

  if (pathname.startsWith("/api/")) {
    if (PUBLIC_API_PATHS.has(pathname)) {
      return NextResponse.next();
    }

    if (!session) {
      return NextResponse.json(
        { message: "Unauthorized", reason: "NO_SESSION" },
        { status: 401 },
      );
    }

    // ── CSRF: Shallow check (header existence only) ──
    // This middleware only verifies that the x-csrf-token header is PRESENT.
    // It does NOT validate the token value against the database.
    // Real validation happens inside each route via requireCsrf() which
    // hashes the token and checks it against the csrfToken table with expiry.
    // This layer exists as a fast-fail gate to reject obviously bad requests
    // before they reach route handlers (defense-in-depth).
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

  if (!session && pathname.startsWith("/app")) {
    return NextResponse.redirect(new URL("/login", request.url));
  }

  if (session && pathname === "/login") {
    const target = resolveRoleHome(session.roleCode as string, session.globalRoles as unknown as string[]);
    return NextResponse.redirect(new URL(target, request.url));
  }

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

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico).*)"],
};
