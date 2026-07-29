import assert from "node:assert/strict";
import { test } from "node:test";
import { InventoryMovementType } from "@prisma/client";
import {
  MOVEMENT_TYPE_GROUP,
  MOVEMENT_TYPES_BY_GROUP,
  MOVEMENT_GROUP_LABEL,
  resolveMovementGroup,
  signedMovementQuantity,
} from "@/modules/reports/movement-groups";

// CAMBIO 4 (prompt-reportes-v2): movement-groups.ts es el único lugar donde se
// clasifica un InventoryMovementType en un grupo del reporte — estos tests
// aseguran que el mapa sigue cubriendo TODO el enum (si Prisma agrega un
// valor nuevo sin actualizar el mapa, este test debe fallar, no el reporte
// en producción con un grupo "undefined").

test("movement-groups: todos los valores de InventoryMovementType tienen exactamente un grupo", () => {
  const enumValues = Object.values(InventoryMovementType) as InventoryMovementType[];
  const mappedKeys = Object.keys(MOVEMENT_TYPE_GROUP) as InventoryMovementType[];

  assert.deepEqual(
    [...mappedKeys].sort(),
    [...enumValues].sort(),
    "MOVEMENT_TYPE_GROUP debe mapear exactamente los mismos valores que el enum Prisma (ni de más, ni de menos)",
  );

  for (const type of enumValues) {
    const group = resolveMovementGroup(type);
    assert.ok(
      ["envios", "ingresos", "conteos", "ventas"].includes(group),
      `${type} debe resolver a un grupo válido, obtuvo "${group}"`,
    );
  }
});

test("movement-groups: MOVEMENT_TYPES_BY_GROUP es la inversa exacta de MOVEMENT_TYPE_GROUP", () => {
  for (const [type, group] of Object.entries(MOVEMENT_TYPE_GROUP)) {
    assert.ok(
      MOVEMENT_TYPES_BY_GROUP[group].includes(type as InventoryMovementType),
      `${type} (grupo ${group}) debe aparecer en MOVEMENT_TYPES_BY_GROUP.${group}`,
    );
  }
  const totalInGroups = Object.values(MOVEMENT_TYPES_BY_GROUP).reduce((sum, list) => sum + list.length, 0);
  assert.equal(totalInGroups, Object.keys(MOVEMENT_TYPE_GROUP).length);
});

test("movement-groups: cada grupo tiene una etiqueta en español para la UI", () => {
  for (const group of Object.keys(MOVEMENT_TYPES_BY_GROUP) as (keyof typeof MOVEMENT_GROUP_LABEL)[]) {
    assert.ok(MOVEMENT_GROUP_LABEL[group]?.length > 0, `el grupo ${group} debe tener label`);
  }
});

test("movement-groups: clasificaciones puntuales acordadas (no adivinadas, ver comentarios del archivo)", () => {
  // PACKAGE_IN es un ingreso (variante empaquetada de PURCHASE_IN), aunque su
  // nombre por sí solo no lo deje claro.
  assert.equal(resolveMovementGroup("PACKAGE_IN"), "ingresos");
  // RETURN_OUT no es un traslado ni una venta — es una salida de bodega sin
  // contrapartida comercial, misma naturaleza que un ajuste.
  assert.equal(resolveMovementGroup("RETURN_OUT"), "conteos");
  // PRODUCTION_WASTE/REVERSAL son correcciones de producción, no ingresos ni ventas.
  assert.equal(resolveMovementGroup("PRODUCTION_WASTE"), "conteos");
  assert.equal(resolveMovementGroup("PRODUCTION_REVERSAL_IN"), "conteos");
  assert.equal(resolveMovementGroup("PRODUCTION_REVERSAL_OUT"), "conteos");
  // Traslados entre sucursales, ambos sentidos.
  assert.equal(resolveMovementGroup("TRANSFER_OUT"), "envios");
  assert.equal(resolveMovementGroup("TRANSFER_IN"), "envios");
  // Ventas de materiales (las 3 variantes: normal, paquete, suelta).
  assert.equal(resolveMovementGroup("SALE_OUT"), "ventas");
  assert.equal(resolveMovementGroup("PACKAGE_SALE_OUT"), "ventas");
  assert.equal(resolveMovementGroup("LOOSE_UNIT_SALE_OUT"), "ventas");
});

test("signedMovementQuantity: las salidas son negativas, las entradas positivas, sin importar el signo de entrada", () => {
  assert.equal(signedMovementQuantity("SALE_OUT", 10), -10);
  assert.equal(signedMovementQuantity("SALE_OUT", -10), -10);
  assert.equal(signedMovementQuantity("PURCHASE_IN", 10), 10);
  assert.equal(signedMovementQuantity("PURCHASE_IN", -10), 10);
  assert.equal(signedMovementQuantity("TRANSFER_OUT", 5), -5);
  assert.equal(signedMovementQuantity("TRANSFER_IN", 5), 5);
  assert.equal(signedMovementQuantity("ADJUSTMENT_OUT", 3), -3);
  assert.equal(signedMovementQuantity("ADJUSTMENT_IN", 3), 3);
});
