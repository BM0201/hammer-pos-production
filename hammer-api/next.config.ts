import type { NextConfig } from "next";

const securityHeaders = [
  { key: "Strict-Transport-Security", value: "max-age=63072000; includeSubDomains; preload" },
  { key: "X-Frame-Options", value: "DENY" },
  { key: "X-Content-Type-Options", value: "nosniff" },
  { key: "X-XSS-Protection", value: "1; mode=block" },
  { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
  { key: "Permissions-Policy", value: "camera=(), microphone=(), geolocation=(), payment=()" },
  { key: "Content-Security-Policy", value: "default-src 'none'; frame-ancestors 'none'; base-uri 'none';" },
];

/**
 * Backend (hammer-api) Next.js config — minimal, API-only.
 *
 * - No `typedRoutes` (no page routing)
 * - No Tailwind / CSS pipeline
 * - CORS handling: the frontend talks to this backend via Vercel Rewrites
 *   (same-origin), so cross-origin CORS is NOT needed. If a future scenario
 *   requires direct cross-origin access, add explicit CORS headers per route.
 */
const nextConfig: NextConfig = {
  outputFileTracingRoot: process.cwd(),
  // Reduce serverless bundle size by externalising heavy deps.
  serverExternalPackages: ["@prisma/client", "@prisma/adapter-neon", "@neondatabase/serverless"],
  async headers() {
    return [
      {
        source: "/:path*",
        headers: securityHeaders,
      },
    ];
  },
};

export default nextConfig;
