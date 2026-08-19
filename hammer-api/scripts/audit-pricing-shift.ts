/**
 * prompt-costos-precios-sucursal.md §3 — mide el impacto de B1 (respaldo al
 * precio estándar) y B2/B4 (prioridad de costo reordenada, WAC de 0 ya no
 * cuenta como costo real) ANTES de que esos cambios muevan números en
 * producción. Solo lee, no escribe nada.
 *
 * Compara, por cada (sucursal, producto):
 *   - la resolución VIEJA (congelada acá mismo, tal como estaba el código
 *     antes de este doc — branchPrice sin respaldo, WAC último en la cadena
 *     de costo, sin guarda de cero)
 *   - contra la NUEVA, vía getEffectiveProductPricingBatch — el MISMO motor
 *     que usa el POS hoy, para que el reporte refleje exactamente lo que
 *     pasaría al vender, no una reimplementación aparte que podría divergir.
 *
 * Para miembros derivados de una fusión, el costo (viejo y nuevo) se deriva
 * del CANÓNICO × factor — esa parte no la toca este doc (ya la resolvió
 * prompt-costos-precios-fusion.md); acá solo cambia CUÁL costo del canónico
 * gana la cadena.
 *
 * Grupos (doc §3):
 *   1. Precio pasa de MISSING a STANDARD       — revisar que el precio estándar esté vigente
 *   2. Costo cambia de global a WAC de sucursal — el margen de esa sucursal cambia
 *   3. Costo pasa de 0 a un valor real           — dejan de ser "vendibles a cualquier precio"
 *   4. Costo efectivo cambia más de 15%          — los que hay que mirar de a uno
 *
 * Ordenado por EXPOSICIÓN = stock disponible × |Δcosto| dentro de cada grupo,
 * para que el primer renglón sea el que más plata mueve.
 *
 * Uso: npx tsx scripts/audit-pricing-shift.ts
 */
import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { getEffectiveProductPricingBatch } from "@/modules/catalog/effective-pricing";
import { convertBaseUnitCostToSaleUnitCost } from "@/modules/inventory/unit-conversion";

const COST_SHIFT_THRESHOLD_PCT = 15;

function fmt(v: number | null) {
  return v === null ? "—" : `C$${v.toFixed(2)}`;
}

/** La cadena de costo VIEJA: branchCost > averageCost > globalCost > lastPurchaseCost > WAC > null — sin guarda de cero. */
function oldResolveCost(input: {
  branchCost: Prisma.Decimal | null;
  averageCost: Prisma.Decimal | null;
  globalCost: Prisma.Decimal | null;
  lastPurchaseCost: Prisma.Decimal | null;
  weightedAverageCost: Prisma.Decimal | null;
}): { cost: number | null; source: string } {
  const cost = input.branchCost ?? input.averageCost ?? input.globalCost ?? input.lastPurchaseCost ?? input.weightedAverageCost ?? null;
  const source = input.branchCost !== null ? "BRANCH"
    : input.averageCost !== null ? "GLOBAL_AVERAGE"
    : input.globalCost !== null ? "GLOBAL"
    : input.lastPurchaseCost !== null ? "LAST_PURCHASE"
    : input.weightedAverageCost !== null ? "WAC_ESTIMATE"
    : "NONE";
  return { cost: cost === null ? null : Number(cost), source };
}

/** El precio VIEJO: solo branchPrice, sin respaldo al precio estándar. */
function oldResolvePrice(branchPrice: Prisma.Decimal | null): { price: number | null; source: "BRANCH" | "MISSING" } {
  return { price: branchPrice === null ? null : Number(branchPrice), source: branchPrice === null ? "MISSING" : "BRANCH" };
}

async function main() {
  const branches = await prisma.branch.findMany({ where: { isActive: true }, select: { id: true, code: true } });

  const groups = await prisma.productStockGroup.findMany({
    where: { isActive: true },
    include: { products: { where: { isActive: true }, select: { productId: true, isCanonical: true, conversionFactor: true } } },
  });
  const canonicalIdByMemberId = new Map<string, string>();
  const factorByMemberId = new Map<string, number>();
  for (const group of groups) {
    const canonical = group.products.find((m) => m.isCanonical);
    if (!canonical) continue;
    for (const member of group.products) {
      canonicalIdByMemberId.set(member.productId, canonical.productId);
      factorByMemberId.set(member.productId, Number(member.conversionFactor));
    }
  }

  const [balances, settings, allProducts] = await Promise.all([
    prisma.inventoryBalance.findMany({ select: { branchId: true, productId: true, quantityOnHand: true, weightedAverageCost: true } }),
    prisma.branchProductSetting.findMany({ select: { branchId: true, productId: true, branchPrice: true, branchCost: true } }),
    prisma.product.findMany({ where: { isActive: true }, select: { id: true, sku: true, name: true, standardSalePrice: true, globalCost: true, averageCost: true, lastPurchaseCost: true } }),
  ]);
  const productById = new Map(allProducts.map((p) => [p.id, p]));
  const balanceByKey = new Map(balances.map((b) => [`${b.branchId}:${b.productId}`, b]));
  const settingByKey = new Map(settings.map((s) => [`${s.branchId}:${s.productId}`, s]));

  const presenceKeys = new Set<string>();
  for (const b of balances) if (productById.has(b.productId)) presenceKeys.add(`${b.branchId}:${b.productId}`);
  for (const s of settings) if (productById.has(s.productId)) presenceKeys.add(`${s.branchId}:${s.productId}`);
  const items = [...presenceKeys].map((key) => {
    const [branchId, productId] = key.split(":");
    return { branchId, productId };
  });

  console.log(`Auditando ${items.length} pares (sucursal, producto) en ${branches.length} sucursal(es)...\n`);

  const newByKey = await getEffectiveProductPricingBatch(prisma, items);

  type Row = {
    branchId: string; productId: string; sku: string; name: string;
    oldPrice: number | null; oldPriceSource: string; newPrice: number | null; newPriceSource: string;
    oldCost: number | null; oldCostSource: string; newCost: number | null; newCostSource: string;
    exposure: number;
  };
  const rows: Row[] = [];

  for (const { branchId, productId } of items) {
    const key = `${branchId}:${productId}`;
    const product = productById.get(productId);
    const newPricing = newByKey.get(key);
    if (!product || !newPricing) continue;

    const setting = settingByKey.get(key) ?? null;
    const canonicalId = canonicalIdByMemberId.get(productId) ?? null;
    const factor = factorByMemberId.get(productId) ?? null;
    const isFusionMember = canonicalId !== null && canonicalId !== productId;

    const oldPriceResult = oldResolvePrice(setting?.branchPrice ?? null);

    let oldCostResult: { cost: number | null; source: string };
    if (isFusionMember && canonicalId && factor) {
      const canonicalProduct = productById.get(canonicalId);
      const canonicalSetting = settingByKey.get(`${branchId}:${canonicalId}`) ?? null;
      const canonicalBalance = balanceByKey.get(`${branchId}:${canonicalId}`) ?? null;
      const canonicalOld = oldResolveCost({
        branchCost: canonicalSetting?.branchCost ?? null,
        averageCost: canonicalProduct?.averageCost ?? null,
        globalCost: canonicalProduct?.globalCost ?? null,
        lastPurchaseCost: canonicalProduct?.lastPurchaseCost ?? null,
        weightedAverageCost: canonicalBalance?.weightedAverageCost ?? null,
      });
      oldCostResult = {
        cost: canonicalOld.cost === null ? null : Number(convertBaseUnitCostToSaleUnitCost({ baseUnitCost: canonicalOld.cost, conversionFactor: factor })),
        source: canonicalOld.source,
      };
    } else {
      const balance = balanceByKey.get(key) ?? null;
      oldCostResult = oldResolveCost({
        branchCost: setting?.branchCost ?? null,
        averageCost: product.averageCost,
        globalCost: product.globalCost,
        lastPurchaseCost: product.lastPurchaseCost,
        weightedAverageCost: balance?.weightedAverageCost ?? null,
      });
    }

    const newPrice = newPricing.effectivePrice === null ? null : Number(newPricing.effectivePrice);
    const newCost = newPricing.effectiveCost === null ? null : Number(newPricing.effectiveCost);
    const stock = Number((isFusionMember && canonicalId ? balanceByKey.get(`${branchId}:${canonicalId}`)?.quantityOnHand : balanceByKey.get(key)?.quantityOnHand) ?? 0);
    const deltaCost = oldCostResult.cost === null || newCost === null ? 0 : Math.abs(newCost - oldCostResult.cost);

    rows.push({
      branchId, productId, sku: product.sku, name: product.name,
      oldPrice: oldPriceResult.price, oldPriceSource: oldPriceResult.source, newPrice, newPriceSource: newPricing.priceSource,
      oldCost: oldCostResult.cost, oldCostSource: oldCostResult.source, newCost, newCostSource: newPricing.costSource,
      exposure: stock * deltaCost,
    });
  }

  const branchCode = (id: string) => branches.find((b) => b.id === id)?.code ?? id;

  // ── Grupo 1: precio pasa de MISSING a STANDARD ──
  const priceUnlocked = rows.filter((r) => r.oldPriceSource === "MISSING" && r.newPriceSource === "STANDARD");
  console.log("─".repeat(96));
  console.log(`GRUPO 1 · PRECIO DESBLOQUEADO — de sin precio a precio estándar (revisar vigencia) — ${priceUnlocked.length}`);
  console.log("─".repeat(96));
  for (const r of priceUnlocked.sort((a, b) => (b.newPrice ?? 0) - (a.newPrice ?? 0)).slice(0, 200)) {
    console.log(`  ${r.sku} · ${r.name} · ${branchCode(r.branchId)} · nuevo precio=${fmt(r.newPrice)}`);
  }
  if (priceUnlocked.length > 200) console.log(`  … y ${priceUnlocked.length - 200} más`);

  // ── Grupo 2: costo cambia de global a WAC de sucursal ──
  const costToWac = rows.filter((r) => r.newCostSource === "WAC_ESTIMATE" && r.oldCostSource !== "WAC_ESTIMATE" && r.oldCostSource !== "BRANCH");
  console.log("");
  console.log("─".repeat(96));
  console.log(`GRUPO 2 · COSTO PASA A SER EL WAC DE ESTA SUCURSAL (antes: costo global de toda la red) — ${costToWac.length} — ordenado por exposición`);
  console.log("─".repeat(96));
  for (const r of costToWac.sort((a, b) => b.exposure - a.exposure).slice(0, 200)) {
    console.log(`  ${r.sku} · ${r.name} · ${branchCode(r.branchId)} · costo ${r.oldCostSource} ${fmt(r.oldCost)} → WAC ${fmt(r.newCost)} · exposición=${fmt(r.exposure)}`);
  }
  if (costToWac.length > 200) console.log(`  … y ${costToWac.length - 200} más`);

  // ── Grupo 3: costo pasa de 0 a un valor real ──
  const zeroToReal = rows.filter((r) => r.oldCost !== null && Math.abs(r.oldCost) < 0.01 && r.newCost !== null && r.newCost > 0.01);
  console.log("");
  console.log("─".repeat(96));
  console.log(`GRUPO 3 · COSTO ERA CERO Y AHORA ES REAL (antes: "vendible a cualquier precio") — ${zeroToReal.length} — ordenado por exposición`);
  console.log("─".repeat(96));
  for (const r of zeroToReal.sort((a, b) => b.exposure - a.exposure).slice(0, 200)) {
    console.log(`  ${r.sku} · ${r.name} · ${branchCode(r.branchId)} · costo 0 → ${fmt(r.newCost)} (${r.newCostSource}) · precio actual=${fmt(r.newPrice)} · exposición=${fmt(r.exposure)}`);
    if (r.newPrice !== null && r.newCost !== null && r.newPrice < r.newCost) console.log(`      ⚠ con el costo real, este precio queda DEBAJO del costo — el guard lo va a bloquear`);
  }
  if (zeroToReal.length > 200) console.log(`  … y ${zeroToReal.length - 200} más`);

  // ── Grupo 4: costo efectivo cambia más del umbral ──
  const rowKey = (r: Row) => `${r.branchId}:${r.productId}`;
  const alreadyShown = new Set([...costToWac, ...zeroToReal].map(rowKey)); // Grupo 1 es de precio, no de costo — no se excluye acá
  const bigShift = rows.filter((r) => {
    if (r.oldCost === null || r.newCost === null || r.oldCost <= 0) return false;
    if (alreadyShown.has(rowKey(r))) return false; // ya aparecen en el grupo 2 o 3
    return Math.abs(r.newCost - r.oldCost) / r.oldCost * 100 > COST_SHIFT_THRESHOLD_PCT;
  });
  console.log("");
  console.log("─".repeat(96));
  console.log(`GRUPO 4 · COSTO EFECTIVO CAMBIA MÁS DE ${COST_SHIFT_THRESHOLD_PCT}% (revisar de a uno) — ${bigShift.length} — ordenado por exposición`);
  console.log("─".repeat(96));
  for (const r of bigShift.sort((a, b) => b.exposure - a.exposure).slice(0, 200)) {
    const pct = ((r.newCost! - r.oldCost!) / r.oldCost! * 100).toFixed(1);
    console.log(`  ${r.sku} · ${r.name} · ${branchCode(r.branchId)} · costo ${fmt(r.oldCost)} → ${fmt(r.newCost)} (${pct}%) · exposición=${fmt(r.exposure)}`);
  }
  if (bigShift.length > 200) console.log(`  … y ${bigShift.length - 200} más`);

  console.log("");
  console.log("=".repeat(96));
  console.log(`RESUMEN: ${priceUnlocked.length} con precio desbloqueado · ${costToWac.length} pasan a WAC de sucursal · ${zeroToReal.length} de costo 0 a real · ${bigShift.length} con otro cambio >${COST_SHIFT_THRESHOLD_PCT}%.`);
  console.log(`Exposición total (grupos 2-4): ${fmt([...costToWac, ...zeroToReal, ...bigShift].reduce((s, r) => s + r.exposure, 0))}`);
  console.log("Antes de activar en producción: revisar Grupo 1 con los precios estándar a la vista, y Grupo 3 por si desbloquea el guard de venta bajo costo en algo que hoy se vende sin problema.");
}

main()
  .catch((e) => {
    console.error(e);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
