/**
 * Tests Fase 3: apertura por rol/fecha (I), reapertura segura + REOPENED_FOR_ADJUSTMENT (J),
 * cierre desde estado reabierto, y checklist de force-cleanup (L).
 *
 * Lógica de decisión inlineada (espejo de operations/service.ts y force-cleanup-service.ts);
 * los efectos en DB se cubren en integración.
 *
 * Run: node --import tsx --test src/modules/operations/operational-day-open-reopen.test.ts
 */

import assert from "node:assert/strict";
import { describe, it } from "node:test";

// ─── O.9 / I: reglas de apertura por rol y fecha ─────────────────────────────

describe("O.9/I apertura: rol y fecha (Managua)", () => {
  type OpenResult = "OK" | "DATE_NOT_TODAY" | "FUTURE_NOT_ALLOWED" | "NOTE_REQUIRED";

  // Espejo de openOperationalDay (I).
  function openGate(input: { isMaster: boolean; isToday: boolean; isFuture: boolean; hasNote: boolean }): OpenResult {
    if (!input.isToday) {
      if (!input.isMaster) return input.isFuture ? "FUTURE_NOT_ALLOWED" : "DATE_NOT_TODAY";
      if (!input.hasNote) return "NOTE_REQUIRED";
    }
    return "OK";
  }

  it("no-Master puede abrir HOY", () => {
    assert.equal(openGate({ isMaster: false, isToday: true, isFuture: false, hasNote: false }), "OK");
  });

  it("no-Master NO puede abrir una fecha pasada", () => {
    assert.equal(openGate({ isMaster: false, isToday: false, isFuture: false, hasNote: false }), "DATE_NOT_TODAY");
  });

  it("no-Master NO puede abrir una fecha futura", () => {
    assert.equal(openGate({ isMaster: false, isToday: false, isFuture: true, hasNote: false }), "FUTURE_NOT_ALLOWED");
  });

  it("Master abre fecha distinta SOLO con nota", () => {
    assert.equal(openGate({ isMaster: true, isToday: false, isFuture: false, hasNote: false }), "NOTE_REQUIRED");
    assert.equal(openGate({ isMaster: true, isToday: false, isFuture: false, hasNote: true }), "OK");
  });

  it("Master abre fecha futura con nota (override)", () => {
    assert.equal(openGate({ isMaster: true, isToday: false, isFuture: true, hasNote: true }), "OK");
  });
});

// ─── O.11 / J: reapertura segura ─────────────────────────────────────────────

describe("O.11/J reapertura: nota, sin otro día activo, estado destino", () => {
  type ReopenResult =
    | { result: "OK"; target: "OPEN" | "REOPENED_FOR_ADJUSTMENT" }
    | { result: "NOT_CLOSED" | "NOTE_REQUIRED" | "BLOCKED_ACTIVE_DAY_EXISTS" };

  // Espejo de reopenOperationalDay (J).
  function reopen(input: { status: string; hasNote: boolean; otherActiveExists: boolean; isToday: boolean }): ReopenResult {
    if (input.status !== "CLOSED") return { result: "NOT_CLOSED" };
    if (!input.hasNote) return { result: "NOTE_REQUIRED" };
    if (input.otherActiveExists) return { result: "BLOCKED_ACTIVE_DAY_EXISTS" };
    return { result: "OK", target: input.isToday ? "OPEN" : "REOPENED_FOR_ADJUSTMENT" };
  }

  it("día CLOSED de HOY → reabre como OPEN (reanuda operación)", () => {
    assert.deepEqual(reopen({ status: "CLOSED", hasNote: true, otherActiveExists: false, isToday: true }), {
      result: "OK",
      target: "OPEN",
    });
  });

  it("día CLOSED PASADO → REOPENED_FOR_ADJUSTMENT (ajuste Master, no operación normal)", () => {
    assert.deepEqual(reopen({ status: "CLOSED", hasNote: true, otherActiveExists: false, isToday: false }), {
      result: "OK",
      target: "REOPENED_FOR_ADJUSTMENT",
    });
  });

  it("bloquea si ya existe otro día activo en la sucursal", () => {
    assert.deepEqual(reopen({ status: "CLOSED", hasNote: true, otherActiveExists: true, isToday: true }), {
      result: "BLOCKED_ACTIVE_DAY_EXISTS",
    });
  });

  it("exige nota siempre", () => {
    assert.deepEqual(reopen({ status: "CLOSED", hasNote: false, otherActiveExists: false, isToday: true }), {
      result: "NOTE_REQUIRED",
    });
  });

  it("no reabre un día que no está CLOSED", () => {
    assert.deepEqual(reopen({ status: "OPEN", hasNote: true, otherActiveExists: false, isToday: true }), {
      result: "NOT_CLOSED",
    });
  });
});

// ─── Cierre desde REOPENED_FOR_ADJUSTMENT (re-finalizar tras ajuste) ─────────

describe("cierre acepta OPEN y REOPENED_FOR_ADJUSTMENT", () => {
  function claimClosing(status: string): "CLOSING" {
    if (status === "CLOSED") throw new Error("OPERATIONAL_DAY_ALREADY_CLOSED");
    if (status === "CANCELLED") throw new Error("OPERATIONAL_DAY_NOT_OPEN");
    if (status === "CLOSING") throw new Error("OPERATIONAL_DAY_CLOSING_IN_PROGRESS");
    if (!["OPEN", "REOPENED_FOR_ADJUSTMENT"].includes(status)) throw new Error("OPERATIONAL_DAY_NOT_OPEN");
    return "CLOSING";
  }

  it("OPEN → CLOSING", () => assert.equal(claimClosing("OPEN"), "CLOSING"));
  it("REOPENED_FOR_ADJUSTMENT → CLOSING (re-finaliza el ajuste)", () =>
    assert.equal(claimClosing("REOPENED_FOR_ADJUSTMENT"), "CLOSING"));
  it("CANCELLED no es cerrable", () => assert.throws(() => claimClosing("CANCELLED"), /NOT_OPEN/));
});

// ─── L: force-cleanup deja snapshot inmutable + flags forcedCleanup ──────────

describe("L force-cleanup: cierre forzado con checklist marcado", () => {
  // Espejo del closeChecklist de force-cleanup-service.
  function forcedCloseChecklist(previousState: string, reason: string) {
    return { forcedCleanup: true, reason, previousState, closedBy: "FORCE_CLEANUP_MASTER" };
  }

  it("el checklist de cierre forzado marca forcedCleanup, reason y previousState", () => {
    const c = forcedCloseChecklist("OPEN", "Cierre de emergencia");
    assert.equal(c.forcedCleanup, true);
    assert.equal(c.previousState, "OPEN");
    assert.equal(c.reason, "Cierre de emergencia");
  });
});
