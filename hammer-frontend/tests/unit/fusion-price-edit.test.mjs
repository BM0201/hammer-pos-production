/**
 * fusion-price-edit.test.mjs
 * ────────────────────────────────────────────────────────────────────────────
 * Reescrito — "el precio de venta no se mueva solo. Ninguna escritura de
 * precio puede propagarse a otros productos sin que alguien lo confirme"
 * (catalog/service.ts, Parte A). El diseño anterior (b297aee) redirigía
 * standardSalePrice de un derivado al canónico, la MISMA regla que el
 * costo — pero el costo es un hecho físico compartido (un solo material,
 * un solo costo) y el precio es una decisión comercial POR PRESENTACIÓN
 * (vender el metro más barato por lata que la lata suelta es descuento
 * por volumen normal). Redirigirlo cambiaba el precio de TODAS las
 * presentaciones de la fusión al editar UNA — exactamente lo que esta
 * vuelta revierte: standardSalePrice se escribe SIEMPRE en el producto
 * solicitado, nunca en el canónico. El costo SIGUE redirigiéndose (sin
 * tocar esa parte).
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
  assert.ok(c.includes("[field]: numeric,"), "un solo saveField(member, field, value) maneja costo y precio con el mismo PATCH, cambiando el nombre del campo");
});

test("backend: standardSalePrice ya NO redirige al canónico — se escribe siempre en el producto solicitado (Parte A.1)", () => {
  const service = readApi("hammer-api/src/modules/catalog/service.ts");
  assert.ok(!service.includes("priceRedirect"), "el mecanismo de redirect de precio (b297aee) fue eliminado por completo");
  assert.match(
    service,
    /const standardSalePriceForRequested = input\.standardSalePrice === undefined\s*\n\s*\? undefined\s*\n\s*: new Prisma\.Decimal\(input\.standardSalePrice\);/,
    "standardSalePrice se resuelve solo con lo que se tecleó, sin condicionar a ningún redirect",
  );
});

test("backend: el costo SIGUE redirigiéndose al canónico — es un hecho físico compartido, esa parte no se tocó", () => {
  const service = readApi("hammer-api/src/modules/catalog/service.ts");
  assert.ok(service.includes("resolveGlobalCostWriteTarget"), "el redirect de costo debe seguir existiendo");
  assert.match(service, /if \(input\.globalCost !== undefined && input\.globalCost !== null\) \{\s*\n\s*const resolved = resolveGlobalCostWriteTarget/);
});

test("backend: el precio tecleado con >15% de desvío del implícito de fusión exige confirmación explícita (Parte A.2) — un aviso, no un bloqueo silencioso", () => {
  const service = readApi("hammer-api/src/modules/catalog/service.ts");
  assert.ok(service.includes("PRICE_DEVIATES_FROM_FUSION"), "debe existir el aviso de desvío de precio");
  assert.ok(service.includes("overridePriceConfirmed"), "debe existir el flag de confirmación explícita, mismo patrón que branchPrice");
});

test("backend: listStockGroups (panel de Fusiones) lee el standardSalePrice PROPIO de cada miembro — ya no lo deriva del canónico × factor", () => {
  const service = readApi("hammer-api/src/modules/catalog/stock-group-crud.ts");
  assert.match(
    service,
    /const standardSalePrice = standardSalePriceByProductId\.get\(m\.productId\) \?\? null;/,
    "el precio de cada miembro debe leerse directo — computeFusionMemberGlobalCost quedó solo para lo que SÍ se deriva (el costo)",
  );
});

test("backend: resolveEffectivePricing (el motor real de venta) prioriza el standardSalePrice propio de un derivado sobre el implícito (Parte C)", () => {
  const service = readApi("hammer-api/src/modules/catalog/effective-pricing.ts");
  assert.match(
    service,
    /const effectivePrice = isFusionPriceOverride \? input\.branchPrice : input\.standardSalePrice;/,
    "sin branchPrice, el efectivo debe ser el standardSalePrice propio de la presentación, no impliedFusionPrice",
  );
});
