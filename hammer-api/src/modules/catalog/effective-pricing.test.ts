import assert from "node:assert/strict";
import test from "node:test";
import { Prisma } from "@prisma/client";
import {
  resolveEffectivePricingFromParts,
  resolveCostChain,
  resolveFusionMemberCost,
  relativeDeviation,
  FUSION_PRICE_OVERRIDE_THRESHOLD,
  getEffectiveProductPricingBatch,
  type FusionMemberPricingBasis,
} from "@/modules/catalog/effective-pricing";
import { validateDiscountForRole } from "@/modules/sales/discount-policy";

// prompt-costos-precios-sucursal.md: "al terminar debe existir una sola
// resolución de costo y precio" — los tests llaman a las funciones REALES y
// exportadas (resolveEffectivePricingFromParts, resolveCostChain), nunca a
// una reimplementación de mano. Una copia hecha a mano acá mismo habría sido
// exactamente el tipo de quinta implementación divergente que este doc
// existe para eliminar (era, de hecho, el estado anterior de este archivo).

function d(v: number | null) {
  return v === null ? null : new Prisma.Decimal(v);
}

type PricingInput = {
  productId: string;
  standardSalePrice: Prisma.Decimal;
  branchPrice: Prisma.Decimal | null;
  branchCost: Prisma.Decimal | null;
  averageCost: Prisma.Decimal | null;
  globalCost: Prisma.Decimal | null;
  lastPurchaseCost: Prisma.Decimal | null;
  weightedAverageCost: Prisma.Decimal | null;
};

const BASE: PricingInput = {
  productId: "prod-1",
  standardSalePrice: d(100)!,
  branchPrice: null,
  branchCost: null,
  averageCost: null,
  globalCost: null,
  lastPurchaseCost: null,
  weightedAverageCost: null,
};

function resolve(input: PricingInput) {
  return resolveEffectivePricingFromParts({ ...input, fusion: null });
}

/* ── Prioridad de costo (B2): branchCost > WAC > averageCost > globalCost > lastPurchaseCost ── */

test("effectiveCost: branchCost tiene prioridad sobre todos los otros costos", () => {
  const result = resolve({ ...BASE, branchCost: d(10), averageCost: d(20), globalCost: d(30), lastPurchaseCost: d(40), weightedAverageCost: d(50) });
  assert.equal(result.effectiveCost?.toNumber(), 10);
  assert.equal(result.costSource, "BRANCH");
});

test("Sucursal (doc) Prueba 5: sucursal con WAC propio y averageCost global cargado → gana el WAC, no el global (B2)", () => {
  const result = resolve({ ...BASE, branchCost: null, averageCost: d(20), globalCost: d(30), lastPurchaseCost: d(40), weightedAverageCost: d(50) });
  assert.equal(result.effectiveCost?.toNumber(), 50);
  assert.equal(result.costSource, "WAC_ESTIMATE");
});

test("Sucursal (doc) Prueba 6: sucursal con branchCost cargado → gana ese, sin importar el WAC", () => {
  const result = resolve({ ...BASE, branchCost: d(15), weightedAverageCost: d(50) });
  assert.equal(result.effectiveCost?.toNumber(), 15);
  assert.equal(result.costSource, "BRANCH");
});

test("Sucursal (doc) Prueba 7: dos sucursales con WAC distinto para el mismo producto → costos efectivos distintos (la regresión que define el arreglo)", () => {
  const rivas = resolve({ ...BASE, weightedAverageCost: d(18.55) });
  const managua = resolve({ ...BASE, weightedAverageCost: d(22.10) });
  assert.notEqual(rivas.effectiveCost?.toNumber(), managua.effectiveCost?.toNumber());
  assert.equal(rivas.costSource, "WAC_ESTIMATE");
  assert.equal(managua.costSource, "WAC_ESTIMATE");
});

test("effectiveCost: usa averageCost cuando no hay branchCost ni WAC", () => {
  const result = resolve({ ...BASE, averageCost: d(20), globalCost: d(30) });
  assert.equal(result.effectiveCost?.toNumber(), 20);
  assert.equal(result.costSource, "GLOBAL_AVERAGE");
});

test("effectiveCost: usa globalCost cuando no hay branch, WAC ni average", () => {
  const result = resolve({ ...BASE, globalCost: d(30), lastPurchaseCost: d(40) });
  assert.equal(result.effectiveCost?.toNumber(), 30);
  assert.equal(result.costSource, "GLOBAL");
});

test("effectiveCost: usa lastPurchaseCost cuando no hay ningún otro", () => {
  const result = resolve({ ...BASE, lastPurchaseCost: d(40) });
  assert.equal(result.effectiveCost?.toNumber(), 40);
  assert.equal(result.costSource, "LAST_PURCHASE");
});

test("Sucursal (doc) Prueba 9: sin ninguna fuente → effectiveCost null, costSource NONE", () => {
  const result = resolve(BASE);
  assert.equal(result.effectiveCost, null);
  assert.equal(result.costSource, "NONE");
});

/* ── WAC de cero (B4): no es un costo, es "no sé" ── */

test("Sucursal (doc) Prueba 8: WAC en cero se ignora y cae al siguiente respaldo — nunca produce costo efectivo cero", () => {
  const result = resolve({ ...BASE, weightedAverageCost: d(0), averageCost: d(25) });
  assert.equal(result.effectiveCost?.toNumber(), 25);
  assert.equal(result.costSource, "GLOBAL_AVERAGE");
  assert.notEqual(result.effectiveCost?.toNumber(), 0);
});

test("WAC en cero sin ningún otro respaldo → effectiveCost null (NONE), no cero", () => {
  const result = resolve({ ...BASE, weightedAverageCost: d(0) });
  assert.equal(result.effectiveCost, null);
  assert.equal(result.costSource, "NONE");
});

test("resolveCostChain: WAC en cero se trata igual que ausente, directamente en la función exportada", () => {
  const withZero = resolveCostChain({ branchCost: null, averageCost: null, globalCost: null, lastPurchaseCost: d(40), weightedAverageCost: d(0) });
  const withoutWac = resolveCostChain({ branchCost: null, averageCost: null, globalCost: null, lastPurchaseCost: d(40), weightedAverageCost: null });
  assert.equal(withZero.cost?.toNumber(), withoutWac.cost?.toNumber());
  assert.equal(withZero.source, withoutWac.source);
});

test("effectiveCost: branchCost=0 SÍ se respeta (0 es una declaración explícita, no 'no sé') — no cae al siguiente nivel", () => {
  const result = resolve({ ...BASE, branchCost: d(0), averageCost: d(20) });
  // null-coalescing solo salta null/undefined, no 0 — a diferencia del WAC, branchCost=0 es una decisión del usuario
  assert.equal(result.effectiveCost?.toNumber(), 0);
  assert.equal(result.costSource, "BRANCH");
});

/* ── Respaldo de precio (B1) ── */

test("Sucursal (doc) Prueba 1: producto con branchPrice → effectivePrice es ese, priceSource BRANCH", () => {
  const result = resolve({ ...BASE, branchPrice: d(90) });
  assert.equal(result.effectivePrice?.toNumber(), 90);
  assert.equal(result.priceSource, "BRANCH");
});

test("Sucursal (doc) Prueba 2: producto SIN branchPrice y con standardSalePrice → effectivePrice es el estándar, priceSource STANDARD", () => {
  const result = resolve({ ...BASE, standardSalePrice: d(650)!, branchPrice: null });
  assert.equal(result.effectivePrice?.toNumber(), 650);
  assert.equal(result.priceSource, "STANDARD");
  assert.notEqual(result.effectivePrice, null); // antes de B1 esto era null
});

// Prueba 3 del doc ("producto sin ninguno → MISSING") no es representable
// acá: standardSalePrice es NOT NULL en el schema de Product (siempre required
// al crear), así que con el fix de B1 ya no existe un producto real sin
// ningún precio — MISSING queda en el tipo por compatibilidad, no se prueba
// como alcanzable porque no lo es.

test("Sucursal (doc) Prueba 4: sucursal nueva sin fila BranchProductSetting → el producto con precio estándar SÍ tiene precio ahí", () => {
  // Simula el escenario exacto: branchPrice null porque nunca se creó la fila.
  const result = resolve({ ...BASE, standardSalePrice: d(199.99)!, branchPrice: null, branchCost: null });
  assert.equal(result.effectivePrice?.toNumber(), 199.99);
  assert.equal(result.priceSource, "STANDARD");
});

/* ── prompt-costos-precios-fusion.md §5 — pruebas 1, 2, 3, 5, 6, sobre las
 * funciones REALES de effective-pricing.ts (ya son puras, sin DB — se
 * importan directo, sin reimplementar la lógica a mano). ── */

const FUSION_BASE: FusionMemberPricingBasis = {
  conversionFactor: d(25)!,
  canonicalBranchCost: null,
  canonicalAverageCost: null,
  canonicalGlobalCost: null,
  canonicalLastPurchaseCost: null,
  canonicalBaseWeightedAverageCost: d(18.55)!, // costo real del canónico, por LATA
  canonicalBranchPrice: null,
  canonicalStandardSalePrice: d(30)!,
};

test("Prueba 1 (doc): miembro derivado con globalCost cargado a mano → el costo efectivo IGNORA ese valor y deriva del canónico × factor", () => {
  const result = resolveEffectivePricingFromParts({
    productId: "prod-metro-arena",
    standardSalePrice: d(650)!,
    globalCost: d(1)!, // el relleno tecleado a mano — el bug real de arena (C$1.00)
    averageCost: null,
    lastPurchaseCost: null,
    branchPrice: null,
    branchCost: null,
    weightedAverageCost: null,
    fusion: FUSION_BASE,
  });
  assert.equal(result.isFusionMember, true);
  // 18.55 (WAC del canónico, por lata) × 25 (factor) = 463.75 — NO 1.00.
  assert.equal(result.effectiveCost?.toNumber(), 463.75);
  assert.notEqual(result.effectiveCost?.toNumber(), 1);
  assert.equal(result.costSource, "WAC_ESTIMATE"); // la fuente es la del CANÓNICO, no la del miembro
});

test("Prueba 2 (doc): canónico con branchCost cargado → SÍ se respeta, es la base legítima de la fusión", () => {
  const result = resolveEffectivePricingFromParts({
    productId: "prod-lata-arena",
    standardSalePrice: d(30)!,
    globalCost: null,
    averageCost: null,
    lastPurchaseCost: null,
    branchPrice: null,
    branchCost: d(20)!, // costo de adquisición propio de esta sucursal
    weightedAverageCost: d(18.55)!,
    fusion: null, // el canónico mismo nunca pasa `fusion` — usa su propia cadena
  });
  assert.equal(result.isFusionMember, false);
  assert.equal(result.effectiveCost?.toNumber(), 20); // branchCost gana, como siempre en la cadena normal
  assert.equal(result.costSource, "BRANCH");
});

test("Prueba 3 (doc): fusión de arena corregida — dos presentaciones derivadas distintas implican el MISMO costo base por lata", () => {
  // METRO_A (factor 25) con un globalCost de relleno propio, y METRO_B
  // (factor 55) con un branchCost de relleno DISTINTO — ambos deben ignorar
  // sus propios campos y derivar del MISMO canónico.
  const metroA = resolveEffectivePricingFromParts({
    productId: "prod-metro-a",
    standardSalePrice: d(650)!,
    globalCost: d(1)!,
    averageCost: null,
    lastPurchaseCost: null,
    branchPrice: null,
    branchCost: null,
    weightedAverageCost: null,
    fusion: { ...FUSION_BASE, conversionFactor: d(25)! },
  });
  const metroB = resolveEffectivePricingFromParts({
    productId: "prod-metro-b",
    standardSalePrice: d(1200)!,
    globalCost: null,
    averageCost: null,
    lastPurchaseCost: null,
    branchPrice: null,
    branchCost: d(999)!, // otro relleno, distinto del de METRO_A
    weightedAverageCost: null,
    fusion: { ...FUSION_BASE, conversionFactor: d(55)! },
  });

  const impliedBaseCostA = metroA.effectiveCost!.div(25);
  const impliedBaseCostB = metroB.effectiveCost!.div(55);
  assert.equal(impliedBaseCostA.toNumber(), 18.55);
  assert.equal(impliedBaseCostB.toNumber(), 18.55);
  assert.equal(impliedBaseCostA.toNumber(), impliedBaseCostB.toNumber());
});

test("resolveFusionMemberCost: null cuando el canónico no tiene costo resuelto", () => {
  assert.equal(resolveFusionMemberCost(null, d(25)!), null);
});

/**
 * "el precio de venta no se mueva solo... el PRECIO es una decisión
 * comercial POR PRESENTACIÓN" (catalog/service.ts, Parte A/C) — ANTES,
 * sin branchPrice, esto caía SIEMPRE a impliedFusionPrice (precioBase del
 * canónico × factor): el standardSalePrice propio del derivado era un
 * campo fantasma, exactamente el bug del otro lado que 03b87aa cerró para
 * el margen de Fusiones. Ahora que updateProduct escribe ese campo de
 * verdad (ya no lo redirige al canónico), la lectura tiene que coincidir:
 * el precio PROPIO gana — 650, no el implícito (750 = 30 × 25).
 * impliedFusionPrice se sigue calculando y exponiendo (lo usa el aviso de
 * desvío de Parte A.2), solo deja de ser el valor efectivo por defecto.
 */
test("Prueba 5 (reescrita, Parte C): precio propio de una presentación (sin branchPrice) → sale de SU standardSalePrice, no del implícito", () => {
  const result = resolveEffectivePricingFromParts({
    productId: "prod-metro-arena",
    standardSalePrice: d(650)!, // el precio propio de este METRO, ya escribible directo (Parte A)
    globalCost: null,
    averageCost: null,
    lastPurchaseCost: null,
    branchPrice: null, // sin override de sucursal
    branchCost: null,
    weightedAverageCost: null,
    fusion: { ...FUSION_BASE, canonicalBranchPrice: null, canonicalStandardSalePrice: d(30)! },
  });
  assert.equal(result.isFusionPriceOverride, false);
  assert.equal(result.impliedFusionPrice?.toNumber(), 750, "el implícito (30 × 25) se sigue calculando — lo usa el aviso de desvío");
  assert.equal(result.effectivePrice?.toNumber(), 650, "pero el efectivo es el precio PROPIO de la presentación, no el implícito");
  assert.equal(result.priceSource, "FUSION_DERIVED");
});

test("precio propio IGUAL al implícito (caso típico: nunca se repreció desde que se creó) → sigue siendo 650=650, ningún cambio visible", () => {
  const result = resolveEffectivePricingFromParts({
    productId: "prod-metro-arena",
    standardSalePrice: d(750)!,
    globalCost: null,
    averageCost: null,
    lastPurchaseCost: null,
    branchPrice: null,
    branchCost: null,
    weightedAverageCost: null,
    fusion: { ...FUSION_BASE, canonicalBranchPrice: null, canonicalStandardSalePrice: d(30)! },
  });
  assert.equal(result.impliedFusionPrice?.toNumber(), 750);
  assert.equal(result.effectivePrice?.toNumber(), 750);
});

test("precio de una presentación CON override → effectivePrice es el override, impliedFusionPrice queda disponible para comparar", () => {
  const result = resolveEffectivePricingFromParts({
    productId: "prod-metro-arena",
    standardSalePrice: d(650)!,
    globalCost: null,
    averageCost: null,
    lastPurchaseCost: null,
    branchPrice: d(650)!, // override deliberado — vender el metro más barato que 25 latas sueltas
    branchCost: null,
    weightedAverageCost: null,
    fusion: { ...FUSION_BASE, canonicalBranchPrice: null, canonicalStandardSalePrice: d(30)! },
  });
  assert.equal(result.isFusionPriceOverride, true);
  assert.equal(result.impliedFusionPrice?.toNumber(), 750);
  assert.equal(result.effectivePrice?.toNumber(), 650); // el override, no el implícito
  assert.equal(result.priceSource, "BRANCH");
});

/**
 * Prueba 6 (doc): "Override que se desvía más del umbral → exige
 * confirmación explícita". La verificación completa (guard de escritura)
 * vive en catalog-inventory/service.ts::upsertBranchProductSetting, que
 * toca DB real y no se puede probar sin ella (igual que el resto de este
 * módulo) — acá se prueba el cálculo de desvío que ese guard usa.
 */
test("Prueba 6 (doc): un desvío mayor al umbral (caso piedrín: C$1 vs C$1200 implícito) se detecta como tal", () => {
  const implied = d(1200)!;
  const overridden = d(1)!;
  const deviation = relativeDeviation(overridden, implied);
  assert.ok(deviation !== null && deviation > FUSION_PRICE_OVERRIDE_THRESHOLD);
});

test("Prueba 6b: un desvío razonable (descuento por volumen legítimo) NO exige confirmación", () => {
  const implied = d(100)!;
  const overridden = d(90)!; // 10% de descuento por volumen
  const deviation = relativeDeviation(overridden, implied);
  assert.ok(deviation !== null && deviation < FUSION_PRICE_OVERRIDE_THRESHOLD);
});

test("relativeDeviation: referencia <= 0 no tiene desvío calculable (null, no división por cero)", () => {
  assert.equal(relativeDeviation(d(10)!, d(0)!), null);
});

/* ── prompt-fusionado-invendible-409.md §P-2 — sellability no puede divergir
 * del guard real (validateDiscountForRole, discount-policy.ts): mismo par
 * (costo, precio) → misma conclusión, sin descuento de por medio (caso base
 * de la tarjeta del catálogo, antes de cualquier clic). ── */

function guardWouldBlockBelowCost(effectiveCost: Prisma.Decimal | null, effectivePrice: Prisma.Decimal | null): boolean {
  const policy = validateDiscountForRole({
    role: "CAJA", // sin autoridad de override — el caso que importa: ¿el guard bloquearía a alguien?
    discountPercent: new Prisma.Decimal(0),
    effectiveCost,
    netUnitPriceAfterDiscount: effectivePrice ?? new Prisma.Decimal(0),
  });
  return !policy.allowed && policy.code === "BELOW_COST_NOT_ALLOWED";
}

const SELLABILITY_CASES: Array<{ label: string; cost: number | null; price: number | null }> = [
  { label: "precio por debajo del costo", cost: 100, price: 90 },
  { label: "precio igual al costo (no es 'por debajo')", cost: 100, price: 100 },
  { label: "precio por encima del costo", cost: 100, price: 110 },
  { label: "sin costo conocido", cost: null, price: 100 },
  { label: "costo cero (tratado como 'no sé', igual que el guard)", cost: 0, price: 100 },
  { label: "miembro de fusión con costo inflado por encima del precio", cost: 14400, price: 2055 },
];

for (const c of SELLABILITY_CASES) {
  test(`sellability vs guard: ${c.label}`, () => {
    const result = resolve({ ...BASE, branchCost: d(c.cost), branchPrice: d(c.price) });
    const blocked = guardWouldBlockBelowCost(d(c.cost), d(c.price));
    assert.equal(result.sellability === "BELOW_COST", blocked, `sellability=${result.sellability} pero el guard ${blocked ? "SÍ" : "NO"} bloquearía`);
  });
}

test("sellability: NO_COST cuando no hay costo efectivo, incluso con precio alto", () => {
  const result = resolve({ ...BASE, branchCost: null, averageCost: null, globalCost: null, lastPurchaseCost: null, weightedAverageCost: null, branchPrice: d(500) });
  assert.equal(result.sellability, "NO_COST");
});

test("sellability: miembro de fusión con costo inflado (el síntoma de Fase 2) da BELOW_COST", () => {
  const result = resolveEffectivePricingFromParts({
    productId: "prod-hierro-3-8-8mm",
    standardSalePrice: d(1)!,
    globalCost: null,
    averageCost: null,
    lastPurchaseCost: null,
    branchPrice: d(1750)!,
    branchCost: null,
    weightedAverageCost: null,
    fusion: { ...FUSION_BASE, conversionFactor: d(14)!, canonicalBaseWeightedAverageCost: d(185.89)! }, // WAC contaminado real
  });
  assert.equal(result.effectiveCost?.toNumber(), 185.89 * 14);
  assert.equal(result.sellability, "BELOW_COST");
});

/* ── P-2 — consulta constante: getEffectiveProductPricingBatch resuelve N
 * pares (sucursal, producto) con un número FIJO de round trips, no O(N). ── */

function createCountingFakeDb(fixtures: {
  members?: unknown[];
  products?: Array<{ id: string; standardSalePrice: Prisma.Decimal; globalCost: Prisma.Decimal | null; averageCost: Prisma.Decimal | null; lastPurchaseCost: Prisma.Decimal | null }>;
  settings?: Array<{ branchId: string; productId: string; branchPrice: Prisma.Decimal | null; branchCost: Prisma.Decimal | null }>;
  balances?: Array<{ branchId: string; productId: string; weightedAverageCost: Prisma.Decimal | null }>;
}) {
  const calls = { productStockGroupMember: 0, product: 0, branchProductSetting: 0, inventoryBalance: 0 };
  const db = {
    productStockGroupMember: { findMany: async () => { calls.productStockGroupMember += 1; return fixtures.members ?? []; } },
    product: { findMany: async () => { calls.product += 1; return fixtures.products ?? []; } },
    branchProductSetting: { findMany: async () => { calls.branchProductSetting += 1; return fixtures.settings ?? []; } },
    inventoryBalance: { findMany: async () => { calls.inventoryBalance += 1; return fixtures.balances ?? []; } },
  };
  return { db: db as unknown as Prisma.TransactionClient, calls };
}

test("getEffectiveProductPricingBatch: mismo número de consultas para 1 producto que para 20 (independiente de N)", async () => {
  const branchId = "branch-1";
  const makeItems = (n: number) => Array.from({ length: n }, (_, i) => ({ branchId, productId: `prod-${i}` }));
  const makeProducts = (n: number) => Array.from({ length: n }, (_, i) => ({
    id: `prod-${i}`, standardSalePrice: d(100)!, globalCost: null, averageCost: null, lastPurchaseCost: null,
  }));

  const { db: db1, calls: calls1 } = createCountingFakeDb({ products: makeProducts(1) });
  await getEffectiveProductPricingBatch(db1, makeItems(1));

  const { db: db20, calls: calls20 } = createCountingFakeDb({ products: makeProducts(20) });
  await getEffectiveProductPricingBatch(db20, makeItems(20));

  assert.deepEqual(calls1, calls20, "el número de round trips no debe crecer con N");
  assert.equal(calls20.productStockGroupMember, 1);
  assert.equal(calls20.product, 1);
  assert.equal(calls20.branchProductSetting, 1);
  assert.equal(calls20.inventoryBalance, 1);
});
