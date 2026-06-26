/**
 * Tests Fase 2: cierre (E), aprobación/reconciliación (F), cancel (K), blockers (M).
 *
 * Donde la lógica es pura se importa la función real; donde toca DB (transiciones de
 * estado, FOR UPDATE) se inlinea un espejo de la máquina de estados. Los casos de
 * concurrencia real se cubren en integración.
 *
 * Run: node --import tsx --test src/modules/operations/operational-day-close-approve.test.ts
 */

import assert from "node:assert/strict";
import { describe, it, test } from "node:test";
import type { Prisma } from "@prisma/client";
import { computeApprovalBlockers } from "@/modules/operations/service";
import { isHardOperationalDayCloseBlocker } from "@/modules/operations/close-policy";
import { isHardApproveBlocker } from "@/modules/operations/approve-policy";

// ─── O.5 Cierre falla si hay caja OPEN (hard blocker) ────────────────────────

describe("O.5 hard blockers de cierre", () => {
  it("caja abierta es hard blocker de cierre", () => {
    assert.equal(isHardOperationalDayCloseBlocker("open_cash_sessions"), true);
  });
  it("auto-cerradas pendientes y pagos pendientes son hard", () => {
    assert.equal(isHardOperationalDayCloseBlocker("auto_closed_pending_review"), true);
    assert.equal(isHardOperationalDayCloseBlocker("pending_payments"), true);
  });
  it("despacho pendiente NO es hard (solo warning)", () => {
    assert.equal(isHardOperationalDayCloseBlocker("pending_dispatch"), false);
  });
  it("caja abierta/sin cobrar son hard blockers de aprobación", () => {
    assert.equal(isHardApproveBlocker("OPEN_OR_UNREVIEWED_CASH_SESSION"), true);
    assert.equal(isHardApproveBlocker("PENDING_PAYMENT_ORDER"), true);
    assert.equal(isHardApproveBlocker("OPEN_CREDIT_RECEIVABLE"), false);
  });
});

// ─── O.6/O.7/O.8 Máquina de estados de cierre (espejo) ───────────────────────

describe("O.6/O.7/O.8 transición OPEN→CLOSING→CLOSED con reversión y no-doble-cierre", () => {
  type Status = "OPEN" | "CLOSING" | "CLOSED" | "CANCELLED";

  // Espejo de la fase 1 de closeOperationalDay (claim atómico con updateMany condicional).
  function claimClosing(current: Status): { status: Status; claimed: boolean } {
    if (current === "CLOSED") throw new Error("OPERATIONAL_DAY_ALREADY_CLOSED");
    if (current === "CANCELLED") throw new Error("OPERATIONAL_DAY_NOT_OPEN");
    if (current === "CLOSING") throw new Error("OPERATIONAL_DAY_CLOSING_IN_PROGRESS");
    if (current !== "OPEN") throw new Error("OPERATIONAL_DAY_NOT_OPEN");
    return { status: "CLOSING", claimed: true };
  }
  function revertClosing(current: Status): Status {
    return current === "CLOSING" ? "OPEN" : current;
  }

  it("O.6 cierre exitoso recorre OPEN→CLOSING→CLOSED", () => {
    let s: Status = "OPEN";
    s = claimClosing(s).status;
    assert.equal(s, "CLOSING");
    s = "CLOSED"; // fase 2 finaliza
    assert.equal(s, "CLOSED");
  });

  it("O.7 doble cierre concurrente: el segundo intento ve CLOSING y no duplica", () => {
    const s: Status = "OPEN";
    const first = claimClosing(s);
    assert.equal(first.status, "CLOSING");
    // segundo intento sobre el estado ya reclamado
    assert.throws(() => claimClosing(first.status), /CLOSING_IN_PROGRESS/);
  });

  it("O.7 cierre sobre día ya CLOSED lanza ALREADY_CLOSED", () => {
    assert.throws(() => claimClosing("CLOSED"), /ALREADY_CLOSED/);
  });

  it("O.8 si la fase 2 falla, CLOSING vuelve a OPEN", () => {
    let s: Status = "CLOSING";
    s = revertClosing(s);
    assert.equal(s, "OPEN");
  });

  it("O.8 revert no toca un estado que no sea CLOSING", () => {
    assert.equal(revertClosing("CLOSED"), "CLOSED");
    assert.equal(revertClosing("OPEN"), "OPEN");
  });
});

// ─── O.13/F Reconciliación de aprobación (espejo de computeApprovalReconciliation) ──

describe("F reconciliación: recalculado vs closeSummaryJson + gate MIXED", () => {
  function reconcile(
    summary: Record<string, number>,
    closeSummary: Record<string, number> | null,
  ): { material: boolean; warnings: string[] } {
    if (!closeSummary) return { material: false, warnings: [] };
    const fields = ["salesTotal", "paidOrdersTotal", "pendingPaymentTotal", "cashDifferenceTotal", "countedCashTotal"];
    let material = false;
    const warnings: string[] = [];
    for (const f of fields) {
      const d = (summary[f] ?? 0) - (closeSummary[f] ?? 0);
      if (Math.abs(d) > 0.01) {
        material = true;
        warnings.push(`${f} Δ ${d.toFixed(2)}`);
      }
    }
    return { material, warnings };
  }

  // Espejo del gate F.7
  function approveGate(sourceMode: string, material: boolean, forced: boolean): "OK" | "BLOCKED" {
    const critical = sourceMode === "MIXED" && material;
    if (critical && !forced) return "BLOCKED";
    return "OK";
  }

  it("sin closeSummary previo no hay reconciliación material", () => {
    assert.equal(reconcile({ salesTotal: 100 }, null).material, false);
  });

  it("diferencia material detectada (venta offline tardía cambió el total)", () => {
    const r = reconcile({ salesTotal: 1140, cashDifferenceTotal: 0 }, { salesTotal: 1000, cashDifferenceTotal: 0 });
    assert.equal(r.material, true);
    assert.ok(r.warnings.some((w) => w.startsWith("salesTotal")));
  });

  it("F.7 MIXED + diferencia material sin override → BLOCKED", () => {
    assert.equal(approveGate("MIXED", true, false), "BLOCKED");
  });

  it("F.7 MIXED + diferencia material con override Master → OK", () => {
    assert.equal(approveGate("MIXED", true, true), "OK");
  });

  it("OPERATIONAL_DAY_ID con diferencia material no bloquea (fuente confiable)", () => {
    assert.equal(approveGate("OPERATIONAL_DAY_ID", true, false), "OK");
  });
});

// ─── O.12 Cancel bloquea día con actividad real (espejo) ─────────────────────

describe("O.12 cancel bloquea con pagos/actividad real; nunca cancela aprobado", () => {
  function canCancel(input: {
    approvedAt: Date | null;
    status: string;
    postedPayments: number;
    executedReturns: number;
    cashMovements: number;
    override?: boolean;
  }): "CANCEL_OK" | "BLOCKED_REAL_ACTIVITY" | "BLOCKED_APPROVED" {
    if (input.approvedAt) return "BLOCKED_APPROVED";
    const realActivity = input.postedPayments > 0 || input.executedReturns > 0 || input.cashMovements > 0;
    if (realActivity && !input.override) return "BLOCKED_REAL_ACTIVITY";
    return "CANCEL_OK";
  }

  it("día con pagos POSTED no se cancela sin override", () => {
    assert.equal(
      canCancel({ approvedAt: null, status: "OPEN", postedPayments: 3, executedReturns: 0, cashMovements: 0 }),
      "BLOCKED_REAL_ACTIVITY",
    );
  });

  it("día aprobado NUNCA se cancela (ni con override)", () => {
    assert.equal(
      canCancel({ approvedAt: new Date(), status: "CLOSED", postedPayments: 0, executedReturns: 0, cashMovements: 0, override: true }),
      "BLOCKED_APPROVED",
    );
  });

  it("día limpio se cancela", () => {
    assert.equal(
      canCancel({ approvedAt: null, status: "OPEN", postedPayments: 0, executedReturns: 0, cashMovements: 0 }),
      "CANCEL_OK",
    );
  });

  it("override permite cancelar con actividad (Master)", () => {
    assert.equal(
      canCancel({ approvedAt: null, status: "OPEN", postedPayments: 5, executedReturns: 0, cashMovements: 0, override: true }),
      "CANCEL_OK",
    );
  });
});

// ─── O.19 computeApprovalBlockers: count() real aunque el sample sea 20 ───────

test("O.19 computeApprovalBlockers reporta count real (25) con sample de 20 y hasMore=true", async () => {
  const sample = Array.from({ length: 20 }, (_, i) => ({
    id: `r${i}`,
    returnNumber: `RN-${i}`,
    status: "REQUESTED",
    createdAt: new Date(),
  }));
  const tx = {
    saleReturn: { count: async () => 25, findMany: async () => sample },
    saleCancellation: { count: async () => 0, findMany: async () => [] },
    transportService: { count: async () => 0, findMany: async () => [] },
    cashSession: { count: async () => 0, findMany: async () => [] },
    saleOrder: { count: async () => 0, findMany: async () => [] },
  } as unknown as Prisma.TransactionClient;

  const { blockers } = await computeApprovalBlockers(tx, {
    id: "day-1",
    branchId: "b1",
    businessDate: new Date("2026-06-20T00:00:00.000Z"),
  });
  const ret = blockers.find((b) => b.code === "PENDING_SALE_RETURN");
  assert.ok(ret, "debe existir el blocker de devoluciones");
  assert.equal(ret!.count, 25, "count real, no limitado por el sample");
  assert.equal(ret!.references.length, 20, "sample limitado a 20");
  assert.equal(ret!.sampleLimit, 20);
  assert.equal(ret!.hasMore, true);
});
