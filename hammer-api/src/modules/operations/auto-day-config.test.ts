import assert from "node:assert/strict";
import test from "node:test";
import {
  DEFAULT_OPERATIONAL_DAY_AUTO_CONFIG,
  normalizeOperationalDayAutoConfig,
  omitUndefinedFields,
} from "@/modules/operations/auto-day-config";

test("auto-day config: defaults match the documented schedule (7am open, 18:30 close, Sunday disabled)", () => {
  assert.equal(DEFAULT_OPERATIONAL_DAY_AUTO_CONFIG.autoOpenEnabled, false);
  assert.equal(DEFAULT_OPERATIONAL_DAY_AUTO_CONFIG.autoCloseEnabled, false);
  assert.equal(DEFAULT_OPERATIONAL_DAY_AUTO_CONFIG.weekdayOpenTime, "07:00");
  assert.equal(DEFAULT_OPERATIONAL_DAY_AUTO_CONFIG.weekdayCloseTime, "18:30");
  assert.equal(DEFAULT_OPERATIONAL_DAY_AUTO_CONFIG.sundayOpenTime, null);
});

test("auto-day config: invalid time falls back to default, explicit null (disable) is preserved", () => {
  const cfg = normalizeOperationalDayAutoConfig({ weekdayOpenTime: "99:99", sundayCloseTime: null });
  assert.equal(cfg.weekdayOpenTime, "07:00");
  assert.equal(cfg.sundayCloseTime, null);
});

test("auto-day config: valid custom hours are accepted as-is (el caso reportado: 7am / 17:30)", () => {
  const cfg = normalizeOperationalDayAutoConfig({
    autoOpenEnabled: true,
    autoCloseEnabled: true,
    weekdayOpenTime: "07:00",
    weekdayCloseTime: "17:30",
  });
  assert.equal(cfg.autoOpenEnabled, true);
  assert.equal(cfg.autoCloseEnabled, true);
  assert.equal(cfg.weekdayOpenTime, "07:00");
  assert.equal(cfg.weekdayCloseTime, "17:30");
});

/**
 * Bug reportado (2026-07-30): "yo tenía ese ajuste ahí pero como que no le
 * hace caso" — un llamador que construye el objeto de actualización listando
 * TODOS los campos (incluidos los que no toca, con valor `undefined`) hacía
 * que `{...current, ...input}` pisara el valor YA GUARDADO con el default
 * hardcodeado, porque normalizeOperationalDayAutoConfig no puede distinguir
 * "el campo no vino" de "vino en undefined". omitUndefinedFields es el fix:
 * se filtra ANTES del merge.
 */
test("omitUndefinedFields: elimina las claves en undefined, conserva false/null/0 (valores reales, no ausentes)", () => {
  const result = omitUndefinedFields({
    autoOpenEnabled: undefined,
    autoCloseEnabled: false,
    weekdayCloseTime: null,
    weekdayOpenTime: "07:00",
  });
  assert.ok(!("autoOpenEnabled" in result), "el campo en undefined se elimina, no se conserva como undefined");
  assert.equal(result.autoCloseEnabled, false, "false es un valor real, no se confunde con 'ausente'");
  assert.equal(result.weekdayCloseTime, null, "null (desactivar ese día) es un valor real, se conserva");
  assert.equal(result.weekdayOpenTime, "07:00");
});

test("bug reproducido y corregido: un objeto de actualización con TODOS los campos listados (algunos undefined) ya no resetea al default", () => {
  const current = normalizeOperationalDayAutoConfig({
    autoOpenEnabled: true,
    autoCloseEnabled: true,
    weekdayOpenTime: "07:00",
    weekdayCloseTime: "17:30",
  });

  // Simula EXACTAMENTE el patrón de operational-automation.ts: el llamador
  // solo quería cambiar weekdayCloseTime, pero construyó el objeto listando
  // TODOS los campos — los que no tocó llegan como `undefined` explícito.
  const partialUpdateAsObjectLiteral = {
    autoOpenEnabled: undefined,
    autoCloseEnabled: undefined,
    weekdayOpenTime: undefined,
    weekdayCloseTime: "18:00",
  };

  // Comportamiento VIEJO (sin el fix) — lo que causaba el bug reportado:
  const buggyMerge = normalizeOperationalDayAutoConfig({ ...current, ...partialUpdateAsObjectLiteral });
  assert.equal(buggyMerge.autoOpenEnabled, false, "bug reproducido: sin el fix, autoOpenEnabled=true se resetea a false (default)");
  assert.equal(buggyMerge.autoCloseEnabled, false, "bug reproducido: autoCloseEnabled=true tambien se resetea a false");

  // Comportamiento NUEVO (con el fix): se preserva todo lo no tocado.
  const fixedMerge = normalizeOperationalDayAutoConfig({ ...current, ...omitUndefinedFields(partialUpdateAsObjectLiteral) });
  assert.equal(fixedMerge.autoOpenEnabled, true, "con el fix: autoOpenEnabled sigue true, no se tocó");
  assert.equal(fixedMerge.autoCloseEnabled, true, "con el fix: autoCloseEnabled sigue true, no se tocó");
  assert.equal(fixedMerge.weekdayOpenTime, "07:00", "no tocado, se conserva");
  assert.equal(fixedMerge.weekdayCloseTime, "18:00", "el único campo realmente enviado sí cambia");
});
