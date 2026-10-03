/**
 * Períodos del hub de Producción (src/lib/production-period.ts).
 * Ejecutar: npm run test:unit:logic
 */
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { resolvePeriod } from "@/lib/production-period";
import { batchStatus, recipeFamilyLabel, recommendationPriority, INCOMPLETE_RECIPE_REASON } from "@/lib/production-labels";

describe("resolvePeriod", () => {
  const now = new Date("2026-10-02T17:00:00Z");

  it("este mes: desde el 1 a las 00:00 de Managua hasta ahora", () => {
    const { from, to } = resolvePeriod("THIS_MONTH", now);
    assert.equal(from.toISOString(), "2026-10-01T06:00:00.000Z");
    assert.equal(to.toISOString(), now.toISOString());
  });

  it("mes anterior: el mes completo, sin tocar el actual", () => {
    const { from, to } = resolvePeriod("LAST_MONTH", now);
    assert.equal(from.toISOString(), "2026-09-01T06:00:00.000Z");
    assert.equal(to.toISOString(), "2026-10-01T05:59:59.999Z");
  });

  it("enero: el mes anterior es diciembre del año pasado", () => {
    const { from } = resolvePeriod("LAST_MONTH", new Date("2026-01-15T12:00:00Z"));
    assert.equal(from.toISOString(), "2025-12-01T06:00:00.000Z");
  });

  it("de madrugada UTC todavía es el día anterior en Managua", () => {
    const { from } = resolvePeriod("THIS_MONTH", new Date("2026-10-01T03:00:00Z"));
    assert.equal(from.toISOString(), "2026-09-01T06:00:00.000Z");
  });

  it("últimos 90 días", () => {
    const { from } = resolvePeriod("LAST_90_DAYS", now);
    assert.equal(now.getTime() - from.getTime(), 90 * 86_400_000);
  });
});

describe("production-labels", () => {
  it("traduce códigos conocidos y deja pasar los desconocidos", () => {
    assert.deepEqual(batchStatus("REVERSED"), { label: "Revertido", tone: "danger" });
    assert.equal(batchStatus("NUEVO_ESTADO").label, "NUEVO_ESTADO");
    assert.equal(recipeFamilyLabel("BLOCKS"), "Bloques");
    assert.equal(recommendationPriority("URGENT").label, "Urgente");
  });

  it("razones de receta incompleta: las de ESTE backend (ZERO_COST_INPUT), no las del patch original", () => {
    assert.equal(INCOMPLETE_RECIPE_REASON.NO_INPUTS, "no tiene insumos");
    assert.equal(INCOMPLETE_RECIPE_REASON.ZERO_COST_INPUT, "tiene un insumo sin costo efectivo en esta sucursal");
    assert.equal(INCOMPLETE_RECIPE_REASON.INVALID_EXPECTED_QUANTITY, "no indica cuánto produce");
  });
});
