import type { NextConfig } from "next";

const isDev = process.env.NODE_ENV !== "production";

const securityHeaders = [
  { key: "Strict-Transport-Security", value: "max-age=63072000; includeSubDomains; preload" },
  { key: "X-Frame-Options", value: "DENY" },
  { key: "X-Content-Type-Options", value: "nosniff" },
  { key: "X-XSS-Protection", value: "1; mode=block" },
  { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
  { key: "Permissions-Policy", value: "camera=(), microphone=(), geolocation=(), payment=()" },
  {
    key: "Content-Security-Policy",
    value: [
      "default-src 'self'",
      // 'unsafe-eval' only needed in dev (Next.js HMR); removed in production.
      isDev
        ? "script-src 'self' 'unsafe-inline' 'unsafe-eval'"
        : "script-src 'self' 'unsafe-inline'",
      "style-src 'self' 'unsafe-inline'",
      "img-src 'self' data: https:",
      "font-src 'self' data:",
      "connect-src 'self'",
      "frame-ancestors 'none'",
      "base-uri 'self'",
      "form-action 'self'",
    ].join("; "),
  },
];

/**
 * Frontend (hammer-frontend) Next.js config.
 *
 * The frontend never queries the database directly. All `/api/*` requests
 * are rewritten to the backend project (`hammer-api`) at the edge.
 *
 * Required env var:
 *   BACKEND_URL — fully qualified URL to the backend project
 *     e.g. `https://hammer-api.vercel.app` or `https://api.hammer.com`
 *
 * Same-origin guarantees:
 *   Because rewrites are server-side at Vercel's edge, the browser sees the
 *   API at the same origin as the page. This means:
 *     - Session cookies attach to the API request automatically.
 *     - No CORS preflight is needed.
 *     - The `x-csrf-token` header passes through transparently.
 */
const nextConfig: NextConfig = {
  typedRoutes: true,
  outputFileTracingRoot: process.cwd(),
  async headers() {
    return [
      {
        source: "/:path*",
        headers: securityHeaders,
      },
    ];
  },
  async rewrites() {
    const backendUrl = process.env.BACKEND_URL?.replace(/\/$/, "");
    if (!backendUrl) {
      // In local development without BACKEND_URL set, fall back to the
      // local backend dev server on port 4000.
      const localBackend = "http://localhost:4000";
      return [
        { source: "/api/:path*", destination: `${localBackend}/api/:path*` },
      ];
    }
    return [
      { source: "/api/:path*", destination: `${backendUrl}/api/:path*` },
    ];
  },
};

export default nextConfig;
