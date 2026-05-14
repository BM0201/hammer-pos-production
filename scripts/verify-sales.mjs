#!/usr/bin/env node
/**
 * verify-sales.mjs — Static analysis of sales flow integrity
 *
 * Validates:
 *  1. All sales API routes use toHttpErrorResponse or proper error handling
 *  2. Mutating operations require CSRF (requireCsrf)
 *  3. branch-pos.tsx uses apiFetch for POST/PATCH/DELETE (not raw fetch)
 *  4. Error messages have Spanish translations in pos-ui.ts
 *  5. Order status transitions are consistent
 *  6. No silent failures (catch blocks without user feedback)
 */
import { readFileSync, existsSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, "..");

let passed = 0;
let failed = 0;
const issues = [];

function check(label, ok, detail = "") {
  if (ok) {
    passed++;
    console.log(`  ✅ ${label}`);
  } else {
    failed++;
    issues.push({ label, detail });
    console.log(`  ❌ ${label}${detail ? ` — ${detail}` : ""}`);
  }
}

function readFile(relPath) {
  const abs = resolve(ROOT, relPath);
  if (!existsSync(abs)) return null;
  return readFileSync(abs, "utf-8");
}

console.log("\n🔍 Verificación de flujo de ventas (sales)\n");

// ── 1. Sales API routes use toHttpErrorResponse ──
console.log("1️⃣  Manejo de errores en API routes de ventas:");
const salesRoutes = [
  "src/app/api/sales/orders/route.ts",
  "src/app/api/sales/orders/[id]/submit/route.ts",
  "src/app/api/sales/orders/[id]/lines/route.ts",
  "src/app/api/sales/orders/[id]/lines/[lineId]/route.ts",
  "src/app/api/sales/orders/[id]/direct-sale/route.ts",
];

for (const route of salesRoutes) {
  const content = readFile(route);
  if (!content) {
    check(`${route} existe`, false, "Archivo no encontrado");
    continue;
  }
  check(
    `${route} usa toHttpErrorResponse`,
    content.includes("toHttpErrorResponse"),
    "Falta toHttpErrorResponse como fallback"
  );
}

// ── 2. CSRF enforcement on mutating routes ──
console.log("\n2️⃣  CSRF enforcement en rutas mutantes:");
const mutatingRoutes = [
  "src/app/api/sales/orders/route.ts",
  "src/app/api/sales/orders/[id]/submit/route.ts",
  "src/app/api/sales/orders/[id]/lines/route.ts",
  "src/app/api/sales/orders/[id]/lines/[lineId]/route.ts",
];

for (const route of mutatingRoutes) {
  const content = readFile(route);
  if (!content) continue;
  check(
    `${route} importa requireCsrf`,
    content.includes("requireCsrf"),
    "Mutating route sin CSRF enforcement"
  );
  check(
    `${route} llama requireCsrf`,
    content.includes("await requireCsrf("),
    "requireCsrf importado pero no invocado"
  );
}

// ── 3. branch-pos.tsx uses apiFetch for mutations ──
console.log("\n3️⃣  branch-pos.tsx usa apiFetch para operaciones mutantes:");
const branchPos = readFile("src/components/pos/branch-pos.tsx");
if (branchPos) {
  check(
    "Importa apiFetch",
    branchPos.includes('from "@/lib/client/api"') || branchPos.includes("from '@/lib/client/api'"),
    "No importa apiFetch"
  );

  // Check that POST/PATCH/DELETE calls use apiFetch, not raw fetch
  const mutatingFetchCalls = [];
  const lines = branchPos.split("\n");
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    // Look for fetch() calls with method: "POST"|"PATCH"|"DELETE"
    if (/\bawait\s+fetch\(/.test(line)) {
      // Check if in the next few lines there's a method: "POST"|"PATCH"|"DELETE"
      const chunk = lines.slice(i, i + 5).join("\n");
      if (/method:\s*["'](POST|PATCH|DELETE)["']/.test(chunk)) {
        mutatingFetchCalls.push(i + 1);
      }
    }
  }

  check(
    "No usa fetch() crudo para POST/PATCH/DELETE",
    mutatingFetchCalls.length === 0,
    mutatingFetchCalls.length > 0 ? `fetch() crudo en líneas: ${mutatingFetchCalls.join(", ")}` : ""
  );

  // Check for loading state
  check(
    "Tiene estado de carga inicial (isInitialLoading)",
    branchPos.includes("isInitialLoading"),
    "Falta feedback de carga al inicio"
  );

  // Check for notice auto-dismiss
  check(
    "Tiene auto-dismiss de notificaciones",
    branchPos.includes("setNoticeTimed") || branchPos.includes("noticeTimerRef"),
    "Las notificaciones no se ocultan automáticamente"
  );
}

// ── 4. Error messages have Spanish translations ──
console.log("\n4️⃣  Traducciones de error en pos-ui.ts:");
const posUi = readFile("src/lib/pos-ui.ts");
const requiredKeys = [
  "BRANCH_CLOSED",
  "INSUFFICIENT_STOCK",
  "INSUFFICIENT_STOCK_AT_PAYMENT",
  "ORDER_NOT_DRAFT",
  "ORDER_EMPTY",
  "PAYMENT_ALREADY_POSTED",
  "PAYMENT_INVALID_STATUS",
  "FORBIDDEN_ROLE",
  "FORBIDDEN_BRANCH",
  "UNAUTHENTICATED",
  "INVALID_CSRF_TOKEN",
  "CASH_SESSION_NOT_OPEN",
  "CASH_SESSION_ALREADY_OPEN",
  "CASH_BOX_INACTIVE",
  "CASH_BOX_BRANCH_MISMATCH",
  "INVALID_PAYMENT_AMOUNT",
  "INVALID_TRANSITION",
  "NETWORK_ERROR",
];

if (posUi) {
  for (const key of requiredKeys) {
    check(
      `Traducción para ${key}`,
      posUi.includes(`${key}:`),
      `Falta traducción al español para ${key}`
    );
  }
}

// ── 5. Order status transitions ──
console.log("\n5️⃣  Transiciones de estado de órdenes:");
const salesService = readFile("src/modules/sales/service.ts");
if (salesService) {
  check(
    "createDraftSaleOrder verifica cierre de caja (getTodayClosure)",
    salesService.includes("getTodayClosure") && salesService.includes("canSell"),
    "No verifica si la sucursal está cerrada antes de crear órdenes"
  );
  check(
    "submitSaleOrderToPendingPayment verifica ORDER_EMPTY",
    salesService.includes('"ORDER_EMPTY"'),
    "No valida órdenes vacías al enviar a pago"
  );
  check(
    "submitSaleOrderToPendingPayment verifica INSUFFICIENT_STOCK",
    salesService.includes('"INSUFFICIENT_STOCK"'),
    "No valida stock al enviar a pago"
  );
  check(
    "submitSaleOrderToPendingPayment verifica status DRAFT",
    salesService.includes("INVALID_TRANSITION") || salesService.includes("ORDER_NOT_DRAFT"),
    "No valida que la orden esté en DRAFT"
  );
}

// ── 6. No silent failures ──
console.log("\n6️⃣  Sin fallos silenciosos:");
if (branchPos) {
  const catchBlocks = branchPos.match(/catch\s*\([^)]*\)\s*\{[^}]*\}/g) ?? [];
  const silentCatches = catchBlocks.filter(
    (block) => !block.includes("setNotice") && !block.includes("setNoticeTimed") && !block.includes("console.error")
  );
  check(
    "branch-pos.tsx: todos los catch tienen feedback",
    silentCatches.length === 0,
    `${silentCatches.length} catch blocks sin feedback al usuario`
  );
}

const cashierPayments = readFile("src/components/payments/cashier-payments.tsx");
if (cashierPayments) {
  check(
    "cashier-payments.tsx importa apiFetch",
    cashierPayments.includes('from "@/lib/client/api"'),
    "No usa apiFetch para pagos"
  );
  check(
    "cashier-payments.tsx tiene guardia de doble pago",
    cashierPayments.includes("recentlyPaidRef") || cashierPayments.includes("double") || cashierPayments.includes("duplicate"),
    "Sin protección contra doble clic en pagos"
  );
}

// ── Summary ──
console.log("\n" + "─".repeat(60));
console.log(`\n📊 Resultados: ${passed} pasaron, ${failed} fallaron\n`);

if (issues.length > 0) {
  console.log("⚠️  Problemas encontrados:");
  for (const { label, detail } of issues) {
    console.log(`   • ${label}${detail ? `: ${detail}` : ""}`);
  }
  console.log("");
}

process.exit(failed > 0 ? 1 : 0);
