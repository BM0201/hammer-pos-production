/**
 * fusion-price-edit.test.mjs
 * ────────────────────────────────────────────────────────────────────────────
 * "El apartado de fusiones costo global tiene un problema, no trae el
 * precio de venta como deberia ser y no hace los ajustes que corresponde
 * ... el precio de venta se debe ajustar y poder editarse desde ahi" —
 * captura real: grupo ARENA, LATA con standardSalePrice=1.00 (un
 * placeholder), METRO GRANDE mostrando "Precio general: C$1.00" también
 * (su propio campo, que el motor de venta ni siquiera lee) con margen
 * -58081.8%. resolveEffectivePricing (effective-pricing.ts) NUNCA lee el
 * standardSalePrice propio de un derivado — su precio implícito es
 * SIEMPRE canonicalStandardSalePrice × factor, la MISMA regla que el
 * costo. FusionPricingPanel mostraba el campo propio (fantasma) y
 * encima no dejaba editarlo — ahora el precio general se calcula con la
 * misma resolución que el costo y se edita con el mismo mecanismo
 * (redirect al canónico), sin tocar branchPrice (que sigue siendo
 * individual por presentación).
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

function readApi(relFromRepoRoot) {
  const abs = resolve(__dirname, "..", "..", "..", relFromRepoRoot);
  assert.ok(existsSync(abs), `Archivo no existe: ${relFromRepoRoot}`);
  return readFileSync(abs, "utf8");
}

const PANEL = "components/catalog-inventory/fusion-pricing-panel.tsx";

test("frontend: el precio general tiene su propio input editable y botón de guardar, igual que el costo", () => {
  const c = read(PANEL);
  assert.ok(c.includes('saveField(member, "standardSalePrice", priceCell)'), "debe poder guardar el precio general desde su propia fila");
  assert.ok(c.includes('placeholder="Sin precio"'), "el input de precio debe existir, separado del de costo");
});

test("frontend: guardar precio manda standardSalePrice al mismo endpoint PATCH que ya usa el costo — no un endpoint nuevo", () => {
  const c = read(PANEL);
  assert.ok(c.includes("apiFetch(`/api/catalog/products/${member.productId}`"));
  assert.ok(c.includes("body: JSON.stringify({ [field]: numeric"), "un solo saveField(member, field, value) maneja costo y precio con el mismo PATCH, cambiando el nombre del campo");
});

test("frontend: la explicación deja claro que esto es el precio GENERAL, no branchPrice (que sigue siendo individual)", () => {
  const c = read(PANEL);
  assert.ok(/precio por\s*\n?\s*sucursal.*sigue siendo individual|precio por sucursal.*individual/s.test(c) || c.includes("sigue siendo individual y se edita en Precios y costos"));
});

test("backend: computeFusionMemberGlobalCost se reusa para el precio implícito (canonicalStandardSalePrice × factor), no un campo propio del derivado", () => {
  const service = readApi("hammer-api/src/modules/catalog/stock-group-crud.ts");
  assert.ok(service.includes("standardSalePriceByProductId"), "debe existir el mapa paralelo de precios, igual que el de costos");
  assert.match(service, /computeFusionMemberGlobalCost\(\{\s*isCanonical: m\.isCanonical,\s*ownGlobalCost: standardSalePriceByProductId/, "el precio de cada miembro debe pasar por la misma función pura que el costo");
});

test("backend: updateProduct redirige standardSalePrice al canónico cuando se edita un derivado — mismo resolveGlobalCostWriteTarget que el costo", () => {
  const service = readApi("hammer-api/src/modules/catalog/service.ts");
  assert.ok(/if \(input\.standardSalePrice !== undefined\) \{[\s\S]{0,400}resolveGlobalCostWriteTarget/.test(service), "debe resolver el redirect de precio con la misma función, no una reimplementación");
  assert.ok(service.includes("priceRedirect"), "debe existir la variable de redirect de precio, paralela a costRedirect");
});

test("backend: el redirect de precio NUNCA toca BranchProductSetting — solo Product.standardSalePrice", () => {
  const service = readApi("hammer-api/src/modules/catalog/service.ts");
  const priceRedirectBlock = service.slice(service.indexOf("let priceRedirect"), service.indexOf("let priceRedirect") + 1500);
  // "branchPrice" sí aparece en el comentario explicativo (aclara que NO
  // se toca) — lo que no debe aparecer es un acceso real a la tabla.
  assert.ok(!priceRedirectBlock.includes("tx.branchProductSetting"), "el redirect de standardSalePrice (precio general) es un concepto distinto de branchPrice (excepción por sucursal, otra tabla) — no deben mezclarse");
});
