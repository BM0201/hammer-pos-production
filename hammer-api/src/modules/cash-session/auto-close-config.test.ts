import assert from "node:assert/strict";
import test from "node:test";
import {
  DEFAULT_CASH_AUTO_CLOSE_CONFIG,
  normalizeCashAutoCloseConfig,
  omitUndefinedFields,
} from "@/modules/cash-session/auto-close-config";
import { getBlindCountStart, getCashAutoCloseDeadline, getCashAutoCloseInstant, isBlindCountTime } from "@/modules/cash-session/auto-close-service";

test("auto-close config: la caja se cierra sola 17:30 lun-vie y 15:30 sábado", () => {
  assert.equal(DEFAULT_CASH_AUTO_CLOSE_CONFIG.weekdayCloseTime, "17:30");
  assert.equal(DEFAULT_CASH_AUTO_CLOSE_CONFIG.saturdayCloseTime, "15:30");
  assert.equal(DEFAULT_CASH_AUTO_CLOSE_CONFIG.sundayCloseTime, null);
});

test("auto-close config: invalid time falls back to default, null is preserved", () => {
  const cfg = normalizeCashAutoCloseConfig({
    weekdayCloseTime: "99:99",
    saturdayCloseTime: null,
  });
  assert.equal(cfg.weekdayCloseTime, "17:30");
  assert.equal(cfg.saturdayCloseTime, null);
});

test("auto-close config: valid custom time is accepted", () => {
  const cfg = normalizeCashAutoCloseConfig({ weekdayCloseTime: "18:00", enabled: false });
  assert.equal(cfg.weekdayCloseTime, "18:00");
  assert.equal(cfg.enabled, false);
});

test("auto-close deadline: weekday before 17:30 is not expired, after is expired", () => {
  // 2026-06-09 is a Tuesday. Times are interpreted in America/Managua (UTC-6).
  const before = new Date("2026-06-09T22:00:00Z"); // 16:00 local
  const after = new Date("2026-06-09T23:45:00Z"); // 17:45 local
  assert.equal(getCashAutoCloseDeadline({ id: "b" }, before).expired, false);
  assert.equal(getCashAutoCloseDeadline({ id: "b" }, after).expired, true);
});

test("auto-close deadline: disabled config never expires", () => {
  const cfg = normalizeCashAutoCloseConfig({ enabled: false });
  const result = getCashAutoCloseDeadline({ id: "b" }, new Date("2026-06-09T23:45:00Z"), cfg);
  assert.equal(result.enabled, false);
  assert.equal(result.expired, false);
});

/**
 * Mismo bug que operations/auto-day-config.test.ts: un llamador que arma el
 * objeto de actualización listando todos los campos (algunos en undefined,
 * sin tocar) pisaba en silencio `enabled`/horarios ya guardados con el
 * default hardcodeado.
 */
test("omitUndefinedFields: elimina las claves en undefined, conserva false/null (valores reales)", () => {
  const result = omitUndefinedFields({ enabled: undefined, weekdayCloseTime: null, saturdayCloseTime: "16:00" });
  assert.ok(!("enabled" in result));
  assert.equal(result.weekdayCloseTime, null);
  assert.equal(result.saturdayCloseTime, "16:00");
});

test("bug reproducido y corregido: actualizar solo el horario ya no resetea 'enabled' al default", () => {
  const current = normalizeCashAutoCloseConfig({ enabled: true, weekdayCloseTime: "17:30" });
  const partialUpdateAsObjectLiteral = { enabled: undefined, weekdayCloseTime: "18:00" };

  const buggyMerge = normalizeCashAutoCloseConfig({ ...current, ...partialUpdateAsObjectLiteral });
  assert.equal(buggyMerge.enabled, true, "coincidencia: el default de 'enabled' ya es true, así que este caso no lo expone");

  const fixedMerge = normalizeCashAutoCloseConfig({ ...current, ...omitUndefinedFields(partialUpdateAsObjectLiteral) });
  assert.equal(fixedMerge.enabled, true, "con el fix: se conserva explícitamente, no por coincidencia del default");
  assert.equal(fixedMerge.weekdayCloseTime, "18:00");
});

test("auto-close instant: hora exacta de hoy en Managua, null si hoy no cierra solo", () => {
  // Viernes 10:00 Managua → cierra 17:30 Managua = 23:30Z
  assert.equal(getCashAutoCloseInstant(new Date("2026-11-20T16:00:00Z"))?.toISOString(), "2026-11-20T23:30:00.000Z");
  // Sábado 14:00 Managua → cierra 15:30 Managua = 21:30Z
  assert.equal(getCashAutoCloseInstant(new Date("2026-11-21T20:00:00Z"))?.toISOString(), "2026-11-21T21:30:00.000Z");
  // Viernes 23:00 Managua (sábado 05:00Z) sigue siendo viernes en Managua
  assert.equal(getCashAutoCloseInstant(new Date("2026-11-21T05:00:00Z"))?.toISOString(), "2026-11-20T23:30:00.000Z");
  // Domingo: no cierra solo
  assert.equal(getCashAutoCloseInstant(new Date("2026-11-22T16:00:00Z")), null);
});

test("aviso de contar: 20 min antes del cierre del NEGOCIO, aparte del cierre automático de caja", () => {
  const business = { timezone: "America/Managua", weekdayCloseTime: "17:00", saturdayCloseTime: "15:00", sundayCloseTime: null };
  // Caja se cierra sola 17:30 / 15:30; el negocio cierra 17:00 / 15:00 → aviso 16:40 / 14:40.
  assert.equal(getBlindCountStart(new Date("2026-11-20T16:00:00Z"), DEFAULT_CASH_AUTO_CLOSE_CONFIG, business)?.toISOString(), "2026-11-20T22:40:00.000Z");
  assert.equal(getBlindCountStart(new Date("2026-11-21T16:00:00Z"), DEFAULT_CASH_AUTO_CLOSE_CONFIG, business)?.toISOString(), "2026-11-21T20:40:00.000Z");
  assert.equal(isBlindCountTime(new Date("2026-11-20T22:39:00Z"), DEFAULT_CASH_AUTO_CLOSE_CONFIG, business), false);
  assert.equal(isBlindCountTime(new Date("2026-11-20T22:40:00Z"), DEFAULT_CASH_AUTO_CLOSE_CONFIG, business), true);
  // Negocio configurado DESPUÉS del cierre de caja (18:30): el aviso no llega tarde, sale 20 min antes de las 17:30.
  const late = { ...business, weekdayCloseTime: "18:30" };
  assert.equal(getBlindCountStart(new Date("2026-11-20T16:00:00Z"), DEFAULT_CASH_AUTO_CLOSE_CONFIG, late)?.toISOString(), "2026-11-20T23:10:00.000Z");
  // Domingo: ni negocio ni caja cierran → sin aviso.
  assert.equal(getBlindCountStart(new Date("2026-11-22T16:00:00Z"), DEFAULT_CASH_AUTO_CLOSE_CONFIG, business), null);
});

test("conteo a ciegas sin horario del negocio: 20 min antes del cierre de caja, nunca en día sin cierre", () => {
  // Viernes, caja se cierra 17:30 Managua = 23:30Z → desde 17:10 (23:10Z)
  assert.equal(isBlindCountTime(new Date("2026-11-20T23:09:00Z")), false);
  assert.equal(isBlindCountTime(new Date("2026-11-20T23:10:00Z")), true);
  // Sábado, caja se cierra 15:30 Managua = 21:30Z → desde 15:10 (21:10Z)
  assert.equal(isBlindCountTime(new Date("2026-11-21T21:09:00Z")), false);
  assert.equal(isBlindCountTime(new Date("2026-11-21T21:10:00Z")), true);
  assert.equal(isBlindCountTime(new Date("2026-11-22T23:20:00Z")), false); // domingo
});
