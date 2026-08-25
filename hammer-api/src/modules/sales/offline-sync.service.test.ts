import assert from "node:assert/strict";
import test from "node:test";
import { PaymentMethod } from "@prisma/client";
import { isLateSyncIntoClosedDay, syncOfflineSale } from "@/modules/sales/offline-sync.service";

/**
 * Parte B (prompt-tesoreria-dinero-digital.md): las ventas offline forzaban
 * todo a CASH. B.1 decide explícitamente: offline es efectivo y nada más
 * — un método distinto se rechaza ruidoso (OFFLINE_SALE_CASH_ONLY) en vez
 * de convertirse en efectivo en silencio. B.2 agrega que, en día abierto,
 * la venta offline ahora sí escribe en el libro mayor
 * (recordSaleTenderEntriesTx) y resincroniza expectedCashAmount
 * (syncCashSessionSnapshotTx) — antes de este fix ninguna de las dos se
 * llamaba nunca desde este archivo.
 *
 * syncOfflineSale abre su PROPIA transacción y llama a
 * getEffectiveProductPricing/resolvePolicyForProduct/
 * buildCommercialIntelligenceForProduct — funciones que usan el cliente
 * global de Prisma para validar cada línea ANTES de que exista ningún `tx`
 * inyectable. No hay forma honesta de probar sus efectos reales en DB
 * (¿se llamó recordSaleTenderEntriesTx? ¿se escribió el audit log?) sin una
 * base de datos real — mismo límite que offline-sync-totals.test.ts ya
 * documenta para este archivo ("Los efectos en DB ... se cubren en
 * integración/QA manual").
 *
 * Prueba 6 SÍ es 100% real contra la función exportada: el guard de método
 * es la primerísima línea de syncOfflineSale, antes de tocar `prisma` para
 * nada — así que rechaza sin necesitar base de datos.
 *
 * Pruebas 7/8 prueban el límite puro que decide cuál de las dos ramas
 * corre — recordSaleTenderEntriesTx + syncCashSessionSnapshotTx (día
 * abierto) vs. el audit log LATE_OFFLINE_SYNC_INTO_CLOSED_DAY (día
 * cerrado) — ambas gateadas por el MISMO booleano, isLateSyncIntoClosedDay.
 * Que ese booleano salga bien es lo que garantiza que las llamadas de
 * B.2 corran en la rama correcta; verificar la llamada real en sí
 * requiere la base de datos que "VERIFICACIÓN CON BASE DE DATOS" ya pide
 * correr aparte.
 */

test("Prueba 6 (LA QUE IMPORTA) — un lote offline con método no-efectivo es rechazado (OFFLINE_SALE_CASH_ONLY), nunca convertido a CASH en silencio", async () => {
  await assert.rejects(
    () => syncOfflineSale({
      offlineId: "offline-1",
      branchId: "branch-1",
      cashSessionId: "session-1",
      actorUserId: "user-1",
      lines: [],
      grandTotal: 100,
      createdAt: new Date().toISOString(),
      method: PaymentMethod.TRANSFER,
    }),
    /OFFLINE_SALE_CASH_ONLY/,
  );
});

test("Prueba 7 (límite) — día operativo ACTIVE (abierto) → NO es sincronización tardía: recordSaleTenderEntriesTx y syncCashSessionSnapshotTx SÍ corren", () => {
  assert.equal(isLateSyncIntoClosedDay("ACTIVE"), false);
});

test("Prueba 7b (límite) — sesión sin día operativo asociado (null/undefined) → tampoco es tardía", () => {
  assert.equal(isLateSyncIntoClosedDay(null), false);
  assert.equal(isLateSyncIntoClosedDay(undefined), false);
});

test("Prueba 8 (límite) — día operativo AWAITING_REVIEW (cerrado, sin aprobar) → SÍ es sincronización tardía: ninguna de las dos corre, se escribe LATE_OFFLINE_SYNC_INTO_CLOSED_DAY en su lugar", () => {
  assert.equal(isLateSyncIntoClosedDay("AWAITING_REVIEW"), true);
});

test("un día CANCELLED tampoco cuenta como 'tardía hacia un día cerrado esperando revisión' — solo AWAITING_REVIEW dispara esa rama", () => {
  assert.equal(isLateSyncIntoClosedDay("CANCELLED"), false);
});
