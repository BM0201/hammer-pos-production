/**
 * device-battery.test.mjs — texto del indicador de batería de la caja
 * (src/lib/battery.ts). Node 22 importa el .ts directo (type stripping).
 *
 * Ejecutar: npm run test:unit
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import { batteryLabel } from "../../src/lib/battery.ts";

const reading = (over) => ({ level: 0.5, charging: false, chargingTime: Infinity, dischargingTime: Infinity, ...over });

test("redondea el nivel a porcentaje entero", () => {
  assert.equal(batteryLabel(reading({ level: 0.874 })).percent, 87);
  assert.equal(batteryLabel(reading({ level: 1 })).percent, 100);
});

test("descargando con tiempo conocido muestra lo que queda", () => {
  const r = batteryLabel(reading({ level: 0.6, dischargingTime: 3 * 3600 + 20 * 60 }));
  assert.equal(r.detail, "quedan 3 h 20 min");
  assert.equal(r.low, false);
});

test("cargando con tiempo conocido muestra cuándo se llena", () => {
  assert.equal(batteryLabel(reading({ charging: true, chargingTime: 45 * 60 })).detail, "llena en 45 min");
  assert.equal(batteryLabel(reading({ charging: true, chargingTime: 2 * 3600 })).detail, "llena en 2 h");
});

test("sin tiempo estimado usa el estado", () => {
  assert.equal(batteryLabel(reading({ charging: true })).detail, "Cargando");
  assert.equal(batteryLabel(reading({ level: 1, charging: true, chargingTime: 0 })).detail, "Cargada");
  assert.equal(batteryLabel(reading({})).detail, "");
});

test("baja solo si no está cargando y está en 20% o menos", () => {
  assert.equal(batteryLabel(reading({ level: 0.2 })).low, true);
  assert.equal(batteryLabel(reading({ level: 0.21 })).low, false);
  assert.equal(batteryLabel(reading({ level: 0.1, charging: true })).low, false);
});
