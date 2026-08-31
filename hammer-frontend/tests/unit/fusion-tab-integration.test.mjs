/**
 * fusion-tab-integration.test.mjs
 * ────────────────────────────────────────────────────────────────────────────
 * "Quiero que ajustes ese cambio desde el catalogo Catálogo e inventario...
 * en precios y costos y rediseñes el Frontend, para eso, creando un
 * apartado dentro de ese mismo lado donde esten las fusiones" — Fusión de
 * Inventario vivía en /app/master/inventory-fusion, una pantalla aparte sin
 * relación visible con Precios y costos, aunque el costo de un miembro
 * derivado DEPENDE de cómo está armada su fusión (factor, unidad) — el
 * cambio anterior (derived-cost-edit) ya dejaba editar ese costo desde
 * Precios y costos, pero corregir el factor en sí seguía exigiendo saltar
 * a otra pantalla. Ahora las dos viven en el mismo módulo: Catálogo e
 * Inventario gana una pestaña "Fusiones" junto a "Precios y costos", y la
 * ruta vieja queda como redirect permanente (mismo criterio que
 * expenses→finance).
 *
 * Tests estructurales (leen el código fuente), sin backend ni render —
 * misma convención que global-cost-package-guard.test.mjs.
 *
 * Ejecutar: npm run test:unit
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve, join } from "node:path";

const __dirname = dirname(fileURLToPath(import.meta.url));
const SRC = resolve(__dirname, "..", "..", "src");

function read(rel) {
  const abs = join(SRC, rel);
  assert.ok(existsSync(abs), `Archivo no existe: ${rel}`);
  return readFileSync(abs, "utf8");
}

const ADMIN = "components/catalog-inventory/catalog-inventory-admin.tsx";

test("Catálogo e Inventario gana la pestaña 'Fusiones', junto a 'Precios y costos'", () => {
  const c = read(ADMIN);
  assert.match(c, /"pricing" \| "fusion"/, "el tipo Tab debe declarar fusion inmediatamente después de pricing");
  assert.ok(/\{ id: "fusion", label: "Fusiones"/.test(c), "debe existir la entrada de la pestaña");
});

test("la pestaña Fusiones renderiza InventoryFusionManager (reusado, no reimplementado)", () => {
  const c = read(ADMIN);
  assert.ok(c.includes('import { InventoryFusionManager } from "@/components/inventory/inventory-fusion-manager"'));
  assert.ok(c.includes('tab === "fusion" ? <InventoryFusionManager /> : null'));
});

test("/app/master/inventory-fusion queda como redirect permanente a la nueva pestaña", () => {
  const c = read("app/app/master/inventory-fusion/page.tsx");
  assert.match(c, /redirect\(\s*["'`]\/app\/master\/catalog-inventory\?tab=fusion["'`]\s*\)/, "debe redirigir con el query param que activa la pestaña Fusiones");
});

test("la barra lateral ya no tiene una entrada propia para Fusión de Inventario — vive dentro de Catálogo e Inventario", () => {
  const c = read("components/navigation/app-sidebar.tsx");
  assert.ok(!c.includes('href: "/app/master/inventory-fusion"'), "no debe quedar un enlace directo — la ruta vieja sigue existiendo solo como redirect");
});
