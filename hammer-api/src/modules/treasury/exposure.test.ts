import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { computeOutstandingAwaitingDeposit, countBusinessDaysBetween } from "./exposure";

describe("computeOutstandingAwaitingDeposit — FIFO agregado", () => {
  it("sin depósitos -> todo lo declarado queda pendiente, fecha = la más vieja", () => {
    const declarations = [
      { createdAt: new Date("2026-08-01"), amount: 50000 },
      { createdAt: new Date("2026-08-05"), amount: 30000 },
    ];
    const result = computeOutstandingAwaitingDeposit(declarations, []);
    assert.equal(result.outstandingAmount, 80000);
    assert.deepEqual(result.oldestOutstandingDate, new Date("2026-08-01"));
  });

  it("un depósito cubre exactamente la declaración más vieja -> la más nueva queda como 'la más vieja pendiente'", () => {
    const declarations = [
      { createdAt: new Date("2026-08-01"), amount: 50000 },
      { createdAt: new Date("2026-08-05"), amount: 30000 },
    ];
    const deposits = [{ depositedAt: new Date("2026-08-02"), amount: 50000 }];
    const result = computeOutstandingAwaitingDeposit(declarations, deposits);
    assert.equal(result.outstandingAmount, 30000);
    assert.deepEqual(result.oldestOutstandingDate, new Date("2026-08-05"));
  });

  it("los depósitos cubren todo -> sin pendiente, fecha null", () => {
    const declarations = [{ createdAt: new Date("2026-08-01"), amount: 50000 }];
    const deposits = [{ depositedAt: new Date("2026-08-02"), amount: 50000 }];
    const result = computeOutstandingAwaitingDeposit(declarations, deposits);
    assert.equal(result.outstandingAmount, 0);
    assert.equal(result.oldestOutstandingDate, null);
  });

  it("depósito parcial dentro de la declaración más vieja -> esa sigue siendo la más vieja pendiente", () => {
    const declarations = [{ createdAt: new Date("2026-08-01"), amount: 50000 }];
    const deposits = [{ depositedAt: new Date("2026-08-02"), amount: 20000 }];
    const result = computeOutstandingAwaitingDeposit(declarations, deposits);
    assert.equal(result.outstandingAmount, 30000);
    assert.deepEqual(result.oldestOutstandingDate, new Date("2026-08-01"));
  });

  it("sin ninguna declaración -> sin pendiente", () => {
    const result = computeOutstandingAwaitingDeposit([], []);
    assert.equal(result.outstandingAmount, 0);
    assert.equal(result.oldestOutstandingDate, null);
  });

  it("el orden de entrada no importa — siempre ordena por fecha antes de aplicar FIFO", () => {
    const declarations = [
      { createdAt: new Date("2026-08-05"), amount: 30000 },
      { createdAt: new Date("2026-08-01"), amount: 50000 },
    ];
    const result = computeOutstandingAwaitingDeposit(declarations, []);
    assert.deepEqual(result.oldestOutstandingDate, new Date("2026-08-01"));
  });
});

describe("countBusinessDaysBetween — lunes a viernes", () => {
  it("mismo día -> 0", () => {
    assert.equal(countBusinessDaysBetween(new Date("2026-08-10T08:00:00Z"), new Date("2026-08-10T18:00:00Z")), 0);
  });

  it("lunes a martes -> 1 día hábil", () => {
    // 2026-08-10 es lunes
    assert.equal(countBusinessDaysBetween(new Date("2026-08-10"), new Date("2026-08-11")), 1);
  });

  it("viernes a lunes -> 1 día hábil (el fin de semana no cuenta)", () => {
    // 2026-08-14 viernes -> 2026-08-17 lunes
    assert.equal(countBusinessDaysBetween(new Date("2026-08-14"), new Date("2026-08-17")), 1);
  });

  it("una semana completa (lunes a lunes siguiente) -> 5 días hábiles", () => {
    assert.equal(countBusinessDaysBetween(new Date("2026-08-10"), new Date("2026-08-17")), 5);
  });

  it("fecha 'to' antes que 'from' -> 0, no negativo", () => {
    assert.equal(countBusinessDaysBetween(new Date("2026-08-17"), new Date("2026-08-10")), 0);
  });
});
