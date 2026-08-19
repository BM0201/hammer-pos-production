/**
 * prompt-costos-precios-fusion.md §3 — auditoría de coherencia de costos y
 * precios en fusiones. Solo lee, no escribe nada.
 *
 * Por cada (producto, sucursal): precio efectivo, costo efectivo, fuente del
 * costo, margen, y — si el producto es un miembro DERIVADO de una fusión —
 * el precio implícito de fusión (precioBase(canónico) × factor) y el
 * desvío si hay un override propio.
 *
 * Usa getEffectiveProductPricingBatch/resolveEffectivePricingFromParts, el
 * MISMO motor que usa el POS hoy — así el reporte refleja exactamente lo que
 * pasaría al vender, no una reimplementación aparte que podría divergir.
 *
 * Clasifica en 3 grupos (se arreglan distinto — ver doc §3):
 *   1. INVENDIBLES        (precio < costo)      — el guard 409 ya los bloquea
 *   2. MAL PRECIFICADOS    (override desviado)    — LOS PELIGROSOS: se venden hoy sin error visible
 *   3. COSTO DE RELLENO    (canónico en 0/1.00)   — corrompe valuación y margen
 *
 * El grupo 2 se ordena por EXPOSICIÓN (plata en riesgo), no alfabéticamente:
 *   exposición = stock base del canónico × |precio implícito de esta
 *   presentación − precio implícito de referencia (canónico)| / factor
 *
 * Uso: npx tsx scripts/audit-pricing-coherence.ts
 */
import { prisma } from "@/lib/prisma";
import { getEffectiveProductPricingBatch, FUSION_PRICE_OVERRIDE_THRESHOLD } from "@/modules/catalog/effective-pricing";

const PLACEHOLDER_EPSILON = 0.01;
const PLACEHOLDER_VALUES = [0, 1];

function fmt(v: number | null) {
  return v === null ? "—" : `C$${v.toFixed(2)}`;
}

async function main() {
  const branches = await prisma.branch.findMany({ where: { isActive: true }, select: { id: true, code: true } });
  const groups = await prisma.productStockGroup.findMany({
    where: { isActive: true },
    include: { products: { where: { isActive: true }, select: { productId: true, isCanonical: true, conversionFactor: true } } },
  });

  const canonicalIdByMemberId = new Map<string, string>();
  const factorByMemberId = new Map<string, number>();
  const groupByMemberId = new Map<string, { code: string; canonicalId: string }>();
  for (const group of groups) {
    const canonical = group.products.find((m) => m.isCanonical);
    if (!canonical) continue;
    for (const member of group.products) {
      canonicalIdByMemberId.set(member.productId, canonical.productId);
      factorByMemberId.set(member.productId, Number(member.conversionFactor));
      groupByMemberId.set(member.productId, { code: group.code, canonicalId: canonical.productId });
    }
  }
  const fusionProductIds = new Set(canonicalIdByMemberId.keys());

  // Universo: todo producto con AL MENOS una presencia real en alguna
  // sucursal (balance o ajuste de precio/costo propio) — evita generar
  // filas irrelevantes para productos que nunca se tocaron en esa sucursal.
  const [balances, settings, allProducts] = await Promise.all([
    prisma.inventoryBalance.findMany({ select: { branchId: true, productId: true, quantityOnHand: true } }),
    prisma.branchProductSetting.findMany({ select: { branchId: true, productId: true } }),
    prisma.product.findMany({ where: { isActive: true }, select: { id: true, sku: true, name: true } }),
  ]);
  const productById = new Map(allProducts.map((p) => [p.id, p]));
  const canonicalBaseStock = new Map<string, number>(); // `${branchId}:${canonicalId}` -> quantityOnHand
  for (const b of balances) canonicalBaseStock.set(`${b.branchId}:${b.productId}`, Number(b.quantityOnHand));

  const presenceKeys = new Set<string>();
  for (const b of balances) if (productById.has(b.productId)) presenceKeys.add(`${b.branchId}:${b.productId}`);
  for (const s of settings) if (productById.has(s.productId)) presenceKeys.add(`${s.branchId}:${s.productId}`);

  const items = [...presenceKeys].map((key) => {
    const [branchId, productId] = key.split(":");
    return { branchId, productId };
  });

  console.log(`Auditando ${items.length} pares (sucursal, producto) en ${branches.length} sucursal(es)...\n`);

  const pricingByKey = await getEffectiveProductPricingBatch(prisma, items);

  type Row = {
    branchId: string; productId: string; sku: string; name: string;
    price: number | null; cost: number | null; costSource: string; margin: number | null;
    isFusionMember: boolean; groupCode: string | null; factor: number | null;
    impliedPrice: number | null; isOverride: boolean; exposure: number;
  };
  const rows: Row[] = [];

  for (const { branchId, productId } of items) {
    const pricing = pricingByKey.get(`${branchId}:${productId}`);
    const product = productById.get(productId);
    if (!pricing || !product) continue;

    const price = pricing.effectivePrice === null ? null : Number(pricing.effectivePrice);
    const cost = pricing.effectiveCost === null ? null : Number(pricing.effectiveCost);
    const margin = price !== null && cost !== null && price > 0 ? ((price - cost) / price) * 100 : null;
    const groupInfo = groupByMemberId.get(productId) ?? null;
    const factor = factorByMemberId.get(productId) ?? null;

    let exposure = 0;
    if (pricing.isFusionMember && pricing.isFusionPriceOverride && pricing.impliedFusionPrice !== null && factor && groupInfo) {
      const canonicalStock = canonicalBaseStock.get(`${branchId}:${groupInfo.canonicalId}`) ?? 0;
      const ownImpliedBase = price !== null ? price / factor : null;
      const referenceBase = Number(pricing.impliedFusionPrice) / factor;
      if (ownImpliedBase !== null) exposure = canonicalStock * Math.abs(ownImpliedBase - referenceBase);
    }

    rows.push({
      branchId, productId, sku: product.sku, name: product.name,
      price, cost, costSource: pricing.costSource, margin,
      isFusionMember: pricing.isFusionMember, groupCode: groupInfo?.code ?? null, factor,
      impliedPrice: pricing.impliedFusionPrice === null ? null : Number(pricing.impliedFusionPrice),
      isOverride: pricing.isFusionPriceOverride, exposure,
    });
  }

  const branchCode = (id: string) => branches.find((b) => b.id === id)?.code ?? id;

  // ── Grupo 1: INVENDIBLES ──
  const unsellable = rows.filter((r) => r.price !== null && r.cost !== null && r.price < r.cost);
  console.log("─".repeat(88));
  console.log(`GRUPO 1 · INVENDIBLES (precio < costo — el 409 ya bloquea la venta) — ${unsellable.length}`);
  console.log("─".repeat(88));
  for (const r of unsellable.sort((a, b) => (b.cost! - b.price!) - (a.cost! - a.price!))) {
    console.log(`  ${r.sku} · ${r.name} · ${branchCode(r.branchId)} · precio=${fmt(r.price)} costo=${fmt(r.cost)} fuente=${r.costSource}`);
  }

  // ── Grupo 2: VENDIBLES Y MAL PRECIFICADOS (los peligrosos) ──
  const mispriced = rows
    .filter((r) => r.isFusionMember && r.isOverride && r.exposure > 0.01 && !(r.price !== null && r.cost !== null && r.price < r.cost))
    .sort((a, b) => b.exposure - a.exposure);
  console.log("");
  console.log("─".repeat(88));
  console.log(`GRUPO 2 · VENDIBLES Y MAL PRECIFICADOS (override desviado de fusión) — ${mispriced.length} — ordenado por exposición`);
  console.log("─".repeat(88));
  for (const r of mispriced) {
    const deviationPct = r.impliedPrice ? Math.round((Math.abs(r.price! - r.impliedPrice) / r.impliedPrice) * 1000) / 10 : null;
    const flag = deviationPct !== null && deviationPct / 100 > FUSION_PRICE_OVERRIDE_THRESHOLD ? " ⚠" : "";
    console.log(
      `  ${r.sku} · ${r.name} · ${branchCode(r.branchId)} · fusión=${r.groupCode} factor=${r.factor} · precio=${fmt(r.price)} implícito=${fmt(r.impliedPrice)} (desvío ${deviationPct}%)${flag} · exposición=${fmt(r.exposure)}`,
    );
  }

  // ── Grupo 3: COSTO DE RELLENO ──
  const placeholder = rows.filter((r) => {
    if (r.cost === null) return false;
    const isPlaceholderValue = PLACEHOLDER_VALUES.some((v) => Math.abs(r.cost! - v) <= PLACEHOLDER_EPSILON);
    if (!isPlaceholderValue) return false;
    const stock = canonicalBaseStock.get(`${r.branchId}:${canonicalIdByMemberId.get(r.productId) ?? r.productId}`) ?? 0;
    return stock > 0;
  });
  console.log("");
  console.log("─".repeat(88));
  console.log(`GRUPO 3 · COSTO DE RELLENO (0 o 1.00 con stock — corrompe valuación y margen) — ${placeholder.length}`);
  console.log("─".repeat(88));
  for (const r of placeholder.sort((a, b) => (b.margin ?? 0) - (a.margin ?? 0))) {
    console.log(`  ${r.sku} · ${r.name} · ${branchCode(r.branchId)} · costo=${fmt(r.cost)} margen=${r.margin === null ? "—" : `${r.margin.toFixed(2)}%`}`);
  }

  console.log("");
  console.log("=".repeat(88));
  console.log(`RESUMEN: ${unsellable.length} invendibles · ${mispriced.length} mal precificados (peligrosos, nadie los ve) · ${placeholder.length} con costo de relleno.`);
  console.log(`Total exposición estimada en grupo 2: ${fmt(mispriced.reduce((s, r) => s + r.exposure, 0))}`);
  console.log("Grupo 2 es el que justifica corregir ahora — se vende sin ningún error visible.");
}

main()
  .catch((e) => {
    console.error(e);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
