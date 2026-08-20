/**
 * prompt-fusionado-invendible-409.md — P-1 (rama WAC_ESTIMATE, ver P-0.4).
 *
 * P-0.4 confirmó que createInventoryMovementTx/recalculateWeightedAverage
 * (src/modules/inventory/wac.ts) hacen bien su trabajo — no hay bug de
 * conversión de unidad en el código. El WAC contaminado viene de movimientos
 * OPENING_BALANCE_BULK / MANUAL_ADJUSTMENT donde alguien tecleó el costo del
 * QUINTAL directamente como costo de la unidad base (inputUnit=UNIDAD,
 * factorSnap=1) — dato de sucursal (carga inicial de Rivas, 2026-08-03), no
 * código. Por eso este script corrige DATO, no reescribe ningún writer.
 *
 * No se tocan las filas de InventoryMovement (son el libro histórico, igual
 * que TreasuryEntry — se corrige el saldo derivado, no el pasado). Se
 * reconstruye el WAC re-jugando SOLO los movimientos INBOUND del canónico con
 * la MISMA fórmula que usa el sistema (recalculateWeightedAverage), sustituyendo
 * el costo de las filas contaminadas por costoContaminado / factorDeFusión —
 * el mismo factor que ya vive en ProductStockGroupMember, no un número
 * inventado. Una fila solo se marca CONTAMINADA cuando existe otra fila
 * limpia del mismo canónico cuya razón con ella coincide con un factor real
 * del grupo (tolerancia 15%); sin ese ancla, se reporta SIN BASE DEFENDIBLE
 * y no se propone corrección — "prohibido inventar el costo".
 *
 * Dry-run por defecto (default seguro). --write ejecuta la escritura, un
 * segundo paso explícito.
 *
 * Uso:
 *   npx tsx scripts/fix-fusion-canonical-cost.ts --group=HIERRO_3_8_9V[,HIERRO_3_8_MM,...]
 *   npx tsx scripts/fix-fusion-canonical-cost.ts --group=... --write
 */
import { prisma } from "@/lib/prisma";
import { Prisma } from "@prisma/client";
import { recalculateWeightedAverage, isInboundMovement } from "@/modules/inventory/wac";

const TOLERANCE = 0.15;

function parseArgs() {
  const args = process.argv.slice(2);
  const groupArg = args.find((a) => a.startsWith("--group="));
  const groups = groupArg
    ? groupArg
        .slice("--group=".length)
        .split(",")
        .map((s) => s.trim())
        .filter(Boolean)
    : [];
  const write = args.includes("--write");
  return { groups, write };
}

function fmt(v: Prisma.Decimal | number | null) {
  if (v === null) return "—";
  return `C$${Number(v).toFixed(4)}`;
}

type MovementRow = {
  id: string;
  createdAt: Date;
  movementType: string;
  quantity: Prisma.Decimal;
  unitCost: Prisma.Decimal;
  inputUnit: string | null;
  conversionFactorSnapshot: Prisma.Decimal | null;
  referenceType: string;
  referenceId: string;
};

type ClassifiedMovement = MovementRow & {
  isInbound: boolean;
  status: "CLEAN" | "CONTAMINATED" | "IGNORED_NO_ANCHOR";
  correctedUnitCost: Prisma.Decimal;
  matchedFactor: number | null;
  anchorMovementId: string | null;
};

/**
 * Marca como CONTAMINADA cualquier fila INBOUND cuya razón contra OTRA fila
 * INBOUND limpia coincide (±15%) con un factor real del grupo. Solo la mayor
 * de cada par se marca — la hipótesis es "tecleó el precio del quintal donde
 * iba el precio de la unidad", nunca al revés.
 */
function classifyMovements(movements: MovementRow[], groupFactors: number[]): ClassifiedMovement[] {
  const inbound = movements.filter((m) => isInboundMovement(m.movementType));
  const contaminatedIds = new Map<string, { factor: number; anchorId: string }>();

  for (const a of inbound) {
    for (const b of inbound) {
      if (a.id === b.id) continue;
      const costA = Number(a.unitCost);
      const costB = Number(b.unitCost);
      if (costA <= costB) continue; // solo la mayor del par se marca
      const ratio = costA / costB;
      for (const factor of groupFactors) {
        if (factor <= 1) continue;
        if (Math.abs(ratio - factor) / factor <= TOLERANCE) {
          const existing = contaminatedIds.get(a.id);
          if (!existing || Math.abs(ratio - factor) < Math.abs(existing.factor - factor)) {
            contaminatedIds.set(a.id, { factor, anchorId: b.id });
          }
        }
      }
    }
  }

  return movements.map((m) => {
    const isInbound = isInboundMovement(m.movementType);
    const contamination = contaminatedIds.get(m.id);
    if (!isInbound) {
      return { ...m, isInbound, status: "CLEAN", correctedUnitCost: m.unitCost, matchedFactor: null, anchorMovementId: null };
    }
    if (contamination) {
      return {
        ...m,
        isInbound,
        status: "CONTAMINATED",
        correctedUnitCost: m.unitCost.div(contamination.factor),
        matchedFactor: contamination.factor,
        anchorMovementId: contamination.anchorId,
      };
    }
    return { ...m, isInbound, status: "CLEAN", correctedUnitCost: m.unitCost, matchedFactor: null, anchorMovementId: null };
  });
}

/** Re-juega SOLO los INBOUND (en orden), con costo corregido en las contaminadas, con la misma fórmula que usa el sistema. */
function reconstructWac(classified: ClassifiedMovement[]) {
  let qty = new Prisma.Decimal(0);
  let wac = new Prisma.Decimal(0);
  const cleanBasisIds: string[] = [];
  const correctedIds: string[] = [];

  for (const m of classified) {
    if (m.isInbound) {
      const next = recalculateWeightedAverage({
        currentQty: qty,
        currentWac: wac,
        movementQty: m.quantity,
        movementUnitCost: m.correctedUnitCost,
        inbound: true,
      });
      qty = next.newQty;
      wac = next.newWac;
      if (m.status === "CLEAN") cleanBasisIds.push(m.id);
      else correctedIds.push(m.id);
    } else {
      // OUT preserva WAC — solo descuenta cantidad, misma fórmula que recalculateWeightedAverage.
      qty = qty.sub(m.quantity);
    }
  }

  const hasDefensibleBasis = cleanBasisIds.length > 0;
  return { reconstructedWac: wac, reconstructedQty: qty, cleanBasisIds, correctedIds, hasDefensibleBasis };
}

async function main() {
  const { groups, write } = parseArgs();
  if (groups.length === 0) {
    console.error("Uso: npx tsx scripts/fix-fusion-canonical-cost.ts --group=<code>[,<code>...] [--write]");
    process.exitCode = 1;
    return;
  }

  console.log(write ? "=== MODO ESCRITURA ===" : "=== DRY RUN (default) — no se escribe nada ===");

  const stockGroups = await prisma.productStockGroup.findMany({
    where: { code: { in: groups } },
    include: { products: { include: { product: { select: { id: true, sku: true, name: true, globalCost: true, averageCost: true, lastPurchaseCost: true } } } } },
  });

  const branches = await prisma.branch.findMany({ select: { id: true, code: true } });

  for (const group of stockGroups) {
    console.log(`\n${"=".repeat(90)}\nGRUPO ${group.code}\n${"=".repeat(90)}`);
    const canonical = group.products.find((m) => m.isCanonical);
    if (!canonical) {
      console.log("  (sin canónico activo, se omite)");
      continue;
    }
    const derivedFactors = group.products.filter((m) => !m.isCanonical).map((m) => Number(m.conversionFactor));
    console.log(`  canónico: ${canonical.product.sku} ${canonical.product.name}`);
    console.log(`  factores de miembros derivados: [${derivedFactors.join(", ")}]`);
    console.log(`  campos globales del canónico: globalCost=${fmt(canonical.product.globalCost)} averageCost=${fmt(canonical.product.averageCost)} lastPurchaseCost=${fmt(canonical.product.lastPurchaseCost)}`);

    // Clasificación GLOBAL (todas las sucursales juntas): el costo real de un
    // producto como varilla de hierro no depende de la sucursal — el ancla
    // limpia de una sucursal sirve para detectar contaminación en otra.
    const allMovements = await prisma.inventoryMovement.findMany({
      where: { productId: canonical.productId },
      orderBy: { createdAt: "asc" },
      select: { id: true, branchId: true, createdAt: true, movementType: true, quantity: true, unitCost: true, inputUnit: true, conversionFactorSnapshot: true, referenceType: true, referenceId: true },
    });
    const globalClassification = new Map(classifyMovements(allMovements, derivedFactors).map((m) => [m.id, m]));

    for (const branch of branches) {
      const [branchSetting, balance] = await Promise.all([
        prisma.branchProductSetting.findUnique({
          where: { branchId_productId: { branchId: branch.id, productId: canonical.productId } },
          select: { branchCost: true, branchPrice: true },
        }),
        prisma.inventoryBalance.findUnique({
          where: { branchId_productId: { branchId: branch.id, productId: canonical.productId } },
          select: { quantityOnHand: true, weightedAverageCost: true },
        }),
      ]);
      const movements = allMovements.filter((m) => m.branchId === branch.id);

      if (!balance && movements.length === 0) continue; // sin presencia real en esta sucursal

      console.log(`\n  --- ${branch.code} ---`);
      console.log(`  branchCost=${fmt(branchSetting?.branchCost ?? null)} branchPrice=${fmt(branchSetting?.branchPrice ?? null)}`);
      console.log(`  InventoryBalance actual: qty=${balance?.quantityOnHand.toString() ?? "—"} wac=${fmt(balance?.weightedAverageCost ?? null)}`);

      if (movements.length === 0) {
        console.log("  InventoryMovement: NINGUNO — sin rastro para reconstruir. SIN BASE DEFENDIBLE (requiere costo real externo o valor provisto a mano).");
        continue;
      }

      const classified = movements.map((m) => globalClassification.get(m.id)!);
      console.log(`  InventoryMovement (${movements.length} filas):`);
      for (const m of classified) {
        const tag = !m.isInbound ? "OUT/preserva WAC" : m.status === "CONTAMINATED" ? `CONTAMINADA ×${m.matchedFactor} → corregido ${fmt(m.correctedUnitCost)} (ancla ${m.anchorMovementId})` : "limpia";
        console.log(`    ${m.createdAt.toISOString()} · ${m.movementType} qty=${m.quantity.toString()} unitCost=${fmt(m.unitCost)} inputUnit=${m.inputUnit ?? "—"} factorSnap=${m.conversionFactorSnapshot?.toString() ?? "—"} ref=${m.referenceType} [${tag}]`);
      }

      let recon: ReturnType<typeof reconstructWac>;
      try {
        recon = reconstructWac(classified);
      } catch (e) {
        console.log(`  Reconstrucción: FALLÓ (${e instanceof Error ? e.message : e}) — el replay lineal no reconcilia con la cantidad real (probable composición paquete/suelto no capturada por este script). SIN BASE DEFENDIBLE por esta vía.`);
        continue;
      }
      console.log(`  Reconstrucción: qty=${recon.reconstructedQty.toString()} (debe igualar la actual: ${balance?.quantityOnHand.toString() ?? "—"})`);
      console.log(`  WAC actual (contaminado) = ${fmt(balance?.weightedAverageCost ?? null)}`);
      console.log(`  WAC reconstruido         = ${recon.hasDefensibleBasis ? fmt(recon.reconstructedWac) : "SIN BASE DEFENDIBLE (ningún inbound limpio como ancla)"}`);

      if (!recon.hasDefensibleBasis) {
        console.log("  → NO SE PROPONE CORRECCIÓN (prohibido inventar el costo). Requiere costo real externo o valor provisto a mano.");
        continue;
      }
      if (recon.correctedIds.length === 0) {
        console.log("  → El WAC actual ya coincide con la reconstrucción limpia; nada que corregir aquí.");
        continue;
      }

      console.log(`  → PROPUESTA: WAC ${fmt(balance!.weightedAverageCost)} → ${fmt(recon.reconstructedWac)} (basado en ${recon.cleanBasisIds.length} fila(s) limpia(s), corrigiendo ${recon.correctedIds.length} fila(s) contaminada(s))`);

      if (write) {
        await prisma.$transaction(async (tx) => {
          await tx.$queryRaw`SELECT id FROM "InventoryBalance" WHERE "branchId" = ${branch.id} AND "productId" = ${canonical.productId} FOR UPDATE`;
          const current = await tx.inventoryBalance.findUniqueOrThrow({
            where: { branchId_productId: { branchId: branch.id, productId: canonical.productId } },
          });
          const newInventoryValue = current.quantityOnHand.mul(recon.reconstructedWac);
          await tx.inventoryBalance.update({
            where: { branchId_productId: { branchId: branch.id, productId: canonical.productId } },
            data: { weightedAverageCost: recon.reconstructedWac, inventoryValue: newInventoryValue },
          });
          await tx.auditLog.create({
            data: {
              actorUserId: null,
              branchId: branch.id,
              module: "catalog",
              action: "FUSION_COST_BASIS_CORRECTED",
              entityType: "InventoryBalance",
              entityId: canonical.productId,
              metadataJson: {
                source: "script:fix-fusion-canonical-cost",
                stockGroupCode: group.code,
                canonicalProductId: canonical.productId,
                canonicalSku: canonical.product.sku,
                previousWac: current.weightedAverageCost.toString(),
                newWac: recon.reconstructedWac.toString(),
                quantityOnHand: current.quantityOnHand.toString(),
                previousInventoryValue: current.inventoryValue.toString(),
                newInventoryValue: newInventoryValue.toString(),
                justification:
                  "WAC reconstruido re-jugando los movimientos INBOUND del canonico con recalculateWeightedAverage; " +
                  "filas contaminadas (costo de quintal tecleado como costo de unidad base en carga inicial/ajuste manual) " +
                  "corregidas dividiendo por el factor de fusion real del grupo, ancladas contra al menos una fila limpia.",
                cleanBasisMovementIds: recon.cleanBasisIds,
                correctedMovementIds: recon.correctedIds,
              },
            },
          });
        });
        console.log("  ✓ Escrito y auditado.");
      }
    }
  }

  console.log(write ? "\n=== Escritura completada ===" : "\n=== Fin del dry-run — nada se escribió. Reejecutar con --write para aplicar. ===");
}

main()
  .catch((e) => {
    console.error(e);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
