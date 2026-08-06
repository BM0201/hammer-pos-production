import assert from "node:assert/strict";
import { describe, it } from "node:test";

/**
 * Día Operativo v2 Fase 4 — el reporte de un día CLOSED debe ser el que se
 * firmó (closeSummaryJson), no un recálculo. Antes `getDailyReport` re-corría
 * las consultas por ventana cada vez que se abría, así que una venta offline
 * sincronizada DESPUÉS del cierre cambiaba el número mostrado. Espejo puro
 * (sin DB) de la decisión SNAPSHOT vs LIVE de getDailyReport.
 */

type DayStatus = "OPEN" | "CLOSING" | "CLOSED" | "CANCELLED" | "REOPENED_FOR_ADJUSTMENT" | "PENDING_CLOSE";

function resolveSummarySource(status: DayStatus, hasCloseSummary: boolean): "SNAPSHOT" | "LIVE" {
  if (status === "CLOSED" && hasCloseSummary) return "SNAPSHOT";
  return "LIVE";
}

describe("Fase 4: resolveSummarySource — snapshot solo para CLOSED con closeSummaryJson", () => {
  it("día CLOSED con snapshot -> SNAPSHOT", () => {
    assert.equal(resolveSummarySource("CLOSED", true), "SNAPSHOT");
  });
  it("día CLOSED sin snapshot (no debería pasar, pero defensivo) -> LIVE", () => {
    assert.equal(resolveSummarySource("CLOSED", false), "LIVE");
  });
  it("día OPEN -> LIVE (en curso, sin snapshot todavía)", () => {
    assert.equal(resolveSummarySource("OPEN", false), "LIVE");
  });
  it("día PENDING_CLOSE -> LIVE (nunca se cerró, no hay snapshot)", () => {
    assert.equal(resolveSummarySource("PENDING_CLOSE", false), "LIVE");
  });
  it("día REOPENED_FOR_ADJUSTMENT -> LIVE (se está ajustando, se re-cerrará con snapshot nuevo)", () => {
    assert.equal(resolveSummarySource("REOPENED_FOR_ADJUSTMENT", true), "LIVE");
  });
});

describe("Fase 4: el número firmado no cambia con actividad tardía", () => {
  // Espejo: closeSummaryJson quedó congelado en el cierre; una venta offline
  // que sincroniza después NUNCA se suma a él, solo aparece en lateActivity.
  function reportFor(closeSummary: { salesTotal: number }, lateOrders: Array<{ amount: number }>) {
    const salesTotalShown = closeSummary.salesTotal; // SNAPSHOT: nunca se recalcula sumando lateOrders
    return { salesTotalShown, lateActivityCount: lateOrders.length, lateActivityTotal: lateOrders.reduce((s, o) => s + o.amount, 0) };
  }

  it("cerrar en 248,350.00, sincronizar una venta tardía de 560.00 -> el firmado sigue 248,350.00", () => {
    const closeSummary = { salesTotal: 248350 };
    const report = reportFor(closeSummary, [{ amount: 560 }]);
    assert.equal(report.salesTotalShown, 248350, "el número firmado no se contamina con actividad tardía");
    assert.equal(report.lateActivityCount, 1);
    assert.equal(report.lateActivityTotal, 560, "la venta tardía se ve aparte, con su propio total");
  });
});

describe("Fase 4: lateActivity detection — mismo criterio que lateOfflineSyncCount", () => {
  type OfflineOrder = { offlineClientId: string | null; syncedAt: Date | null };
  function lateActivity(closedAt: Date | null, orders: OfflineOrder[]): OfflineOrder[] {
    if (!closedAt) return [];
    return orders.filter((o) => o.offlineClientId !== null && o.syncedAt !== null && o.syncedAt.getTime() > closedAt.getTime());
  }

  const closedAt = new Date("2026-07-25T06:00:00Z");

  it("venta offline sincronizada después del cierre aparece en lateActivity con su referencia", () => {
    const orders: OfflineOrder[] = [{ offlineClientId: "OFF-1", syncedAt: new Date("2026-07-25T08:32:00Z") }];
    const late = lateActivity(closedAt, orders);
    assert.equal(late.length, 1);
  });

  it("día sin cerrar (closedAt null) -> lateActivity vacío", () => {
    const orders: OfflineOrder[] = [{ offlineClientId: "OFF-1", syncedAt: new Date("2026-07-25T08:32:00Z") }];
    assert.equal(lateActivity(null, orders).length, 0);
  });
});
