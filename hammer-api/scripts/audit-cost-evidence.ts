/**
 * prompt-auditoria-rechazos-y-cierre-de-costos.md A-1 — inventario de
 * evidencia. Solo lectura, no escribe nada.
 *
 * Convierte las 169 investigaciones manuales de audit-pricing-coherence.ts
 * en una tabla: para cada par (canónico, sucursal) INVENDIBLE o COSTO DE
 * RELLENO, qué evidencia real existe para corregirlo, en la jerarquía de A-2:
 *
 *   1. Orden de compra    — PurchaseOrderLine (unitCost/finalUnitCost/snapshots)
 *   2. Movimiento limpio  — InventoryMovement anterior a la carga contaminada
 *   3. Sucursal hermana   — el MISMO canónico, otra sucursal
 *   4. Auditoría de carga — AuditLog del día de la carga, valor previo si lo hay
 *
 * Ese reporte es el entregable de A-1: decide cuántos de los 169 se pueden
 * cerrar sin papel, antes de escribir una sola fila (A-2/A-3).
 *
 * Uso: npx tsx scripts/audit-cost-evidence.ts
 */
import { prisma } from "@/lib/prisma";
import { getEffectiveProductPricingBatch } from "@/modules/catalog/effective-pricing";

const PLACEHOLDER_EPSILON = 0.01;
const PLACEHOLDER_VALUES = [0, 1];
// Rivas cargó su inventario inicial el 2026-08-03 (prompt-fusionado-invendible-409.md
// P-0.4) — el corte que separa "carga contaminada" de "movimiento limpio" para
// la Fuente 2. Ventana de un día completo en hora local aproximada por UTC.
const CONTAMINATION_WINDOW_START = new Date("2026-08-03T00:00:00Z");
const CONTAMINATION_WINDOW_END = new Date("2026-08-04T06:00:00Z");

function fmt(v: number | null) {
  return v === null ? "—" : `C$${v.toFixed(2)}`;
}

type Target = {
  branchId: string;
  branchCode: string;
  productId: string;
  canonicalId: string;
  sku: string;
  name: string;
  price: number | null;
  cost: number | null;
  costSource: string;
  kind: "INVENDIBLE" | "COSTO_DE_RELLENO";
  exposure: number;
};

async function main() {
  const branches = await prisma.branch.findMany({ where: { isActive: true }, select: { id: true, code: true } });
  const groups = await prisma.productStockGroup.findMany({
    where: { isActive: true },
    include: { products: { where: { isActive: true }, select: { productId: true, isCanonical: true, conversionFactor: true } } },
  });
  const canonicalIdByMemberId = new Map<string, string>();
  for (const group of groups) {
    const canonical = group.products.find((m) => m.isCanonical);
    if (!canonical) continue;
    for (const member of group.products) canonicalIdByMemberId.set(member.productId, canonical.productId);
  }

  const [balances, settings, allProducts] = await Promise.all([
    prisma.inventoryBalance.findMany({ select: { branchId: true, productId: true, quantityOnHand: true } }),
    prisma.branchProductSetting.findMany({ select: { branchId: true, productId: true } }),
    prisma.product.findMany({ where: { isActive: true }, select: { id: true, sku: true, name: true } }),
  ]);
  const productById = new Map(allProducts.map((p) => [p.id, p]));
  const canonicalBaseStock = new Map<string, number>();
  for (const b of balances) canonicalBaseStock.set(`${b.branchId}:${b.productId}`, Number(b.quantityOnHand));

  const presenceKeys = new Set<string>();
  for (const b of balances) if (productById.has(b.productId)) presenceKeys.add(`${b.branchId}:${b.productId}`);
  for (const s of settings) if (productById.has(s.productId)) presenceKeys.add(`${s.branchId}:${s.productId}`);
  const items = [...presenceKeys].map((key) => {
    const [branchId, productId] = key.split(":");
    return { branchId, productId };
  });

  console.log(`Clasificando ${items.length} pares (sucursal, producto)...\n`);
  const pricingByKey = await getEffectiveProductPricingBatch(prisma, items);

  const targets: Target[] = [];
  for (const { branchId, productId } of items) {
    const pricing = pricingByKey.get(`${branchId}:${productId}`);
    const product = productById.get(productId);
    if (!pricing || !product) continue;
    const price = pricing.effectivePrice === null ? null : Number(pricing.effectivePrice);
    const cost = pricing.effectiveCost === null ? null : Number(pricing.effectiveCost);
    const canonicalId = canonicalIdByMemberId.get(productId) ?? productId;
    const stock = canonicalBaseStock.get(`${branchId}:${canonicalId}`) ?? 0;

    if (price !== null && cost !== null && price < cost) {
      targets.push({
        branchId, branchCode: "", productId, canonicalId, sku: product.sku, name: product.name,
        price, cost, costSource: pricing.costSource, kind: "INVENDIBLE",
        exposure: stock * cost,
      });
      continue;
    }
    if (cost !== null) {
      const isPlaceholder = PLACEHOLDER_VALUES.some((v) => Math.abs(cost - v) <= PLACEHOLDER_EPSILON);
      if (isPlaceholder && stock > 0) {
        targets.push({
          branchId, branchCode: "", productId, canonicalId, sku: product.sku, name: product.name,
          price, cost, costSource: pricing.costSource, kind: "COSTO_DE_RELLENO",
          exposure: stock,
        });
      }
    }
  }
  const branchCode = (id: string) => branches.find((b) => b.id === id)?.code ?? id;
  for (const t of targets) t.branchCode = branchCode(t.branchId);

  const canonicalIds = [...new Set(targets.map((t) => t.canonicalId))];

  // ── Fuente 1: orden de compra (del canónico — es donde vive el material físico) ──
  const poLines = await prisma.purchaseOrderLine.findMany({
    where: { productId: { in: canonicalIds } },
    select: {
      productId: true, unitCost: true, finalUnitCost: true,
      previousGlobalCost: true, newGlobalCost: true, previousAverageCost: true, newAverageCost: true,
      purchaseOrder: { select: { createdAt: true, status: true } },
    },
    orderBy: { purchaseOrder: { createdAt: "desc" } },
  });
  const poByCanonical = new Map<string, typeof poLines>();
  for (const line of poLines) {
    const list = poByCanonical.get(line.productId) ?? [];
    list.push(line);
    poByCanonical.set(line.productId, list);
  }

  // ── Fuente 2: movimientos limpios (anteriores a la ventana de carga contaminada) ──
  const cleanMovements = await prisma.inventoryMovement.findMany({
    where: { productId: { in: canonicalIds }, createdAt: { lt: CONTAMINATION_WINDOW_START } },
    select: { productId: true, branchId: true, unitCost: true, conversionFactorSnapshot: true, movementType: true, createdAt: true },
    orderBy: { createdAt: "desc" },
  });
  const cleanByCanonical = new Map<string, typeof cleanMovements>();
  for (const mv of cleanMovements) {
    const list = cleanByCanonical.get(mv.productId) ?? [];
    list.push(mv);
    cleanByCanonical.set(mv.productId, list);
  }

  // ── Fuente 3: el mismo canónico, en OTRA sucursal, con WAC/branchCost usable ──
  const [siblingBalances, siblingSettings] = await Promise.all([
    prisma.inventoryBalance.findMany({
      where: { productId: { in: canonicalIds }, weightedAverageCost: { gt: 0 } },
      select: { productId: true, branchId: true, weightedAverageCost: true },
    }),
    prisma.branchProductSetting.findMany({
      where: { productId: { in: canonicalIds }, branchCost: { not: null } },
      select: { productId: true, branchId: true, branchCost: true },
    }),
  ]);
  const siblingBalanceByCanonical = new Map<string, typeof siblingBalances>();
  for (const b of siblingBalances) {
    const list = siblingBalanceByCanonical.get(b.productId) ?? [];
    list.push(b);
    siblingBalanceByCanonical.set(b.productId, list);
  }
  const siblingSettingByCanonical = new Map<string, typeof siblingSettings>();
  for (const s of siblingSettings) {
    const list = siblingSettingByCanonical.get(s.productId) ?? [];
    list.push(s);
    siblingSettingByCanonical.set(s.productId, list);
  }

  // ── Fuente 4: AuditLog de la ventana de carga, sobre el canónico ──
  const loadAuditRows = await prisma.auditLog.findMany({
    where: { entityId: { in: canonicalIds }, occurredAt: { gte: CONTAMINATION_WINDOW_START, lt: CONTAMINATION_WINDOW_END } },
    select: { entityId: true, action: true, metadataJson: true, occurredAt: true },
  });
  const loadAuditByCanonical = new Map<string, typeof loadAuditRows>();
  for (const row of loadAuditRows) {
    const list = loadAuditByCanonical.get(row.entityId) ?? [];
    list.push(row);
    loadAuditByCanonical.set(row.entityId, list);
  }

  targets.sort((a, b) => b.exposure - a.exposure);

  console.log("=".repeat(120));
  console.log(`${targets.length} pares (INVENDIBLE + COSTO DE RELLENO), ordenados por exposición`);
  console.log("=".repeat(120));

  let withAnyEvidence = 0;
  for (const t of targets) {
    const po = poByCanonical.get(t.canonicalId) ?? [];
    const clean = (cleanByCanonical.get(t.canonicalId) ?? []).filter((m) => m.branchId === t.branchId);
    const siblingBal = (siblingBalanceByCanonical.get(t.canonicalId) ?? []).filter((b) => b.branchId !== t.branchId);
    const siblingSet = (siblingSettingByCanonical.get(t.canonicalId) ?? []).filter((s) => s.branchId !== t.branchId);
    const loadAudit = loadAuditByCanonical.get(t.canonicalId) ?? [];

    const has1 = po.length > 0;
    const has2 = clean.length > 0;
    const has3 = siblingBal.length > 0 || siblingSet.length > 0;
    const has4 = loadAudit.length > 0;
    if (has1 || has2 || has3 || has4) withAnyEvidence += 1;

    console.log(`\n  ${t.sku} · ${t.name} · ${t.branchCode} · ${t.kind} · costo=${fmt(t.cost)} precio=${fmt(t.price)} fuente=${t.costSource} · exposición=${fmt(t.exposure)}`);
    console.log(`    1.OrdenCompra=${has1 ? "sí" : "no"}${has1 ? ` (candidato: ${fmt(Number(po[0].finalUnitCost || po[0].unitCost))}, ${po[0].purchaseOrder.createdAt.toISOString().slice(0, 10)})` : ""}`);
    console.log(`    2.MovLimpio  =${has2 ? "sí" : "no"}${has2 ? ` (candidato: ${fmt(Number(clean[0].unitCost))}, ${clean[0].createdAt.toISOString().slice(0, 10)}, ${clean.length} fila(s))` : ""}`);
    console.log(`    3.Hermana    =${has3 ? "sí" : "no"}${has3 ? ` (candidatos: ${[...siblingBal.map((b) => `${branchCode(b.branchId)}=${fmt(Number(b.weightedAverageCost))}`), ...siblingSet.map((s) => `${branchCode(s.branchId)}=${fmt(Number(s.branchCost))}`)].join(", ")})` : ""}`);
    console.log(`    4.CargaAudit =${has4 ? "sí" : "no"}${has4 ? ` (${loadAudit.length} evento(s): ${loadAudit.map((a) => a.action).join(", ")})` : ""}`);
  }

  console.log("\n" + "=".repeat(120));
  console.log(`RESUMEN: ${targets.length} pares totales · ${withAnyEvidence} con AL MENOS una fuente de evidencia · ${targets.length - withAnyEvidence} sin ninguna (candidatos a NULL, ver A-3).`);
  console.log(`Invendibles: ${targets.filter((t) => t.kind === "INVENDIBLE").length} · Costo de relleno: ${targets.filter((t) => t.kind === "COSTO_DE_RELLENO").length}`);
}

main()
  .catch((e) => {
    console.error(e);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
