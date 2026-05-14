import type { NextConfig } from "next";

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
  // Skip type-checking during `next build` — we run `tsc --noEmit` separately
  // so build failures here only come from Next.js bundling concerns.
  typescript: {
    ignoreBuildErrors: false,
  },
  // Reduce serverless bundle size by externalising heavy deps.
  serverExternalPackages: ["@prisma/client", "@prisma/adapter-neon", "@neondatabase/serverless"],
};

export default nextConfig;
