import assert from "node:assert/strict";
import test from "node:test";
import { isLateSyncIntoClosedDay } from "@/modules/sales/offline-sync.service";

/**
 * FIX 2 (captura "Destino del efectivo"): syncOfflineSale ya creaba el
 * PaymentTender de una venta offline pero nunca resincronizaba
 * expectedCashAmount — la columna quedaba stale hasta el próximo movimiento
 * de caja, y "Destino del efectivo" mostraba efectivo cobrado con
 * disponible C$0.00 al mismo tiempo (ver cash-destination-summary.test.ts,
 * Prueba 2 — la regresión real vive del lado de la LECTURA, acá se prueba
 * el lado de la ESCRITURA).
 *
 * syncOfflineSale (offline-sync.service.ts) abre su PROPIA transacción y
 * llama a getEffectiveProductPricing/resolvePolicyForProduct/
 * buildCommercialIntelligenceForProduct — funciones que usan el cliente
 * global de Prisma para validar cada línea ANTES de que exista ningún `tx`
 * inyectable. No hay forma honesta de probar sus efectos reales en DB
 * (¿se actualizó expectedCashAmount? ¿se escribió el audit log?) sin una
 * base de datos real — mismo límite que offline-sync-totals.test.ts ya
 * documenta para este archivo ("Los efectos en DB ... se cubren en
 * integración/QA manual").
 *
 * Lo que SÍ es puro y se prueba acá de verdad es el límite que decide cuál
 * de las dos ramas corre: isLateSyncIntoClosedDay. Las pruebas 7/8 del doc
 * (expectedCashAmount se actualiza en día abierto / no cambia y queda
 * LATE_OFFLINE_SYNC_INTO_CLOSED_DAY en día cerrado) están cubiertas a nivel
 * de código — `if (!lateSyncIntoClosedDay) { await
 * syncCashSessionSnapshotTx(...) }` inmediatamente antes del bloque
 * `if (lateSyncIntoClosedDay)` ya existente — pero su verificación real
 * contra una fila de CashSession requiere la base de datos que la sección
 * "VERIFICACIÓN CON BASE DE DATOS" del doc ya pide correr aparte.
 */

test("Prueba 7 (límite) — día operativo ACTIVE (abierto) → NO es sincronización tardía, se sincroniza el snapshot", () => {
  assert.equal(isLateSyncIntoClosedDay("ACTIVE"), false);
});

test("Prueba 7b (límite) — sesión sin día operativo asociado (null/undefined) → tampoco es tardía", () => {
  assert.equal(isLateSyncIntoClosedDay(null), false);
  assert.equal(isLateSyncIntoClosedDay(undefined), false);
});

test("Prueba 8 (límite) — día operativo AWAITING_REVIEW (cerrado, sin aprobar) → SÍ es sincronización tardía, no se toca el snapshot", () => {
  assert.equal(isLateSyncIntoClosedDay("AWAITING_REVIEW"), true);
});

test("un día CANCELLED tampoco cuenta como 'tardía hacia un día cerrado esperando revisión' — solo AWAITING_REVIEW dispara esa rama", () => {
  assert.equal(isLateSyncIntoClosedDay("CANCELLED"), false);
});
