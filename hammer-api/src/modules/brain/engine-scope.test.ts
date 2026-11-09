import assert from "node:assert/strict";
import test from "node:test";
import { isNarrowedScan } from "@/modules/brain/engine";

test("escaneo completo (cron, Escanear ahora, Recalcular de Precios) sí puede auto-cerrar", () => {
  assert.equal(isNarrowedScan({ mode: "SCHEDULED_SCAN" }), false);
  assert.equal(isNarrowedScan({ mode: "SCHEDULED_SCAN", category: "PRICING", branchId: "b1" }), false);
});

test("escaneo acotado a una entidad, severidad o fechas no auto-cierra lo que no miró", () => {
  assert.equal(isNarrowedScan({ mode: "SCHEDULED_SCAN", saleOrderId: "o1" }), true);
  assert.equal(isNarrowedScan({ mode: "SCHEDULED_SCAN", productId: "p1" }), true);
  assert.equal(isNarrowedScan({ mode: "SCHEDULED_SCAN", severity: "CRITICAL" }), true);
  assert.equal(isNarrowedScan({ mode: "SCHEDULED_SCAN", dateFrom: "2026-11-01T00:00:00.000Z" }), true);
});
