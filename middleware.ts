import { NextResponse, type NextRequest } from "next/server";
import { decodeSession, makeSessionCookieName } from "@/modules/auth/session";
import { resolveRoleHome } from "@/modules/rbac/role-routing";

const PUBLIC_PATHS = new Set(["/login", "/unauthorized", "/forbidden", "/health"]);
const PUBLIC_API_PATHS = new Set(["/api/auth/login", "/api/auth/session", "/api/auth/csrf"]);
const SAFE_METHODS = new Set(["GET", "HEAD", "OPTIONS"]);

// ── CORS configuration ──
// Reads comma-separated allowed origins from env (e.g. "https://app.example.com,http://localhost:3000")
const ALLOWED_ORIGINS: Set<string> = new Set(
  (process.env.ALLOWED_ORIGINS ?? "")
    .split(",")
    .map((o) => o.trim())
    .filter(Boolean),
);

function applyCorsHeaders(
  response: NextResponse,
  origin: string | null,
): NextResponse {
  if (!origin) return response;
  // Allow if origin is in whitelist, or in development allow localhost origins
  const isAllowed =
    ALLOWED_ORIGINS.has(origin) ||
    (process.env.NODE_ENV !== "production" &&
      (origin.startsWith("http://localhost:") ||
        origin.startsWith("http://127.0.0.1:")));

  if (isAllowed) {
    response.headers.set("Access-Control-Allow-Origin", origin);
    response.headers.set("Access-Control-Allow-Credentials", "true");
    response.headers.set(
      "Access-Control-Allow-Methods",
      "GET, POST, PUT, PATCH, DELETE, OPTIONS",
    );
    response.headers.set(
      "Access-Control-Allow-Headers",
      "Content-Type, x-csrf-token, Authorization",
    );
    response.headers.set("Access-Control-Max-Age", "86400");
  }
  return response;
}

export function middleware(request: NextRequest) {
  const { pathname } = request.nextUrl;
  const origin = request.headers.get("origin");

  // Handle CORS preflight (OPTIONS) for API routes
  if (request.method === "OPTIONS" && pathname.startsWith("/api/")) {
    const preflightResponse = new NextResponse(null, { status: 204 });
    return applyCorsHeaders(preflightResponse, origin);
  }

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
      const res = NextResponse.next();
      return applyCorsHeaders(res, origin);
    }

    if (!session) {
      const res = NextResponse.json(
        { message: "Unauthorized", reason: "NO_SESSION" },
        { status: 401 },
      );
      return applyCorsHeaders(res, origin);
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
        const res = NextResponse.json(
          { message: "CSRF validation failed", reason: "MISSING_CSRF_TOKEN" },
          { status: 403 },
        );
        return applyCorsHeaders(res, origin);
      }
    }

    const res = NextResponse.next();
    return applyCorsHeaders(res, origin);
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
