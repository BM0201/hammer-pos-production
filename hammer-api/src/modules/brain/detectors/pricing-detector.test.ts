import assert from "node:assert/strict";
import test from "node:test";
import { isPriceStaleAgainstCost } from "@/modules/brain/detectors/pricing-detector";

/**
 * Fase 1.2 (prompt-motor-precios-lote-herencia-gobierno.md) — la señal
 * COST_CHANGED_PRICE_STALE evita que un producto se venda meses al precio
 * viejo después de una compra que subió el costo.
 *
 * detectPricingDecisions hace consultas batch contra prisma real (sin `db`
 * inyectable) — no hay forma honesta de probar la función completa sin base
 * de datos. isPriceStaleAgainstCost es la condición pura que decide si esta
 * señal dispara, aislada exactamente para poder probarla sin DB, mismo
 * principio que isLateSyncIntoClosedDay/classifyTenderForLedger en otros
 * módulos de esta sesión.
 */

test("Prueba 6 — costUpdatedAt posterior a lastPriceUpdateAt genera la señal", () => {
  assert.equal(
    isPriceStaleAgainstCost({
      branchPrice: 150,
      costUpdatedAt: new Date("2026-08-20T00:00:00Z"),
      lastPriceUpdateAt: new Date("2026-08-10T00:00:00Z"),
    }),
    true,
  );
});

test("Prueba 7 — lastPriceUpdateAt null con branchPrice presente también la genera", () => {
  assert.equal(
    isPriceStaleAgainstCost({ branchPrice: 150, costUpdatedAt: new Date("2026-08-20T00:00:00Z"), lastPriceUpdateAt: null }),
    true,
  );
});

test("Prueba 8 — costo actualizado ANTES del último precio no genera nada", () => {
  assert.equal(
    isPriceStaleAgainstCost({
      branchPrice: 150,
      costUpdatedAt: new Date("2026-08-01T00:00:00Z"),
      lastPriceUpdateAt: new Date("2026-08-10T00:00:00Z"),
    }),
    false,
  );
});

test("sin branchPrice fijado, no hay 'última vez que se fijó el precio' que comparar — no dispara", () => {
  assert.equal(
    isPriceStaleAgainstCost({ branchPrice: null, costUpdatedAt: new Date("2026-08-20T00:00:00Z"), lastPriceUpdateAt: null }),
    false,
  );
});

test("sin costUpdatedAt (nunca se registró el costo), no hay nada que comparar — no dispara", () => {
  assert.equal(isPriceStaleAgainstCost({ branchPrice: 150, costUpdatedAt: null, lastPriceUpdateAt: null }), false);
});
