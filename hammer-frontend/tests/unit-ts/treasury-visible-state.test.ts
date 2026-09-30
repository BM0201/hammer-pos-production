/**
 * prompt-tesoreria-sin-transito.md Fase 2 — SOLO en la pantalla de
 * Tesorería, IN_TRANSIT_ONLY se ve como CLEAR (el tránsito es del día, ya
 * no se muestra ahí). Los demás estados quedan igual.
 */
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { treasuryVisibleState } from "@/lib/treasury-visible-state";

describe("treasuryVisibleState", () => {
  it("IN_TRANSIT_ONLY se ve como CLEAR", () => {
    assert.equal(treasuryVisibleState("IN_TRANSIT_ONLY"), "CLEAR");
  });

  it("los demás estados quedan igual", () => {
    const untouched = ["CRITICAL", "OVERDUE", "READY", "APPROACHING", "ACCUMULATING", "CLEAR"] as const;
    for (const state of untouched) {
      assert.equal(treasuryVisibleState(state), state);
    }
  });
});
