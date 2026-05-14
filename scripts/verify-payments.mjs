#!/usr/bin/env node
/**
 * verify-payments.mjs — Static analysis of payment flow integrity
 *
 * Validates:
 *  1. Payment service has idempotency/duplication guards
 *  2. Payment API route handles all known error codes
 *  3. Cashier-payments.tsx uses apiFetch and has double-click guard
 *  4. Cash session management has proper error handling
 *  5. Inventory deduction happens inside a transaction
 *  6. Error feedback is always provided to the user
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

console.log("\n🔍 Verificación de flujo de pagos (payments)\n");

// ── 1. Payment service idempotency ──
console.log("1️⃣  Idempotencia y guardias en servicio de pagos:");
const paymentService = readFile("src/modules/payments/service.ts");
if (paymentService) {
  check(
    "Usa FOR UPDATE en SaleOrder (bloqueo pesimista)",
    paymentService.includes("FOR UPDATE") && paymentService.includes("SaleOrder"),
    "No bloquea la orden para prevenir pagos concurrentes"
  );
  check(
    "Verifica status PENDING_PAYMENT antes de pagar",
    paymentService.includes("PENDING_PAYMENT") && paymentService.includes("PAYMENT_INVALID_STATUS"),
    "No valida que la orden esté en estado correcto"
  );
  check(
    "Verifica pago duplicado (PAYMENT_ALREADY_POSTED)",
    paymentService.includes("PAYMENT_ALREADY_POSTED"),
    "No detecta pagos ya registrados"
  );
  check(
    "Verifica monto exacto del pago",
    paymentService.includes("INVALID_PAYMENT_AMOUNT"),
    "No valida que el monto coincida con el total"
  );
  check(
    "Usa transacción Prisma ($transaction)",
    paymentService.includes("$transaction"),
    "Pago no está envuelto en transacción"
  );
  check(
    "Bloquea inventario con FOR UPDATE",
    paymentService.includes('FOR UPDATE') && paymentService.includes("InventoryBalance"),
    "No bloquea inventario para prevenir sobreventa"
  );
  check(
    "Verifica stock antes de deducir (INSUFFICIENT_STOCK_AT_PAYMENT)",
    paymentService.includes("INSUFFICIENT_STOCK_AT_PAYMENT"),
    "No verifica stock disponible antes de la deducción"
  );
  check(
    "Maneja constraint P2002 como PAYMENT_ALREADY_POSTED",
    paymentService.includes("P2002"),
    "No captura unique constraint violation en Payment"
  );
  check(
    "Valida sesión de caja activa (CASH_SESSION_NOT_OPEN)",
    paymentService.includes("CASH_SESSION_NOT_OPEN"),
    "No valida que la sesión de caja esté abierta"
  );
  check(
    "Valida sucursal de caja (CASH_BOX_BRANCH_MISMATCH)",
    paymentService.includes("CASH_BOX_BRANCH_MISMATCH"),
    "No valida que la caja pertenezca a la sucursal"
  );
} else {
  check("payments/service.ts existe", false, "Archivo no encontrado");
}

// ── 2. Payment API route error handling ──
console.log("\n2️⃣  Manejo de errores en API de pagos:");
const paymentRoute = readFile("src/app/api/cashier/payments/route.ts");
if (paymentRoute) {
  check(
    "Importa requireCsrf",
    paymentRoute.includes("requireCsrf"),
    "Ruta de pago sin protección CSRF"
  );
  check(
    "Llama requireCsrf",
    paymentRoute.includes("await requireCsrf("),
    "CSRF importado pero no invocado"
  );
  check(
    "Usa toHttpErrorResponse como fallback",
    paymentRoute.includes("toHttpErrorResponse"),
    "Sin fallback de error estandarizado"
  );

  const expectedCodes = [
    "PAYMENT_INVALID_STATUS",
    "PAYMENT_ALREADY_POSTED",
    "INVALID_PAYMENT_AMOUNT",
    "INSUFFICIENT_STOCK_AT_PAYMENT",
    "CASH_SESSION_NOT_OPEN",
    "FORBIDDEN_BRANCH",
  ];

  for (const code of expectedCodes) {
    check(
      `Maneja error ${code}`,
      paymentRoute.includes(code),
      `Código de error ${code} no mapeado`
    );
  }
} else {
  check("cashier/payments/route.ts existe", false, "Archivo no encontrado");
}

// ── 3. Cashier-payments.tsx UI guards ──
console.log("\n3️⃣  Guardias en UI de cobro (cashier-payments.tsx):");
const cashierPayments = readFile("src/components/payments/cashier-payments.tsx");
if (cashierPayments) {
  check(
    "Importa apiFetch",
    cashierPayments.includes('from "@/lib/client/api"'),
    "No usa apiFetch para POST de pagos"
  );
  check(
    "Usa apiFetch para POST de pago",
    cashierPayments.includes('apiFetch("/api/cashier/payments"') || cashierPayments.includes("apiFetch(`/api/cashier/payments"),
    "Usa fetch crudo para registrar pagos"
  );
  check(
    "Tiene guardia de doble envío (recentlyPaidRef o similar)",
    cashierPayments.includes("recentlyPaidRef"),
    "Sin protección contra doble clic"
  );
  check(
    "Tiene estado isSubmitting",
    cashierPayments.includes("isSubmitting"),
    "Sin indicador de carga durante pago"
  );
  check(
    "Verifica sesión abierta antes de pagar",
    cashierPayments.includes("hasOpenSession") && cashierPayments.includes("cashSessionId"),
    "No valida sesión de caja antes de cobrar"
  );
  check(
    "Muestra loading en botón de pago",
    cashierPayments.includes("Procesando pago") || cashierPayments.includes("loading={isSubmitting}"),
    "Sin feedback de carga en botón"
  );
  check(
    "Muestra toast de error en fallos de pago",
    cashierPayments.includes('showToast("error"'),
    "No muestra toast de error al usuario"
  );
  check(
    "Muestra toast de éxito",
    cashierPayments.includes('showToast("success"'),
    "No confirma pago exitoso al usuario"
  );
} else {
  check("cashier-payments.tsx existe", false, "Archivo no encontrado");
}

// ── 4. Cash session management ──
console.log("\n4️⃣  Manejo de sesiones de caja:");
const cashSessionPanel = readFile("src/components/cash-session/cash-session-panel.tsx");
if (cashSessionPanel) {
  check(
    "Importa apiFetch",
    cashSessionPanel.includes('from "@/lib/client/api"'),
    "No usa apiFetch para POST de sesiones"
  );

  // Check try-catch wrappers
  const openFn = cashSessionPanel.slice(
    cashSessionPanel.indexOf("async function openSession()"),
    cashSessionPanel.indexOf("async function requestCloseSession()")
  );
  check(
    "openSession tiene try-catch",
    openFn.includes("try {") && openFn.includes("catch"),
    "Error de red dejará busyAction atascado"
  );

  const requestCloseFn = cashSessionPanel.slice(
    cashSessionPanel.indexOf("async function requestCloseSession()"),
    cashSessionPanel.indexOf("async function closeSession()")
  );
  check(
    "requestCloseSession tiene try-catch",
    requestCloseFn.includes("try {") && requestCloseFn.includes("catch"),
    "Error de red dejará busyAction atascado"
  );

  const closeFn = cashSessionPanel.slice(
    cashSessionPanel.indexOf("async function closeSession()"),
    cashSessionPanel.indexOf("const stateColors")
  );
  check(
    "closeSession tiene try-catch",
    closeFn.includes("try {") && closeFn.includes("catch"),
    "Error de red dejará busyAction atascado"
  );

  check(
    "Tiene finally para resetear busyAction",
    cashSessionPanel.includes("finally") && cashSessionPanel.includes("setBusyAction(null)"),
    "busyAction no se resetea en caso de error"
  );
} else {
  check("cash-session-panel.tsx existe", false, "Archivo no encontrado");
}

// ── 5. Cash session API routes ──
console.log("\n5️⃣  API routes de sesiones de caja:");
const cashRoutes = [
  { path: "src/app/api/cashier/cash-sessions/open/route.ts", label: "open" },
  { path: "src/app/api/cashier/cash-sessions/close/route.ts", label: "close" },
  { path: "src/app/api/cashier/cash-sessions/close-request/route.ts", label: "close-request" },
  { path: "src/app/api/cashier/cash-sessions/active/route.ts", label: "active" },
];

for (const { path, label } of cashRoutes) {
  const content = readFile(path);
  if (!content) {
    check(`${label} route existe`, false, "Archivo no encontrado");
    continue;
  }
  check(
    `${label} route usa toHttpErrorResponse`,
    content.includes("toHttpErrorResponse"),
    "Sin fallback de error estandarizado"
  );
  if (label !== "active") {
    check(
      `${label} route importa requireCsrf`,
      content.includes("requireCsrf"),
      "Mutating route sin CSRF enforcement"
    );
  }
}

// ── 6. toHttpErrorResponse completeness ──
console.log("\n6️⃣  Completitud de toHttpErrorResponse:");
const httpLib = readFile("src/lib/http.ts");
if (httpLib) {
  const errorCodes = [
    "PAYMENT_ALREADY_POSTED",
    "PAYMENT_INVALID_STATUS",
    "INVALID_PAYMENT_AMOUNT",
    "INSUFFICIENT_STOCK",
    "INSUFFICIENT_STOCK_AT_PAYMENT",
    "BRANCH_CLOSED",
    "ORDER_NOT_DRAFT",
    "ORDER_EMPTY",
    "CASH_SESSION_NOT_OPEN",
    "CASH_SESSION_ALREADY_OPEN",
    "INVALID_CSRF_TOKEN",
    "UNAUTHENTICATED",
    "FORBIDDEN_BRANCH",
  ];

  for (const code of errorCodes) {
    check(
      `toHttpErrorResponse maneja ${code}`,
      httpLib.includes(`"${code}"`),
      `Código no mapeado en toHttpErrorResponse`
    );
  }

  // Check that 403 responses include reason field
  check(
    "403 responses incluyen campo reason",
    httpLib.includes('reason: error.message }, { status: 403 }') || httpLib.includes('reason: error.message },\n      { status: 403'),
    "Algunas 403 no incluyen el reason para el cliente"
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
