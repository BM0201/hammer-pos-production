/**
 * fusion-tab-integration.test.mjs
 * ────────────────────────────────────────────────────────────────────────────
 * Historia de este archivo, por si alguien lo revisa después:
 *
 *  1. "creá un apartado dentro de Catálogo e Inventario donde estén las
 *     fusiones" → se agregó la pestaña "Fusiones" mostrando el editor
 *     COMPLETO (InventoryFusionManager: crear, editar presentaciones,
 *     desfusionar, reparar), y /app/master/inventory-fusion pasó a ser un
 *     redirect permanente.
 *  2. "Ese apartado de Fusiones, es para poner el precio, no es otra
 *     pestaña para crear — editá bien eso" → corrección: la pestaña debía
 *     ser SOLO para poner el costo global de cada presentación, no un
 *     duplicado del editor completo. Se revirtió el redirect (Fusión de
 *     Inventario vuelve a ser su propia pantalla, con su entrada en el
 *     menú) y la pestaña "Fusiones" pasó a mostrar FusionPricingPanel — un
 *     panel nuevo, enfocado únicamente en costo, que enlaza a Fusión de
 *     Inventario para quien necesite crear o editar estructura.
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

test("Catálogo e Inventario tiene la pestaña 'Fusiones', junto a 'Precios y costos'", () => {
  const c = read(ADMIN);
  assert.match(c, /"pricing" \| "fusion"/, "el tipo Tab debe declarar fusion inmediatamente después de pricing");
  assert.ok(/\{ id: "fusion", label: "Fusiones"/.test(c), "debe existir la entrada de la pestaña");
});

test("la pestaña Fusiones renderiza FusionPricingPanel (SOLO precio), no InventoryFusionManager (el editor completo)", () => {
  const c = read(ADMIN);
  assert.ok(c.includes('import { FusionPricingPanel } from "@/components/catalog-inventory/fusion-pricing-panel"'));
  assert.ok(c.includes('tab === "fusion" ? <FusionPricingPanel /> : null'));
  assert.ok(!c.includes("InventoryFusionManager"), "el editor completo (crear/editar estructura) NO debe estar en esta pestaña — es otra pantalla, a propósito");
});

test("FusionPricingPanel: el costo se calcula SOLO con globalCost del canónico × factor — nunca WAC, averageCost ni branchCost", () => {
  const c = read("components/catalog-inventory/fusion-pricing-panel.tsx");
  // Las tres palabras SÍ aparecen en el texto explicativo (le dicen al
  // usuario que no se usan) — lo que no debe aparecer es un ACCESO real al
  // campo (member.branchCost, .weightedAverageCost, etc.).
  assert.ok(!/\.weightedAverageCost\b/.test(c), "no debe leer el campo real de WAC — es exactamente lo que el pedido quería evitar");
  assert.ok(!/\.branchCost\b/.test(c), "tampoco branchCost — el costo acá es network-wide, no por sucursal");
  assert.ok(!/\.averageCost\b/.test(c), "tampoco averageCost");
  assert.ok(c.includes("globalCost"), "debe operar sobre globalCost");
});

test("FusionPricingPanel enlaza a Fusión de Inventario para crear/editar estructura — no la reimplementa", () => {
  const c = read("components/catalog-inventory/fusion-pricing-panel.tsx");
  assert.ok(c.includes('href="/app/master/inventory-fusion"'));
});

test("/app/master/inventory-fusion vuelve a ser la pantalla completa (NO un redirect) — crear fusiones sigue viviendo ahí", () => {
  const c = read("app/app/master/inventory-fusion/page.tsx");
  assert.ok(c.includes("InventoryFusionManager"), "debe montar el editor completo");
  assert.ok(!c.includes("redirect("), "ya no debe ser un redirect");
});

test("la barra lateral tiene de nuevo su entrada propia para Fusión de Inventario", () => {
  const c = read("components/navigation/app-sidebar.tsx");
  assert.ok(c.includes('href: "/app/master/inventory-fusion"'), "crear/editar estructura necesita quedar descubrible, no solo enlazada desde dentro de Precios");
});

test("backend: listStockGroups (usado por ambas pantallas) trae el costo global por presentación — computeFusionMemberGlobalCost, no reimplementado en el frontend", () => {
  const backend = resolve(__dirname, "..", "..", "..", "hammer-api/src/modules/catalog/stock-group-crud.ts");
  assert.ok(existsSync(backend));
  const c = readFileSync(backend, "utf8");
  assert.ok(c.includes("export function computeFusionMemberGlobalCost"));
  assert.ok(c.includes("globalCost: true, standardSalePrice: true"), "el select de Prisma debe traer los campos nuevos");
});
