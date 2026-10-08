import assert from "node:assert/strict";
import test from "node:test";
import { nextScheduledScanAt } from "@/modules/brain/cron-schedule";

/** vercel.json: "35 0-3,12-23 * * *" (UTC) = cada hora de 6:35 a 21:35 Managua (UTC-6 fijo). */

test("minutos antes de la marca :35 de una hora programada: el próximo escaneo es esa misma hora", () => {
  const now = new Date("2026-03-10T12:10:00Z"); // hora 12 UTC está en el cron
  const next = nextScheduledScanAt(now);
  assert.equal(next.toISOString(), "2026-03-10T12:35:00.000Z");
});

test("justo después de la marca :35: salta a la siguiente hora programada", () => {
  const now = new Date("2026-03-10T12:40:00Z");
  const next = nextScheduledScanAt(now);
  assert.equal(next.toISOString(), "2026-03-10T13:35:00.000Z");
});

test("LA QUE IMPORTA — en el hueco nocturno (4-11 UTC, fuera del cron), salta hasta las 12:35 UTC (6:35am Managua)", () => {
  const now = new Date("2026-03-10T05:00:00Z");
  const next = nextScheduledScanAt(now);
  assert.equal(next.toISOString(), "2026-03-10T12:35:00.000Z");
});

test("último tramo del día (23:xx UTC) cruza la medianoche hacia las 00:35 UTC", () => {
  const now = new Date("2026-03-10T23:50:00Z");
  const next = nextScheduledScanAt(now);
  assert.equal(next.toISOString(), "2026-03-11T00:35:00.000Z");
});
