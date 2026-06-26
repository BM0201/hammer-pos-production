/**
 * Tests Fase 4 (H): agregaciones del summary por operationalDayId
 * (totalsByPaymentMethod, changeAmount, refunds, expectedVsCounted) y separación
 * del daily report (operacional por id vs cronológico por ventana vs legacy).
 *
 * Espejos puros de operations/service.ts (calculateOperationalSummaryTx / getDailyReport).
 *
 * Run: node --import tsx --test src/modules/operations/operational-day-summary-report.test.ts
 */

import assert from "node:assert/strict";
import { describe, it } from "node:test";

const n = (v: number | null | undefined) => Number(v ?? 0);

// ─── H: totalsByPaymentMethod + changeAmount desde PaymentTender ──────────────

describe("H totales por método y vuelto (PaymentTender)", () => {
  type Tender = { method: string; amount: number; changeAmount: number };

  function totalsByMethod(tenders: Tender[]) {
    return tenders.reduce<Record<string, { amount: number; changeAmount: number; net: number }>>((acc, t) => {
      acc[t.method] = acc[t.method] ?? { amount: 0, changeAmount: 0, net: 0 };
      acc[t.method].amount += n(t.amount);
      acc[t.method].changeAmount += n(t.changeAmount);
      acc[t.method].net += n(t.amount) - n(t.changeAmount);
      return acc;
    }, {});
  }
  const changeTotal = (tenders: Tender[]) => tenders.reduce((s, t) => s + n(t.changeAmount), 0);

  const tenders: Tender[] = [
    { method: "CASH", amount: 1000, changeAmount: 120 },
    { method: "CASH", amount: 500, changeAmount: 0 },
    { method: "CARD", amount: 800, changeAmount: 0 },
    { method: "TRANSFER", amount: 300, changeAmount: 0 },
  ];

  it("agrupa por método con neto (amount - changeAmount)", () => {
    const t = totalsByMethod(tenders);
    assert.equal(t.CASH.amount, 1500);
    assert.equal(t.CASH.changeAmount, 120);
    assert.equal(t.CASH.net, 1380);
    assert.equal(t.CARD.net, 800);
    assert.equal(t.TRANSFER.net, 300);
  });

  it("changeAmountTotal suma el vuelto de todos los tenders", () => {
    assert.equal(changeTotal(tenders), 120);
  });
});

// ─── H: resumen de devoluciones (refunds) ────────────────────────────────────

describe("H refunds summary por método", () => {
  type Refund = { method: string; amount: number; status: string };
  function refundsSummary(refunds: Refund[]) {
    const byMethod = refunds.reduce<Record<string, number>>((acc, r) => {
      acc[r.method] = (acc[r.method] ?? 0) + n(r.amount);
      return acc;
    }, {});
    return { total: refunds.reduce((s, r) => s + n(r.amount), 0), count: refunds.length, byMethod };
  }

  it("totaliza devoluciones y agrupa por método", () => {
    const r = refundsSummary([
      { method: "CASH", amount: 200, status: "POSTED" },
      { method: "CASH", amount: 50, status: "POSTED" },
      { method: "TRANSFER", amount: 100, status: "POSTED" },
    ]);
    assert.equal(r.total, 350);
    assert.equal(r.count, 3);
    assert.equal(r.byMethod.CASH, 250);
    assert.equal(r.byMethod.TRANSFER, 100);
  });

  it("sin devoluciones → total 0", () => {
    const r = refundsSummary([]);
    assert.equal(r.total, 0);
    assert.equal(r.count, 0);
  });
});

// ─── H: expected vs counted por caja ─────────────────────────────────────────

describe("H expectedVsCountedByCashSession", () => {
  type Session = { id: string; code: string; expected: number; counted: number; difference: number; requiresReview: boolean };
  function mapEVC(sessions: Session[]) {
    return sessions.map((s) => ({
      cashSessionId: s.id,
      physicalCashBoxCode: s.code,
      expected: s.expected,
      counted: s.counted,
      difference: s.difference,
      requiresReview: s.requiresReview,
    }));
  }
  it("expone expected, counted y diferencia por caja", () => {
    const evc = mapEVC([
      { id: "s1", code: "C1", expected: 1000, counted: 980, difference: -20, requiresReview: true },
      { id: "s2", code: "C2", expected: 500, counted: 500, difference: 0, requiresReview: false },
    ]);
    assert.equal(evc.length, 2);
    assert.equal(evc[0].difference, -20);
    assert.equal(evc[0].requiresReview, true);
    assert.equal(evc[1].difference, 0);
  });
});

// ─── O.18: daily report separa operationalDayId vs cronológico vs legacy ──────

describe("O.18 daily report separa por operationalDayId, ventana y legacy", () => {
  type Order = { id: string; operationalDayId: string | null; inWindow: boolean };

  // Espejo del particionado de getDailyReport para el día "D".
  function partition(orders: Order[], dayId: string) {
    // (1) Operacional (híbrido): por operationalDayId, o legacy sin id dentro de la ventana.
    const operations = orders.filter((o) => o.operationalDayId === dayId || (o.operationalDayId === null && o.inWindow));
    // (2) Cronológico: TODO lo que cae en la ventana, sin importar el id.
    const chronological = orders.filter((o) => o.inWindow);
    // (3) Legacy fallback: en la ventana pero sin operationalDayId.
    const legacy = orders.filter((o) => o.operationalDayId === null && o.inWindow);
    return { operations, chronological, legacy };
  }

  it("no mezcla: id-taggeado fuera de ventana entra en operacional pero NO en cronológico", () => {
    const orders: Order[] = [
      { id: "a", operationalDayId: "D", inWindow: true },   // del día y en ventana
      { id: "b", operationalDayId: "D", inWindow: false },  // del día pero venta offline tardía (fuera de ventana)
      { id: "c", operationalDayId: null, inWindow: true },  // legacy en ventana
      { id: "d", operationalDayId: "OTHER", inWindow: true }, // de otro día pero cae en la ventana
    ];
    const p = partition(orders, "D");
    assert.deepEqual(p.operations.map((o) => o.id).sort(), ["a", "b", "c"]);
    assert.deepEqual(p.chronological.map((o) => o.id).sort(), ["a", "c", "d"]);
    assert.deepEqual(p.legacy.map((o) => o.id), ["c"]);
  });

  it("una venta offline tardía del día (fuera de ventana) cuenta en operacional, no en cronológico", () => {
    const orders: Order[] = [{ id: "late", operationalDayId: "D", inWindow: false }];
    const p = partition(orders, "D");
    assert.equal(p.operations.length, 1);
    assert.equal(p.chronological.length, 0);
  });
});

// ─── H/G: conteo de ventas offline pendientes de revisión (sync tras el cierre) ──

describe("lateOfflineSyncCount: offline sincronizado después del cierre", () => {
  type OfflineOrder = { offlineClientId: string | null; syncedAt: Date | null };

  // Espejo de la lógica de calculateOperationalSummaryTx / getCurrentOperationalDay.
  function lateOfflineCount(closedAt: Date | null, orders: OfflineOrder[]): number {
    if (!closedAt) return 0;
    return orders.filter((o) => o.offlineClientId !== null && o.syncedAt !== null && o.syncedAt.getTime() > closedAt.getTime()).length;
  }

  const closedAt = new Date("2026-06-15T22:00:00Z");

  it("día OPEN (sin closedAt) → 0 aunque haya offline sincronizado", () => {
    assert.equal(
      lateOfflineCount(null, [{ offlineClientId: "OFF-1", syncedAt: new Date("2026-06-15T12:00:00Z") }]),
      0,
    );
  });

  it("offline sincronizado DESPUÉS del cierre → cuenta como pendiente", () => {
    assert.equal(
      lateOfflineCount(closedAt, [{ offlineClientId: "OFF-1", syncedAt: new Date("2026-06-15T23:30:00Z") }]),
      1,
    );
  });

  it("offline sincronizado ANTES del cierre → no cuenta", () => {
    assert.equal(
      lateOfflineCount(closedAt, [{ offlineClientId: "OFF-1", syncedAt: new Date("2026-06-15T20:00:00Z") }]),
      0,
    );
  });

  it("orden normal (sin offlineClientId) → no cuenta aunque tenga syncedAt posterior", () => {
    assert.equal(
      lateOfflineCount(closedAt, [{ offlineClientId: null, syncedAt: new Date("2026-06-15T23:30:00Z") }]),
      0,
    );
  });
});
