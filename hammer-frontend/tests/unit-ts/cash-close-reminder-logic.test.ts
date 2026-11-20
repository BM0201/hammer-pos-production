/**
 * Aviso previo al cierre automático (cash-close-reminder.tsx): cuándo avisa.
 * La API manda el inicio del conteo (20 min antes) y la hora de cierre.
 *
 * Ejecutar: npm run test:unit:logic
 */
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { closeReminderPhase } from "@/components/pos/components/cash-close-reminder";

describe("closeReminderPhase", () => {
  const closeAt = Date.parse("2026-11-20T23:00:00Z"); // 5:00 p. m. Managua
  const countFrom = closeAt - 20 * 60_000; // 4:40 p. m.
  it("calla antes de que empiece el conteo", () => {
    assert.equal(closeReminderPhase(countFrom - 1, countFrom, closeAt), "none");
  });
  it("avisa desde el inicio del conteo hasta la hora de cierre", () => {
    assert.equal(closeReminderPhase(countFrom, countFrom, closeAt), "soon");
    assert.equal(closeReminderPhase(closeAt - 1, countFrom, closeAt), "soon");
  });
  it("pasada la hora, insiste", () => {
    assert.equal(closeReminderPhase(closeAt, countFrom, closeAt), "overdue");
  });
});
