import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { isWithinExpectedLitHours } from "./schedule.ts";

describe("isWithinExpectedLitHours", () => {
  const negocioNormal = { startHour: 6, endHour: 20 }; // 6am-8pm

  it("2am, horario normal de negocio -> fuera de horario esperado (no debe disparar BLACK)", () => {
    assert.equal(isWithinExpectedLitHours(2, negocioNormal), false);
  });

  it("mediodía -> dentro del horario esperado", () => {
    assert.equal(isWithinExpectedLitHours(12, negocioNormal), true);
  });

  it("justo en el borde de inicio -> dentro", () => {
    assert.equal(isWithinExpectedLitHours(6, negocioNormal), true);
  });

  it("justo en el borde de fin -> fuera", () => {
    assert.equal(isWithinExpectedLitHours(20, negocioNormal), false);
  });

  it("ventana que cruza medianoche (ej. sucursal 24h con tramo nocturno iluminado 22-6)", () => {
    const nocturno = { startHour: 22, endHour: 6 };
    assert.equal(isWithinExpectedLitHours(23, nocturno), true);
    assert.equal(isWithinExpectedLitHours(3, nocturno), true);
    assert.equal(isWithinExpectedLitHours(12, nocturno), false);
  });
});
