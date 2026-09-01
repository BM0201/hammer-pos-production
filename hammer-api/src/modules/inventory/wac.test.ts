import assert from "node:assert/strict";
import test from "node:test";
import { Prisma } from "@prisma/client";
import {
  detectExcessiveWacJump,
  detectPackageCostAsUnitCost,
  detectSuspectedPackageCostOnFirstEntry,
  maxPackageFactorForSanityCheck,
  WacValidationError,
} from "@/modules/inventory/wac";

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

/**
 * "que el WAC deje de moverse sin que nadie lo decida... un tope al salto
 * del WAC" — detectExcessiveWacJump, PARTE B. Independiente de qué camino
 * causó el salto (compra, ajuste, saldo inicial): protege contra el mismo
 * error de siempre visto desde el ángulo del RESULTADO (cuánto se movió el
 * WAC), no de la causa.
 */
test("1. currentWac 18.55, newWac 30 (+62%) → EXCESSIVE_WAC_JUMP", () => {
  assert.throws(
    () => detectExcessiveWacJump({ currentWac: d(18.55), newWac: d(30), currentQty: d(100) }),
    (error: unknown) => error instanceof WacValidationError && error.code === "EXCESSIVE_WAC_JUMP",
  );
});

test("2. currentWac 18.55, newWac 25 (+35%) → pasa (dentro del +50% holgado)", () => {
  assert.doesNotThrow(() => detectExcessiveWacJump({ currentWac: d(18.55), newWac: d(25), currentQty: d(100) }));
});

test("3. currentQty 0 → pasa siempre, sin importar el salto (sin inventario previo no hay contra qué comparar)", () => {
  assert.doesNotThrow(() => detectExcessiveWacJump({ currentWac: d(18.55), newWac: d(999), currentQty: d(0) }));
});

test("4. allowLargeWacJump true → pasa siempre, el reintento explícito existe para esto", () => {
  assert.doesNotThrow(() => detectExcessiveWacJump({ currentWac: d(18.55), newWac: d(999), currentQty: d(100), allowLargeWacJump: true }));
});

test("5. currentWac 1.50 (relleno, bajo el FLOOR de 2) → pasa, lo cubre el guard de primera entrada (Parte D)", () => {
  assert.doesNotThrow(() => detectExcessiveWacJump({ currentWac: d(1.5), newWac: d(999), currentQty: d(100) }));
});

/**
 * "Cuando no haya WAC previo pero el producto SÍ pertenezca a un grupo de
 * fusión, usá como referencia el precio de venta" — detectSuspectedPackageCostOnFirstEntry,
 * PARTE D. El caso real reportado: METRO DE ARENA sin WAC previo, alguien
 * carga el costo del PAQUETE (LATA) completo como si fuera el costo por
 * unidad — nadie compra a C$470/unidad algo que se vende a C$35/unidad.
 */
test("6. Primera entrada, sin WAC previo, costo 470 contra precio de venta 35 del canónico → SUSPECTED_PACKAGE_COST_AS_UNIT_COST", () => {
  assert.throws(
    () => detectSuspectedPackageCostOnFirstEntry({
      inbound: true,
      hasExistingWacReference: false,
      baseMovementUnitCost: d(470),
      canonicalStandardSalePrice: d(35),
      packageFactor: d(40),
    }),
    (error: unknown) => error instanceof WacValidationError && error.code === "SUSPECTED_PACKAGE_COST_AS_UNIT_COST",
  );
});

test("detectSuspectedPackageCostOnFirstEntry: costo por unidad por debajo del precio de venta → pasa (lo normal)", () => {
  assert.doesNotThrow(() => detectSuspectedPackageCostOnFirstEntry({
    inbound: true,
    hasExistingWacReference: false,
    baseMovementUnitCost: d(18.55),
    canonicalStandardSalePrice: d(35),
    packageFactor: d(40),
  }));
});

test("detectSuspectedPackageCostOnFirstEntry: ya hay WAC de referencia real → no actúa, ese caso es de detectPackageCostAsUnitCost, no de este", () => {
  assert.doesNotThrow(() => detectSuspectedPackageCostOnFirstEntry({
    inbound: true,
    hasExistingWacReference: true,
    baseMovementUnitCost: d(470),
    canonicalStandardSalePrice: d(35),
    packageFactor: d(40),
  }));
});

test("detectSuspectedPackageCostOnFirstEntry: sin precio de venta cargado en el canónico (null) → no hay con qué comparar, pasa", () => {
  assert.doesNotThrow(() => detectSuspectedPackageCostOnFirstEntry({
    inbound: true,
    hasExistingWacReference: false,
    baseMovementUnitCost: d(470),
    canonicalStandardSalePrice: null,
    packageFactor: d(40),
  }));
});

test("detectSuspectedPackageCostOnFirstEntry: presentación suelta (factor 2, bajo MIN_FACTOR) → no dispara, mismo umbral que el guard hermano", () => {
  assert.doesNotThrow(() => detectSuspectedPackageCostOnFirstEntry({
    inbound: true,
    hasExistingWacReference: false,
    baseMovementUnitCost: d(470),
    canonicalStandardSalePrice: d(35),
    packageFactor: d(2),
  }));
});

test("detectSuspectedPackageCostOnFirstEntry: allowHighUnitCost=true → pasa, el reintento explícito existe para esto", () => {
  assert.doesNotThrow(() => detectSuspectedPackageCostOnFirstEntry({
    inbound: true,
    hasExistingWacReference: false,
    baseMovementUnitCost: d(470),
    canonicalStandardSalePrice: d(35),
    packageFactor: d(40),
    allowHighUnitCost: true,
  }));
});
