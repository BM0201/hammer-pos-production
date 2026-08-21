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

/**
 * prompt-tesoreria-gasto-retenido-y-techo.md D-1 — un gasto pagado con
 * efectivo retenido baja el MONTO pendiente, pero NO envejece la
 * declaración: gastar no es depositar. Si envejeciera igual que un
 * depósito, gastar se volvería la forma de apagar la alarma de depósito
 * vencido.
 */
describe("computeOutstandingAwaitingDeposit — D-1 (gastos en efectivo retenido)", () => {
  it("un gasto reduce el monto pendiente", () => {
    const declarations = [{ createdAt: new Date("2026-08-01"), amount: 50000 }];
    const cashExpenses = [{ occurredAt: new Date("2026-08-10"), amount: 15000 }];
    const result = computeOutstandingAwaitingDeposit(declarations, [], cashExpenses);
    assert.equal(result.outstandingAmount, 35000);
  });

  it("un gasto NO mueve oldestOutstandingDate — la antigüedad se calcula solo contra depósitos", () => {
    const declarations = [
      { createdAt: new Date("2026-08-01"), amount: 50000 },
      { createdAt: new Date("2026-08-15"), amount: 20000 },
    ];
    // Sin este gasto, oldestOutstandingDate sería 2026-08-01 (nada depositado).
    // Con el gasto, el MONTO baja, pero la declaración más vieja sigue siendo
    // la misma — gastar no depositó nada.
    const cashExpenses = [{ occurredAt: new Date("2026-08-10"), amount: 15000 }];
    const result = computeOutstandingAwaitingDeposit(declarations, [], cashExpenses);
    assert.equal(result.outstandingAmount, 55000);
    assert.deepEqual(result.oldestOutstandingDate, new Date("2026-08-01"));
  });

  it("un depósito SÍ mueve oldestOutstandingDate (regresión — el camino ya existente sigue igual)", () => {
    const declarations = [
      { createdAt: new Date("2026-08-01"), amount: 50000 },
      { createdAt: new Date("2026-08-15"), amount: 20000 },
    ];
    const deposits = [{ depositedAt: new Date("2026-08-05"), amount: 50000 }];
    const result = computeOutstandingAwaitingDeposit(declarations, deposits, []);
    assert.deepEqual(result.oldestOutstandingDate, new Date("2026-08-15"));
  });

  it("gastos que superan lo retenido (declarado - depositado) → monto 0, nunca negativo, anomalía marcada", () => {
    const declarations = [{ createdAt: new Date("2026-08-01"), amount: 10000 }];
    const cashExpenses = [{ occurredAt: new Date("2026-08-10"), amount: 25000 }];
    const result = computeOutstandingAwaitingDeposit(declarations, [], cashExpenses);
    assert.equal(result.outstandingAmount, 0);
    assert.equal(result.oldestOutstandingDate, null);
    assert.equal(result.cashExpensesExceedRetained, true);
  });

  it("gastos que NO superan lo retenido → cashExpensesExceedRetained en false", () => {
    const declarations = [{ createdAt: new Date("2026-08-01"), amount: 50000 }];
    const cashExpenses = [{ occurredAt: new Date("2026-08-10"), amount: 15000 }];
    const result = computeOutstandingAwaitingDeposit(declarations, [], cashExpenses);
    assert.equal(result.cashExpensesExceedRetained, false);
  });

  it("gastos que se comen exactamente toda la pila (declarado - depositado) → el contador se apaga solo, sin antigüedad", () => {
    const declarations = [
      { createdAt: new Date("2026-08-01"), amount: 30000 },
      { createdAt: new Date("2026-08-10"), amount: 20000 },
    ];
    const cashExpenses = [{ occurredAt: new Date("2026-08-15"), amount: 50000 }];
    const result = computeOutstandingAwaitingDeposit(declarations, [], cashExpenses);
    assert.equal(result.outstandingAmount, 0);
    assert.equal(result.oldestOutstandingDate, null);
    assert.equal(result.cashExpensesExceedRetained, false, "50000 == 50000, no lo supera, lo cubre exacto");
  });

  it("sin cashExpenses (parámetro por defecto) — se comporta exactamente igual que antes de D-1", () => {
    const declarations = [{ createdAt: new Date("2026-08-01"), amount: 50000 }];
    const result = computeOutstandingAwaitingDeposit(declarations, []);
    assert.equal(result.outstandingAmount, 50000);
    assert.equal(result.cashExpensesExceedRetained, false);
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
