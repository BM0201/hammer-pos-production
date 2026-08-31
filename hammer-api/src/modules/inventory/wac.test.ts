import assert from "node:assert/strict";
import test from "node:test";
import { Prisma } from "@prisma/client";
import { detectPackageCostAsUnitCost, maxPackageFactorForSanityCheck, WacValidationError } from "@/modules/inventory/wac";

function d(n: number) {
  return new Prisma.Decimal(n);
}

/**
 * "asegura el motor de mejor manera" (prompt-precios-vigentes-catalogo.md,
 * segundo bug reportado) — el guard anti "costo de paquete tecleado como
 * costo de unidad" (detectPackageCostAsUnitCost) protegía movimientos de
 * inventario (compras, ajustes) pero NUNCA la edición directa del costo del
 * canónico en Precios y costos. maxPackageFactorForSanityCheck es la pieza
 * nueva: decide con qué factor comparar (el mayor entre los derivados
 * activos del grupo) y si vale la pena chequear.
 */

test("maxPackageFactorForSanityCheck: sin miembros derivados, no hay con qué comparar (null)", () => {
  assert.equal(maxPackageFactorForSanityCheck([]), null);
});

test("maxPackageFactorForSanityCheck: presentación suelta (factor 2-3) no dispara — MIN_FACTOR=4, mismo umbral que el guard de movimientos", () => {
  assert.equal(maxPackageFactorForSanityCheck([d(2)]), null);
  assert.equal(maxPackageFactorForSanityCheck([d(3)]), null);
});

test("maxPackageFactorForSanityCheck: factor >= 4 sí dispara, y usa el MAYOR entre varios derivados", () => {
  const factor = maxPackageFactorForSanityCheck([d(2), d(30), d(4)]);
  assert.ok(factor !== null);
  assert.equal(factor!.toNumber(), 30, "HIERRO: varilla suelta (factor bajo) y bulto de 30 — el bulto es el que importa para la sospecha");
});

/**
 * Caso HIERRO completo: WAC real ~C$74.50/unidad, factor de bulto 30.
 * Teclear el costo del bulto completo (C$2,234.89) en el campo de costo
 * del canónico (por unidad) es exactamente la confusión que originó el
 * segundo reporte de este bug — y es exactamente lo que este guard, ya
 * usado en movimientos, ahora también atrapa acá.
 */
test("HIERRO: escribir el costo del bulto (30x) como costo de unidad del canónico dispara la sospecha", () => {
  const packageFactor = maxPackageFactorForSanityCheck([d(30)]);
  assert.ok(packageFactor !== null);
  assert.throws(
    () => detectPackageCostAsUnitCost({
      inbound: true,
      baseMovementUnitCost: d(2234.89),
      existingWac: d(74.5),
      packageFactor: packageFactor!,
      allowHighUnitCost: false,
    }),
    (error: unknown) => error instanceof WacValidationError && error.code === "SUSPECTED_PACKAGE_COST_AS_UNIT_COST",
  );
});

test("HIERRO: el costo real por unidad (~C$74.50, con una suba normal) NO dispara la sospecha", () => {
  const packageFactor = maxPackageFactorForSanityCheck([d(30)]);
  assert.doesNotThrow(() => detectPackageCostAsUnitCost({
    inbound: true,
    baseMovementUnitCost: d(80), // subió de 74.50 a 80 — suba normal, no es el bulto
    existingWac: d(74.5),
    packageFactor: packageFactor!,
    allowHighUnitCost: false,
  }));
});

test("HIERRO: con allowHighUnitCost=true, el costo del bulto se acepta — el reintento explícito existe para esto", () => {
  const packageFactor = maxPackageFactorForSanityCheck([d(30)]);
  assert.doesNotThrow(() => detectPackageCostAsUnitCost({
    inbound: true,
    baseMovementUnitCost: d(2234.89),
    existingWac: d(74.5),
    packageFactor: packageFactor!,
    allowHighUnitCost: true,
  }));
});
