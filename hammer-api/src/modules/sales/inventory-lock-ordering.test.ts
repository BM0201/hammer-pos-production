import assert from "node:assert/strict";
import test from "node:test";
import { computeInventoryLockProductIds } from "@/modules/sales/service";

/**
 * prompt-flujo-velocidad.md Fase 1: el loop de FOR UPDATE por producto en
 * submitDirectSale se reemplazó por una sola consulta ANY(...) ORDER BY
 * productId. Lo que evita el deadlock entre dos ventas concurrentes que
 * comparten productos no es la consulta en sí, sino que el ORDEN de los ids
 * que se bloquean sea el MISMO sin importar en qué orden llegaron las
 * líneas de cada venta — eso es exactamente lo que prueba este archivo,
 * sin necesitar una transacción real de Postgres.
 */

test("el orden de bloqueo es el mismo sin importar el orden de las líneas de la venta", () => {
  const ventaA = ["prod-clavo", "prod-martillo", "prod-tabla"];
  const ventaB = ["prod-tabla", "prod-clavo", "prod-martillo"]; // mismos productos, orden distinto

  const locksA = computeInventoryLockProductIds(ventaA);
  const locksB = computeInventoryLockProductIds(ventaB);

  assert.deepEqual(locksA, locksB, "dos ventas con los mismos productos deben pedir el lock en el mismo orden global");
});

test("dedup: dos líneas del mismo producto en una venta piden el lock una sola vez", () => {
  const locks = computeInventoryLockProductIds(["prod-clavo", "prod-martillo", "prod-clavo"]);
  assert.deepEqual(locks, ["prod-clavo", "prod-martillo"]);
});

test("orden alfabético estable independientemente del orden de entrada", () => {
  const locks1 = computeInventoryLockProductIds(["z", "a", "m"]);
  const locks2 = computeInventoryLockProductIds(["m", "z", "a"]);
  assert.deepEqual(locks1, ["a", "m", "z"]);
  assert.deepEqual(locks2, ["a", "m", "z"]);
});

test("venta vacía no pide bloqueos", () => {
  assert.deepEqual(computeInventoryLockProductIds([]), []);
});
