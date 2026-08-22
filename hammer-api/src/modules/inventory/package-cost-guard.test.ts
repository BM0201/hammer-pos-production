import assert from "node:assert/strict";
import test from "node:test";
import { Prisma } from "@prisma/client";
import { detectPackageCostAsUnitCost, WacValidationError } from "./wac";

/**
 * Cubre el guard que previene la causa raíz del incidente "Finanzas todo en
 * negativo": el personal ingresó el costo del PAQUETE completo (ej. un HIERRO =
 * 14 varillas, un metro/lata de arena/piedrín) en el campo de costo por UNIDAD
 * de un movimiento de entrada. Eso infló el WAC ~conversionFactor× y disparó el
 * COGS en cada venta posterior.
 *
 * Casos reales tomados de la base de datos de producción:
 *  - HIERRO 3/8 (factor 14, ref ~108): se ingresó 1275 → debe bloquear.
 *  - HIERRO 1/2 (factor 8,  ref ~236): se ingresó 1800 → debe bloquear.
 *  - Alza de precio normal (108 → 130): NO debe bloquear.
 */

const d = (v: number | string) => new Prisma.Decimal(v);

function run(over: Partial<Parameters<typeof detectPackageCostAsUnitCost>[0]>) {
  return detectPackageCostAsUnitCost({
    inbound: true,
    baseMovementUnitCost: d(0),
    existingWac: d(0),
    packageFactor: d(1),
    ...over,
  });
}

test("bloquea costo del paquete ingresado como costo unitario (HIERRO 3/8, factor 14)", () => {
  assert.throws(
    () => run({ baseMovementUnitCost: d(1275), existingWac: d(108), packageFactor: d(14) }),
    (err: unknown) => {
      assert.ok(err instanceof WacValidationError);
      assert.equal((err as WacValidationError).code, "SUSPECTED_PACKAGE_COST_AS_UNIT_COST");
      return true;
    },
  );
});

test("bloquea costo del paquete ingresado como costo unitario (HIERRO 1/2, factor 8)", () => {
  assert.throws(
    () => run({ baseMovementUnitCost: d(1800), existingWac: d(236), packageFactor: d(8) }),
    (err: unknown) => err instanceof WacValidationError,
  );
});

test("permite un alza de precio normal (108 → 130)", () => {
  assert.doesNotThrow(() =>
    run({ baseMovementUnitCost: d(130), existingWac: d(108), packageFactor: d(14) }),
  );
});

test("permite un alza fuerte pero razonable por debajo del umbral", () => {
  // umbral = 108 * 14 * 0.6 = 907.2 ; 500 pasa
  assert.doesNotThrow(() =>
    run({ baseMovementUnitCost: d(500), existingWac: d(108), packageFactor: d(14) }),
  );
});

test("no actúa en movimientos de salida", () => {
  assert.doesNotThrow(() =>
    run({ inbound: false, baseMovementUnitCost: d(1275), existingWac: d(108), packageFactor: d(14) }),
  );
});

test("no actúa cuando no hay WAC de referencia (primera entrada)", () => {
  assert.doesNotThrow(() =>
    run({ baseMovementUnitCost: d(1275), existingWac: d(0), packageFactor: d(14) }),
  );
});

test("no actúa en productos sueltos (factor < 4)", () => {
  assert.doesNotThrow(() =>
    run({ baseMovementUnitCost: d(1000), existingWac: d(100), packageFactor: d(2) }),
  );
});

test("allowHighUnitCost permite forzar un costo alto legítimo", () => {
  assert.doesNotThrow(() =>
    run({
      baseMovementUnitCost: d(1275),
      existingWac: d(108),
      packageFactor: d(14),
      allowHighUnitCost: true,
    }),
  );
});
