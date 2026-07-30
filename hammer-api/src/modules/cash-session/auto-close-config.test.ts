import assert from "node:assert/strict";
import test from "node:test";
import {
  DEFAULT_CASH_AUTO_CLOSE_CONFIG,
  normalizeCashAutoCloseConfig,
  omitUndefinedFields,
} from "@/modules/cash-session/auto-close-config";
import { getCashAutoCloseDeadline } from "@/modules/cash-session/auto-close-service";

test("auto-close config: default weekday close time is 17:30", () => {
  assert.equal(DEFAULT_CASH_AUTO_CLOSE_CONFIG.weekdayCloseTime, "17:30");
  assert.equal(DEFAULT_CASH_AUTO_CLOSE_CONFIG.saturdayCloseTime, "16:00");
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
