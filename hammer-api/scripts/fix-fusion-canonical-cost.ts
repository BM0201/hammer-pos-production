/**
 * prompt-auditoria-rechazos-y-cierre-de-costos.md A-2/A-3 — corrección de
 * costo por evidencia EXPLÍCITA. El script nunca elige la fuente solo: el
 * operador la decide por (grupo, sucursal), con el reporte de
 * audit-cost-evidence.ts (A-1) a la vista.
 *
 * Para los grupos de hierro la fuente de costo dominante es WAC_ESTIMATE
 * (prompt-fusionado-invendible-409.md P-0.4): branchCost/averageCost/
 * globalCost/lastPurchaseCost del canónico casi nunca están seteados, así
 * que el WAC gana la cadena sin importar qué se escriba en esos otros
 * campos. Por eso las fuentes 1/2/4 (compra real, movimiento limpio,
 * reconstrucción por factor) escriben directo sobre
 * InventoryBalance.weightedAverageCost — es la única forma de que el
 * arreglo tenga efecto real. La fuente 3 (sucursal hermana) es distinta a
 * propósito: escribe en BranchProductSetting.branchCost, que gana la
 * cadena SIN tocar el WAC contaminado por debajo — un valor prestado,
 * identificable y reversible con solo borrar ese campo.
 *
 * No se toca InventoryMovement (es el libro histórico, igual que
 * TreasuryEntry — se corrige el saldo derivado, no el pasado).
 *
 * Dry-run por defecto. --write ejecuta la escritura, un segundo paso
 * explícito.
 *
 * Uso:
 *   npx tsx scripts/fix-fusion-canonical-cost.ts --group=<code> --branch=<code> --source=po [--write]
 *   npx tsx scripts/fix-fusion-canonical-cost.ts --group=<code> --branch=<code> --source=movement [--write]
 *   npx tsx scripts/fix-fusion-canonical-cost.ts --group=<code> --branch=<code> --source=sibling-branch --from=<code> [--write]
 *   npx tsx scripts/fix-fusion-canonical-cost.ts --group=<code> --branch=<code> --source=factor [--write]
 *   npx tsx scripts/fix-fusion-canonical-cost.ts --group=<code> --branch=<code> --source=null [--include-wac] [--write]
 */
import { prisma } from "@/lib/prisma";
import { Prisma } from "@prisma/client";
import { isInboundMovement } from "@/modules/inventory/wac";
import { getEffectiveProductPricingBatch } from "@/modules/catalog/effective-pricing";

const CONTAMINATION_WINDOW_START = new Date("2026-08-03T00:00:00Z");
const FACTOR_TOLERANCE = 0.15;
const MARGIN_BAND_LOW = 0;
const MARGIN_BAND_HIGH = 0.9;

type Source = "po" | "movement" | "sibling-branch" | "factor" | "null";

function parseArgs() {
  const args = process.argv.slice(2);
  const get = (flag: string) => {
    const found = args.find((a) => a.startsWith(`--${flag}=`));
    return found ? found.slice(flag.length + 3) : undefined;
  };
  return {
    group: get("group"),
    branch: get("branch"),
    source: get("source") as Source | undefined,
    from: get("from"),
    write: args.includes("--write"),
    includeWac: args.includes("--include-wac"),
  };
}

function fmt(v: Prisma.Decimal | number | null) {
  if (v === null) return "—";
  return `C$${Number(v).toFixed(4)}`;
}

async function resolveGroupAndBranch(groupCode: string, branchCode: string) {
  const group = await prisma.productStockGroup.findFirst({
    where: { code: groupCode },
    include: { products: { include: { product: { select: { id: true, sku: true, name: true } } } } },
  });
  if (!group) throw new Error(`Grupo ${groupCode} no encontrado`);
  const canonical = group.products.find((m) => m.isCanonical);
  if (!canonical) throw new Error(`Grupo ${groupCode} sin canónico activo`);
  const derivedFactors = group.products.filter((m) => !m.isCanonical).map((m) => Number(m.conversionFactor));

  const branch = await prisma.branch.findFirst({ where: { code: branchCode }, select: { id: true, code: true } });
  if (!branch) throw new Error(`Sucursal ${branchCode} no encontrada`);

  return { group, canonical, derivedFactors, branch };
}

async function currentState(canonicalId: string, branchId: string) {
  const [balance, setting] = await Promise.all([
    prisma.inventoryBalance.findUnique({
      where: { branchId_productId: { branchId, productId: canonicalId } },
      select: { quantityOnHand: true, weightedAverageCost: true, inventoryValue: true },
    }),
    prisma.branchProductSetting.findUnique({
      where: { branchId_productId: { branchId, productId: canonicalId } },
      select: { branchCost: true, branchPrice: true },
    }),
  ]);
  return { balance, setting };
}

/** Vista previa: costo/precio efectivos ANTES (estado real) vs DESPUÉS (proyectado con el candidato) de cada miembro del grupo. */
async function reportEffectiveCostChange(
  canonicalId: string,
  branchId: string,
  group: Awaited<ReturnType<typeof resolveGroupAndBranch>>["group"],
  proposedCanonicalCost: Prisma.Decimal,
) {
  const memberIds = group.products.map((m) => m.productId);
  const items = memberIds.map((productId) => ({ branchId, productId }));
  const pricing = await getEffectiveProductPricingBatch(prisma, items);
  console.log("    Antes → después (proyectado con el candidato):");
  for (const member of group.products) {
    const p = pricing.get(`${branchId}:${member.productId}`);
    if (!p) continue;
    const projectedCost = proposedCanonicalCost.mul(member.conversionFactor);
    const projectedPrice = p.effectivePrice;
    const projectedSellability = projectedPrice === null
      ? "NO_COST"
      : projectedPrice.lt(projectedCost)
        ? "BELOW_COST"
        : "OK";
    console.log(
      `    → ${member.product.sku}: effectiveCost ${fmt(p.effectiveCost)} → ${fmt(projectedCost)} · effectivePrice=${fmt(p.effectivePrice)} · sellability ${p.sellability} → ${projectedSellability}`,
    );
  }
}

async function main() {
  const { group: groupCode, branch: branchCode, source, from, write, includeWac } = parseArgs();
  if (!groupCode || !branchCode || !source) {
    console.error("Uso: npx tsx scripts/fix-fusion-canonical-cost.ts --group=<code> --branch=<code> --source=po|movement|sibling-branch|factor|null [--from=<code>] [--include-wac] [--write]");
    process.exitCode = 1;
    return;
  }

  console.log(write ? "=== MODO ESCRITURA ===" : "=== DRY RUN (default) — no se escribe nada ===");
  const { group, canonical, derivedFactors, branch } = await resolveGroupAndBranch(groupCode, branchCode);
  console.log(`Grupo ${group.code} · canónico ${canonical.product.sku} (${canonical.product.name}) · sucursal ${branch.code} · fuente=${source}`);

  const { balance, setting } = await currentState(canonical.productId, branch.id);
  if (!balance) {
    console.log("  Sin InventoryBalance para este (canónico, sucursal) — nada que corregir.");
    return;
  }
  console.log(`  Estado actual: qty=${balance.quantityOnHand.toString()} WAC=${fmt(balance.weightedAverageCost)} branchCost=${fmt(setting?.branchCost ?? null)}`);

  if (source === "po") {
    const lines = await prisma.purchaseOrderLine.findMany({
      where: { productId: canonical.productId },
      select: { unitCost: true, finalUnitCost: true, purchaseOrder: { select: { createdAt: true, orderNumber: true, status: true } } },
      orderBy: { purchaseOrder: { createdAt: "desc" } },
    });
    if (lines.length === 0) {
      console.log("  SIN BASE DEFENDIBLE: no hay PurchaseOrderLine para este canónico.");
      return;
    }
    const best = lines[0];
    const candidate = best.finalUnitCost.gt(0) ? best.finalUnitCost : best.unitCost;
    console.log(`  Candidato (orden ${best.purchaseOrder.orderNumber}, ${best.purchaseOrder.createdAt.toISOString().slice(0, 10)}): ${fmt(candidate)}`);
    console.log(`  → PROPUESTA: WAC ${fmt(balance.weightedAverageCost)} → ${fmt(candidate)}`);
    await reportEffectiveCostChange(canonical.productId, branch.id, group, candidate);
    if (write) await writeWac(canonical.productId, branch.id, candidate, group.code, "PURCHASE_ORDER", { orderNumber: best.purchaseOrder.orderNumber });
    return;
  }

  if (source === "movement") {
    const clean = await prisma.inventoryMovement.findMany({
      where: { productId: canonical.productId, branchId: branch.id, createdAt: { lt: CONTAMINATION_WINDOW_START } },
      select: { id: true, unitCost: true, movementType: true, createdAt: true },
      orderBy: { createdAt: "desc" },
    });
    if (clean.length === 0) {
      console.log("  SIN BASE DEFENDIBLE: no hay InventoryMovement anterior a la carga contaminada para esta sucursal.");
      return;
    }
    // No basta con "el más reciente": una sola fila ADJUSTMENT_IN/MANUAL_ADJUSTMENT
    // puede ser SU PROPIA contaminación aislada (mismo patrón, otra fecha —
    // la ventana de contaminación de Rivas 2026-08-03 no es la única). Un valor
    // que SE REPITE en varias filas (incluidas SALE_OUT, cuyo unitCost es el WAC
    // vigente al momento de la venta) es evidencia más fuerte que una fila única
    // aislada, sea cual sea su movementType.
    const buckets = new Map<string, { value: Prisma.Decimal; rows: typeof clean }>();
    for (const m of clean) {
      const key = Number(m.unitCost).toFixed(2);
      const bucket = buckets.get(key) ?? { value: m.unitCost, rows: [] };
      bucket.rows.push(m);
      buckets.set(key, bucket);
    }
    const ranked = [...buckets.values()].sort((a, b) => {
      if (b.rows.length !== a.rows.length) return b.rows.length - a.rows.length;
      return b.rows[0].createdAt.getTime() - a.rows[0].createdAt.getTime();
    });
    const top = ranked[0];
    const candidate = top.value;
    const isSingleIsolatedInbound = top.rows.length === 1 && isInboundMovement(top.rows[0].movementType);
    console.log(`  Candidatos por valor (${ranked.length} distintos, ${clean.length} filas limpias totales):`);
    for (const r of ranked.slice(0, 5)) {
      console.log(`    ${fmt(r.value)} — ${r.rows.length} fila(s), tipos: ${[...new Set(r.rows.map((x) => x.movementType))].join(",")}, más reciente ${r.rows[0].createdAt.toISOString().slice(0, 10)}`);
    }
    if (isSingleIsolatedInbound && ranked.length > 1) {
      console.log("  ADVERTENCIA: el candidato con más soporte es una única fila inbound aislada — revisar a mano antes de confiar en esto.");
    }
    console.log(`  Candidato elegido (mayor recurrencia): ${fmt(candidate)}`);
    console.log(`  → PROPUESTA: WAC ${fmt(balance.weightedAverageCost)} → ${fmt(candidate)}`);
    await reportEffectiveCostChange(canonical.productId, branch.id, group, candidate);
    if (write) await writeWac(canonical.productId, branch.id, candidate, group.code, "CLEAN_MOVEMENT", { supportingRows: top.rows.length, movementIds: top.rows.map((r) => r.id), mostRecentDate: top.rows[0].createdAt.toISOString() });
    return;
  }

  if (source === "sibling-branch") {
    if (!from) {
      console.error("  --source=sibling-branch requiere --from=<branchCode>");
      process.exitCode = 1;
      return;
    }
    const siblingBranch = await prisma.branch.findFirst({ where: { code: from }, select: { id: true, code: true } });
    if (!siblingBranch) throw new Error(`Sucursal origen ${from} no encontrada`);
    const [siblingBalance, siblingSetting] = await Promise.all([
      prisma.inventoryBalance.findUnique({ where: { branchId_productId: { branchId: siblingBranch.id, productId: canonical.productId } }, select: { weightedAverageCost: true } }),
      prisma.branchProductSetting.findUnique({ where: { branchId_productId: { branchId: siblingBranch.id, productId: canonical.productId } }, select: { branchCost: true } }),
    ]);
    const candidate = siblingSetting?.branchCost ?? (siblingBalance?.weightedAverageCost.gt(0) ? siblingBalance.weightedAverageCost : null);
    if (!candidate) {
      console.log(`  SIN BASE DEFENDIBLE: ${from} no tiene branchCost ni WAC usable para este canónico.`);
      return;
    }
    console.log(`  Candidato (sucursal ${from}, ${siblingSetting?.branchCost ? "branchCost" : "WAC"}): ${fmt(candidate)}`);
    console.log(`  → PROPUESTA: branchCost de ${branch.code} (hoy ${fmt(setting?.branchCost ?? null)}) → ${fmt(candidate)} — préstamo de ${from}, no toca el WAC contaminado, reversible borrando branchCost`);
    await reportEffectiveCostChange(canonical.productId, branch.id, group, candidate);
    if (write) await writeBranchCost(canonical.productId, branch.id, candidate, group.code, siblingBranch.id, siblingBranch.code);
    return;
  }

  if (source === "factor") {
    if (derivedFactors.length === 0) {
      console.log("  SIN BASE DEFENDIBLE: el grupo no tiene miembros derivados con factor.");
      return;
    }
    const currentWac = balance.weightedAverageCost;
    let bestCandidate: { factor: number; value: Prisma.Decimal } | null = null;
    for (const factor of derivedFactors) {
      if (factor <= 1) continue;
      bestCandidate = { factor, value: currentWac.div(factor) };
      break;
    }
    if (!bestCandidate) {
      console.log("  SIN BASE DEFENDIBLE: ningún factor de fusión > 1 en este grupo.");
      return;
    }
    const candidate = bestCandidate.value;

    // Corroboración 1: margen contra el precio efectivo del canónico cae en banda sana.
    const canonicalPricing = (await getEffectiveProductPricingBatch(prisma, [{ branchId: branch.id, productId: canonical.productId }])).get(`${branch.id}:${canonical.productId}`);
    const effectivePrice = canonicalPricing?.effectivePrice ?? null;
    const margin = effectivePrice && effectivePrice.gt(0) ? Number(effectivePrice.sub(candidate).div(effectivePrice)) : null;
    const marginOk = margin !== null && margin >= MARGIN_BAND_LOW && margin <= MARGIN_BAND_HIGH;

    // Corroboración 2: el valor reconstruido cae dentro de 15% de OTRA fuente independiente (po/movement/sibling).
    const [poLines, cleanMovements, siblingBalances, siblingSettings] = await Promise.all([
      prisma.purchaseOrderLine.findMany({ where: { productId: canonical.productId }, select: { unitCost: true, finalUnitCost: true } }),
      prisma.inventoryMovement.findMany({ where: { productId: canonical.productId, branchId: branch.id, createdAt: { lt: CONTAMINATION_WINDOW_START } }, select: { unitCost: true, movementType: true } }),
      prisma.inventoryBalance.findMany({ where: { productId: canonical.productId, branchId: { not: branch.id }, weightedAverageCost: { gt: 0 } }, select: { weightedAverageCost: true } }),
      prisma.branchProductSetting.findMany({ where: { productId: canonical.productId, branchId: { not: branch.id }, branchCost: { not: null } }, select: { branchCost: true } }),
    ]);
    const independentCandidates: Prisma.Decimal[] = [
      ...poLines.map((l) => (l.finalUnitCost.gt(0) ? l.finalUnitCost : l.unitCost)),
      ...cleanMovements.filter((m) => isInboundMovement(m.movementType)).map((m) => m.unitCost),
      ...siblingBalances.map((b) => b.weightedAverageCost),
      ...siblingSettings.map((s) => s.branchCost!),
    ];
    let corroboration2: { value: Prisma.Decimal; deviation: number } | null = null;
    for (const c of independentCandidates) {
      if (c.lte(0)) continue;
      const deviation = Math.abs(Number(candidate.sub(c).div(c)));
      if (deviation <= FACTOR_TOLERANCE && (!corroboration2 || deviation < corroboration2.deviation)) {
        corroboration2 = { value: c, deviation };
      }
    }

    console.log(`  Reconstrucción por factor: WAC actual ${fmt(currentWac)} ÷ ${bestCandidate.factor} = ${fmt(candidate)}`);
    console.log(`  Corroboración 1 (margen 0-90%): margen=${margin === null ? "—" : `${(margin * 100).toFixed(1)}%`} → ${marginOk ? "OK" : "FALLA"}`);
    console.log(`  Corroboración 2 (±15% de fuente independiente): ${corroboration2 ? `OK — coincide con ${fmt(corroboration2.value)} (desvío ${(corroboration2.deviation * 100).toFixed(1)}%)` : "FALLA — ninguna fuente independiente lo corrobora"}`);

    if (!marginOk || !corroboration2) {
      console.log("  → NO SE PROPONE CORRECCIÓN: faltan las dos corroboraciones simultáneas (regla A-2, fuente 4).");
      return;
    }
    console.log(`  → PROPUESTA (PROVISIONAL): WAC ${fmt(currentWac)} → ${fmt(candidate)}`);
    await reportEffectiveCostChange(canonical.productId, branch.id, group, candidate);
    if (write) await writeWac(canonical.productId, branch.id, candidate, group.code, "FACTOR_RECONSTRUCTION", { factor: bestCandidate.factor, margin, corroboratedBy: corroboration2.value.toString(), corroborationDeviation: corroboration2.deviation }, true);
    return;
  }

  if (source === "null") {
    console.log("  Fuente NULL — ver A-3. Limpiando campos de costo del canónico en esta sucursal.");
    if (includeWac) {
      const currentValuation = balance.quantityOnHand.mul(balance.weightedAverageCost);
      console.log(`  DELTA DE VALUACIÓN: inventario actual = ${fmt(currentValuation)} (qty ${balance.quantityOnHand.toString()} × WAC ${fmt(balance.weightedAverageCost)})`);
      console.log(`  DELTA DE VALUACIÓN: inventario después = C$0.00 (WAC pasa a 0 → NO_COST)`);
      console.log(`  DELTA DE VALUACIÓN: diferencia = ${fmt(currentValuation.neg())}`);
      console.log("  Esta es una decisión de Master, informada por el delta — no la toma este script solo. Confirmar con --write --include-wac es la confirmación explícita.");
    } else {
      console.log("  (sin --include-wac: solo se limpiarían branchCost/averageCost/globalCost/lastPurchaseCost — el WAC sigue dominando la cadena y costSource NO cambiará a NONE. Ver nota A-3 del doc.)");
    }
    if (write) {
      await prisma.$transaction(async (tx) => {
        await tx.$queryRaw`SELECT id FROM "InventoryBalance" WHERE "branchId" = ${branch.id} AND "productId" = ${canonical.productId} FOR UPDATE`;
        const before = await tx.inventoryBalance.findUniqueOrThrow({ where: { branchId_productId: { branchId: branch.id, productId: canonical.productId } } });
        await tx.branchProductSetting.upsert({
          where: { branchId_productId: { branchId: branch.id, productId: canonical.productId } },
          create: { branchId: branch.id, productId: canonical.productId, branchCost: null },
          update: { branchCost: null },
        });
        let valuationDelta: string | null = null;
        if (includeWac) {
          const currentValuation = before.quantityOnHand.mul(before.weightedAverageCost);
          await tx.inventoryBalance.update({
            where: { branchId_productId: { branchId: branch.id, productId: canonical.productId } },
            data: { weightedAverageCost: new Prisma.Decimal(0), inventoryValue: new Prisma.Decimal(0) },
          });
          valuationDelta = currentValuation.neg().toString();
        }
        await tx.auditLog.create({
          data: {
            actorUserId: null,
            branchId: branch.id,
            module: "catalog",
            action: "COST_BASIS_CLEARED",
            entityType: "InventoryBalance",
            entityId: canonical.productId,
            metadataJson: {
              source: "script:fix-fusion-canonical-cost",
              stockGroupCode: group.code,
              previousBranchCost: setting?.branchCost?.toString() ?? null,
              previousWac: before.weightedAverageCost.toString(),
              includedWac: includeWac,
              valuationDelta,
              justification: "Sin evidencia recuperable (Fuentes 1-4 agotadas) — NULL es mas honesto que un costo inventado.",
            },
          },
        });
      });
      console.log("  ✓ Escrito y auditado (COST_BASIS_CLEARED).");
    }
    return;
  }
}

async function writeWac(
  canonicalId: string,
  branchId: string,
  newWac: Prisma.Decimal,
  groupCode: string,
  evidenceSource: string,
  evidenceDetail: Record<string, unknown>,
  provisional = false,
) {
  await prisma.$transaction(async (tx) => {
    await tx.$queryRaw`SELECT id FROM "InventoryBalance" WHERE "branchId" = ${branchId} AND "productId" = ${canonicalId} FOR UPDATE`;
    const before = await tx.inventoryBalance.findUniqueOrThrow({ where: { branchId_productId: { branchId, productId: canonicalId } } });
    const newInventoryValue = before.quantityOnHand.mul(newWac);
    await tx.inventoryBalance.update({
      where: { branchId_productId: { branchId, productId: canonicalId } },
      data: { weightedAverageCost: newWac, inventoryValue: newInventoryValue },
    });
    await tx.auditLog.create({
      data: {
        actorUserId: null,
        branchId,
        module: "catalog",
        action: "FUSION_COST_BASIS_CORRECTED",
        entityType: "InventoryBalance",
        entityId: canonicalId,
        metadataJson: {
          source: "script:fix-fusion-canonical-cost",
          stockGroupCode: groupCode,
          previousWac: before.weightedAverageCost.toString(),
          newWac: newWac.toString(),
          quantityOnHand: before.quantityOnHand.toString(),
          previousInventoryValue: before.inventoryValue.toString(),
          newInventoryValue: newInventoryValue.toString(),
          evidenceSource,
          provisional,
          ...evidenceDetail,
        },
      },
    });
  });
  console.log("  ✓ Escrito y auditado (FUSION_COST_BASIS_CORRECTED).");
}

async function writeBranchCost(
  canonicalId: string,
  branchId: string,
  newBranchCost: Prisma.Decimal,
  groupCode: string,
  fromBranchId: string,
  fromBranchCode: string,
) {
  await prisma.$transaction(async (tx) => {
    const before = await tx.branchProductSetting.findUnique({ where: { branchId_productId: { branchId, productId: canonicalId } } });
    await tx.branchProductSetting.upsert({
      where: { branchId_productId: { branchId, productId: canonicalId } },
      create: { branchId, productId: canonicalId, branchCost: newBranchCost },
      update: { branchCost: newBranchCost },
    });
    await tx.auditLog.create({
      data: {
        actorUserId: null,
        branchId,
        module: "catalog",
        action: "FUSION_COST_BASIS_CORRECTED",
        entityType: "BranchProductSetting",
        entityId: canonicalId,
        metadataJson: {
          source: "script:fix-fusion-canonical-cost",
          stockGroupCode: groupCode,
          previousBranchCost: before?.branchCost?.toString() ?? null,
          newBranchCost: newBranchCost.toString(),
          evidenceSource: "SIBLING_BRANCH",
          fromBranchId,
          fromBranchCode,
          provisional: false,
        },
      },
    });
  });
  console.log("  ✓ Escrito y auditado (FUSION_COST_BASIS_CORRECTED, evidenceSource=SIBLING_BRANCH).");
}

main()
  .catch((e) => {
    console.error(e);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
