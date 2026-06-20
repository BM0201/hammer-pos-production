import assert from "node:assert/strict";
import test from "node:test";
import { getOperationalWindowForManaguaDate } from "@/modules/sales/realtime-sales-summary";

test("realtime sales window uses Managua day at UTC-06", () => {
  const window = getOperationalWindowForManaguaDate("2026-06-10");

  assert.equal(window.businessDate, "2026-06-10");
  assert.equal(window.timezone, "America/Managua");
  assert.equal(window.start.toISOString(), "2026-06-10T06:00:00.000Z");
  assert.equal(window.end.toISOString(), "2026-06-11T06:00:00.000Z");
});

test("realtime sales window derives Managua date near UTC midnight", () => {
  const window = getOperationalWindowForManaguaDate(new Date("2026-06-11T03:30:00.000Z"));

  assert.equal(window.businessDate, "2026-06-10");
  assert.equal(window.start.toISOString(), "2026-06-10T06:00:00.000Z");
  assert.equal(window.end.toISOString(), "2026-06-11T06:00:00.000Z");
});
