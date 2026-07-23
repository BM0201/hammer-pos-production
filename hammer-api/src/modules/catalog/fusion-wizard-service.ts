import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { logAuditEvent } from "@/modules/audit/service";
import {
  createStockGroupRowsTx,
  type CreateStockGroupInput,
} from "@/modules/catalog/stock-group-crud";
import {
  recommendResolution,
  resolveNewCanonicalBaseQty,
  derivedBaseWac,
  type MigrationResolution,
} from "@/modules/catalog/equivalent-stock-migration";

/**
 * Fusión de Inventario v2, Fase 2.1 — el asistente de creación de 3 pasos.
 *
 * Colapsa "crear grupo" + "consolidación aditiva" + "migración de
 * equivalencia" en UN flujo: el paso 3 (preview, obligatorio, nunca
 * omitible) reutiliza exactamente la misma matemática de decisión que
 * equivalent-stock-migration.ts (recommendResolution / resolveNewCanonicalBaseQty /
 * derivedBaseWac) — pero operando sobre productos que TODAVÍA no están
 * agrupados (no hay stockGroupId hasta que el usuario confirma en el paso 3).
 */

export type WizardMember = {
  productId: string;
  conversionFactor: number;
  isCanonical: boolean;
  isPackagePresentation: boolean;
};

export type WizardBranchPreview = {
  branchId: string;
  branchCode: string;
  canonicalQty: number;
  derivedAsBaseQty: number;
  resultIfUseDerivedOnly: number;
  resultIfUseCanonicalOnly: number;
  resultIfSumBoth: number;
  hasConflict: boolean;
  recommendedResolution: MigrationResolution;
  warning: string | null;
};

export type FusionCreationPreview = {
  hasAnyConflict: boolean;
  branches: WizardBranchPreview[];
};

/**
 * Paso 3: preview del stock actual de cada miembro por sucursal, SIN
 * escribir nada. Si un producto está en dos fusiones a la vez esto no puede
 * pasar (assertProductsAvailable ya lo bloquea al crear), así que aquí solo
 * leemos los balances tal cual están hoy — que es exactamente lo que el
 * usuario ve parado frente al estante.
 */
export async function previewFusionCreationTx(
  tx: Prisma.TransactionClient,
  input: { members: WizardMember[] },
): Promise<FusionCreationPreview> {
  const canonical = input.members.find((m) => m.isCanonical);
  if (!canonical) {
    throw new Error("VALIDATION_ERROR: Debe haber un producto principal (unidad suelta / base).");
  }
  const derivedMembers = input.members.filter((m) => !m.isCanonical);
  const allProductIds = input.members.map((m) => m.productId);

  const branches = await tx.branch.findMany({
    where: { isActive: true },
    select: { id: true, code: true },
    orderBy: { code: "asc" },
  });

  const branchPreviews: WizardBranchPreview[] = [];

  for (const branch of branches) {
    const balances = await tx.inventoryBalance.findMany({
      where: { branchId: branch.id, productId: { in: allProductIds } },
      select: { productId: true, quantityOnHand: true },
    });
    const byProduct = new Map(balances.map((b) => [b.productId, Number(b.quantityOnHand)]));

    const canonicalQty = byProduct.get(canonical.productId) ?? 0;
    let derivedAsBaseQty = 0;
    for (const d of derivedMembers) {
      derivedAsBaseQty += (byProduct.get(d.productId) ?? 0) * d.conversionFactor;
    }

    const rec = recommendResolution({ canonicalQty, derivedAsBaseQty });

    branchPreviews.push({
      branchId: branch.id,
      branchCode: branch.code,
      canonicalQty,
      derivedAsBaseQty,
      resultIfUseDerivedOnly: derivedAsBaseQty,
      resultIfUseCanonicalOnly: canonicalQty,
      resultIfSumBoth: canonicalQty + derivedAsBaseQty,
      hasConflict: rec.hasConflict,
      recommendedResolution: rec.recommendedResolution,
      warning: rec.warning,
    });
  }

  return { hasAnyConflict: branchPreviews.some((b) => b.hasConflict), branches: branchPreviews };
}

export function previewFusionCreation(input: { members: WizardMember[] }) {
  return prisma.$transaction((tx) => previewFusionCreationTx(tx, input));
}

export type FusionBranchResolutionInput = {
  resolution: MigrationResolution | "RECOMMENDED";
  /** Para MANUAL_BASE_QTY en grupos SIN empaque cerrado/suelto. */
  manualBaseQty?: number;
  /** Para MANUAL_BASE_QTY en grupos CON empaque: conteo físico dual (cajas + sueltas). */
  manualClosedQty?: number;
  manualLooseQty?: number;
};

export type CreateFusionGroupInput = CreateStockGroupInput & {
  actorUserId: string;
  /** branchId → resolución elegida por el usuario en el paso 3. Sucursales omitidas usan RECOMMENDED. */
  branchResolutions?: Record<string, FusionBranchResolutionInput>;
};

export type FusionCreationBranchResult = {
  branchId: string;
  branchCode: string;
  resolution: MigrationResolution;
  newCanonicalQty: string;
  newCanonicalClosed: string;
  newCanonicalLoose: string;
  newCanonicalWac: string;
  zeroedProductIds: string[];
  warning: string | null;
};

/**
 * Crea el grupo + miembros y, en la MISMA transacción, resuelve la
 * composición inicial por sucursal según la resolución elegida en el paso 3
 * (o RECOMMENDED si la sucursal no tenía conflicto). Nunca suma a ciegas:
 * si una sucursal tiene conflicto y no llegó resolución, falla — el asistente
 * exige que el paso 3 se haya visto y confirmado.
 */
export async function createFusionGroupTx(
  tx: Prisma.TransactionClient,
  input: CreateFusionGroupInput,
): Promise<{ groupId: string; groupCode: string; branches: FusionCreationBranchResult[] }> {
  const { group: createdGroup, canonical } = await createStockGroupRowsTx(tx, input);
  const tracksPackages = Boolean(input.tracksPackages);
  const derivedMembers = input.members.filter((m) => !m.isCanonical);
  const derivedIds = derivedMembers.map((m) => m.productId);
  const allProductIds = input.members.map((m) => m.productId);
  // El asistente solo crea grupos de 2 productos (1 base + 1 empaque); para
  // grupos con más miembros derivados, el reparto cerrado/suelto usa el
  // primer miembro derivado como "la presentación empacada".
  const packageMember = derivedMembers[0] ?? null;

  const branches = await tx.branch.findMany({
    where: { isActive: true },
    select: { id: true, code: true },
    orderBy: { code: "asc" },
  });

  const results: FusionCreationBranchResult[] = [];

  for (const branch of branches) {
    for (const productId of allProductIds) {
      await tx.$queryRaw`
        SELECT id FROM "InventoryBalance"
        WHERE "branchId" = ${branch.id}
          AND "productId" = ${productId}
        FOR UPDATE
      `;
    }

    const balances = await tx.inventoryBalance.findMany({
      where: { branchId: branch.id, productId: { in: allProductIds } },
    });
    const byProduct = new Map(balances.map((b) => [b.productId, b]));
    const canonicalBalance = byProduct.get(canonical.productId) ?? null;
    const canonicalQty = canonicalBalance?.quantityOnHand ?? new Prisma.Decimal(0);
    const canonicalWac = canonicalBalance?.weightedAverageCost ?? new Prisma.Decimal(0);

    const derivedWithBalance = derivedMembers.map((d) => {
      const b = byProduct.get(d.productId);
      return {
        qoh: b?.quantityOnHand ?? new Prisma.Decimal(0),
        factor: new Prisma.Decimal(d.conversionFactor),
        wac: b?.weightedAverageCost ?? new Prisma.Decimal(0),
      };
    });
    const derived = derivedBaseWac(derivedWithBalance);

    const rec = recommendResolution({ canonicalQty: Number(canonicalQty), derivedAsBaseQty: Number(derived.baseQty) });
    const branchInput = input.branchResolutions?.[branch.id];

    let resolution: MigrationResolution;
    if (!branchInput || branchInput.resolution === "RECOMMENDED") {
      if (rec.hasConflict) {
        throw new Error(
          `CONFLICT_REQUIRES_RESOLUTION: La sucursal ${branch.code} tiene stock en varias presentaciones. Elegí una opción en el paso 3 antes de crear.`,
        );
      }
      resolution = rec.recommendedResolution;
    } else {
      resolution = branchInput.resolution;
    }

    let newClosed = new Prisma.Decimal(0);
    let newLoose = new Prisma.Decimal(0);
    let newQty: Prisma.Decimal;
    let newWac: Prisma.Decimal;

    if (tracksPackages) {
      const packageBalance = packageMember ? byProduct.get(packageMember.productId) : undefined;
      const packageQty = packageBalance?.quantityOnHand ?? new Prisma.Decimal(0);
      const packageFactor = packageMember ? new Prisma.Decimal(packageMember.conversionFactor) : new Prisma.Decimal(1);

      switch (resolution) {
        case "USE_DERIVED_ONLY":
          newClosed = packageQty;
          newLoose = new Prisma.Decimal(0);
          newWac = derived.baseWac;
          break;
        case "USE_CANONICAL_ONLY":
          newClosed = new Prisma.Decimal(0);
          newLoose = canonicalQty;
          newWac = canonicalWac;
          break;
        case "SUM_BOTH": {
          newClosed = packageQty;
          newLoose = canonicalQty;
          const total = canonicalQty.add(derived.baseQty);
          newWac = total.gt(0)
            ? canonicalQty.mul(canonicalWac).add(derived.baseQty.mul(derived.baseWac)).div(total)
            : new Prisma.Decimal(0);
          break;
        }
        case "MANUAL_BASE_QTY": {
          if (branchInput?.manualClosedQty === undefined || branchInput?.manualLooseQty === undefined) {
            throw new Error(
              `VALIDATION_ERROR: El conteo manual para la sucursal ${branch.code} requiere cajas cerradas y unidades sueltas.`,
            );
          }
          newClosed = new Prisma.Decimal(branchInput.manualClosedQty);
          newLoose = new Prisma.Decimal(branchInput.manualLooseQty);
          newWac = canonicalWac.gt(0) ? canonicalWac : derived.baseWac;
          break;
        }
        default:
          throw new Error(`VALIDATION_ERROR: Resolución desconocida: ${resolution as string}`);
      }
      newQty = newClosed.mul(packageFactor).add(newLoose);
    } else {
      const manualBaseQty =
        resolution === "MANUAL_BASE_QTY" ? new Prisma.Decimal(branchInput?.manualBaseQty ?? NaN) : null;
      if (resolution === "MANUAL_BASE_QTY" && (manualBaseQty === null || manualBaseQty.isNaN())) {
        throw new Error(`VALIDATION_ERROR: El conteo manual para la sucursal ${branch.code} requiere una cantidad.`);
      }
      newQty = resolveNewCanonicalBaseQty(resolution, { canonicalQty, derivedAsBaseQty: derived.baseQty, manualBaseQty });
      switch (resolution) {
        case "USE_DERIVED_ONLY":
          newWac = derived.baseWac;
          break;
        case "USE_CANONICAL_ONLY":
          newWac = canonicalWac;
          break;
        case "SUM_BOTH": {
          const total = canonicalQty.add(derived.baseQty);
          newWac = total.gt(0)
            ? canonicalQty.mul(canonicalWac).add(derived.baseQty.mul(derived.baseWac)).div(total)
            : new Prisma.Decimal(0);
          break;
        }
        case "MANUAL_BASE_QTY":
          newWac = canonicalWac.gt(0) ? canonicalWac : derived.baseWac;
          break;
        default:
          newWac = canonicalWac;
      }
    }

    await tx.inventoryBalance.upsert({
      where: { branchId_productId: { branchId: branch.id, productId: canonical.productId } },
      create: {
        branchId: branch.id,
        productId: canonical.productId,
        quantityOnHand: newQty,
        closedPackageQuantity: newClosed,
        looseUnitQuantity: newLoose,
        weightedAverageCost: newWac,
        inventoryValue: newQty.mul(newWac),
      },
      update: {
        quantityOnHand: newQty,
        closedPackageQuantity: newClosed,
        looseUnitQuantity: newLoose,
        weightedAverageCost: newWac,
        inventoryValue: newQty.mul(newWac),
      },
    });

    if (derivedIds.length > 0) {
      await tx.inventoryBalance.updateMany({
        where: { branchId: branch.id, productId: { in: derivedIds } },
        data: { quantityOnHand: 0, closedPackageQuantity: 0, looseUnitQuantity: 0, weightedAverageCost: 0, inventoryValue: 0 },
      });
    }

    await tx.auditLog.create({
      data: {
        actorUserId: input.actorUserId,
        branchId: branch.id,
        module: "inventory",
        action: "STOCK_GROUP_CREATED_WITH_RESOLUTION",
        entityType: "ProductStockGroup",
        entityId: createdGroup.id,
        metadataJson: {
          groupCode: createdGroup.code,
          resolution,
          previousCanonicalQty: canonicalQty.toString(),
          previousDerivedBaseQty: derived.baseQty.toString(),
          newCanonicalQty: newQty.toString(),
          newCanonicalClosed: newClosed.toString(),
          newCanonicalLoose: newLoose.toString(),
          newCanonicalWac: newWac.toString(),
          zeroedProductIds: derivedIds,
          warning: rec.hasConflict ? rec.warning : null,
        },
      },
    });

    results.push({
      branchId: branch.id,
      branchCode: branch.code,
      resolution,
      newCanonicalQty: newQty.toString(),
      newCanonicalClosed: newClosed.toString(),
      newCanonicalLoose: newLoose.toString(),
      newCanonicalWac: newWac.toString(),
      zeroedProductIds: derivedIds,
      warning: rec.hasConflict ? rec.warning : null,
    });
  }

  return { groupId: createdGroup.id, groupCode: createdGroup.code, branches: results };
}

export async function createFusionGroup(input: CreateFusionGroupInput) {
  const result = await prisma.$transaction((tx) => createFusionGroupTx(tx, input));
  await logAuditEvent({
    actorUserId: input.actorUserId,
    module: "catalog",
    action: "STOCK_GROUP_CREATED",
    entityType: "ProductStockGroup",
    entityId: result.groupId,
    metadataJson: { code: result.groupCode, name: input.name, members: input.members.length },
  });
  return result;
}
