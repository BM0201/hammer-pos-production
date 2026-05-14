#!/usr/bin/env npx tsx
/**
 * CSRF Protection Verification Script
 * ====================================
 * Scans all API route handlers in src/app/api and verifies that every
 * POST / PUT / PATCH / DELETE export is protected by requireCsrf()
 * (or requireAuthAndCsrf()).
 *
 * Usage:
 *   npx tsx scripts/verify-csrf-protection.ts
 *
 * Exit code 0 = all routes protected or justified exceptions.
 * Exit code 1 = unprotected routes found.
 */

import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, relative, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// ── Known exceptions (routes that legitimately skip CSRF) ──────────────────
const CSRF_EXCEPTIONS: Record<string, string> = {
  "/api/auth/login":        "Login endpoint — no session exists yet to validate a CSRF token",
  "/api/auth/csrf":         "GET-only endpoint that generates CSRF tokens",
  "/api/auth/session":      "GET-only endpoint that reads the current session",
};

const MUTATING_METHODS = /export\s+async\s+function\s+(POST|PUT|PATCH|DELETE)/g;
const CSRF_CALL        = /(?:requireCsrf|requireAuthAndCsrf)\s*\(/;

const API_ROOT = join(__dirname, "..", "src", "app", "api");

interface RouteInfo {
  file: string;
  route: string;
  methods: string[];
  hasCsrf: boolean;
  isException: boolean;
  exceptionReason?: string;
}

function walkDir(dir: string): string[] {
  const results: string[] = [];
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) {
      results.push(...walkDir(full));
    } else if (entry === "route.ts") {
      results.push(full);
    }
  }
  return results;
}

function fileToRoute(filepath: string): string {
  const rel = relative(join(__dirname, "..", "src", "app"), filepath);
  return "/" + rel.replace(/\/route\.ts$/, "").replace(/\\/g, "/");
}

function analyzeRoute(filepath: string): RouteInfo | null {
  const content = readFileSync(filepath, "utf-8");
  const route = fileToRoute(filepath);

  const methods: string[] = [];
  let m: RegExpExecArray | null;
  const re = new RegExp(MUTATING_METHODS.source, "g");
  while ((m = re.exec(content)) !== null) {
    methods.push(m[1]);
  }

  if (methods.length === 0) return null; // GET-only route

  const hasCsrf = CSRF_CALL.test(content);
  const isException = route in CSRF_EXCEPTIONS;

  return {
    file: filepath,
    route,
    methods,
    hasCsrf,
    isException,
    exceptionReason: isException ? CSRF_EXCEPTIONS[route] : undefined,
  };
}

// ── Main ────────────────────────────────────────────────────────────────────
const routeFiles = walkDir(API_ROOT);
const results = routeFiles.map(analyzeRoute).filter(Boolean) as RouteInfo[];

const protected_routes  = results.filter(r => r.hasCsrf);
const exceptions        = results.filter(r => r.isException && !r.hasCsrf);
const vulnerableRoutes  = results.filter(r => !r.hasCsrf && !r.isException);

console.log("═══════════════════════════════════════════════════════════════");
console.log("  H.A.M.M.E.R. — CSRF Protection Verification Report");
console.log("═══════════════════════════════════════════════════════════════\n");

console.log(`  Total mutating routes scanned:  ${results.length}`);
console.log(`  ✅ Protected (requireCsrf):      ${protected_routes.length}`);
console.log(`  🔒 Justified exceptions:          ${exceptions.length}`);
console.log(`  ❌ UNPROTECTED:                   ${vulnerableRoutes.length}`);
console.log();

if (protected_routes.length > 0) {
  console.log("── Protected Routes ─────────────────────────────────────────");
  for (const r of protected_routes) {
    console.log(`  ✅ [${r.methods.join(",")}] ${r.route}`);
  }
  console.log();
}

if (exceptions.length > 0) {
  console.log("── Justified Exceptions ─────────────────────────────────────");
  for (const r of exceptions) {
    console.log(`  🔒 [${r.methods.join(",")}] ${r.route}`);
    console.log(`     Reason: ${r.exceptionReason}`);
  }
  console.log();
}

if (vulnerableRoutes.length > 0) {
  console.log("── ⚠️  UNPROTECTED Routes (MUST FIX) ─────────────────────────");
  for (const r of vulnerableRoutes) {
    console.log(`  ❌ [${r.methods.join(",")}] ${r.route}`);
    console.log(`     File: ${relative(join(__dirname, ".."), r.file)}`);
  }
  console.log();
  console.log("❌ VERIFICATION FAILED — Unprotected mutating routes found!");
  process.exit(1);
} else {
  console.log("✅ ALL MUTATING ROUTES ARE CSRF-PROTECTED (or justified exceptions).\n");
  process.exit(0);
}
