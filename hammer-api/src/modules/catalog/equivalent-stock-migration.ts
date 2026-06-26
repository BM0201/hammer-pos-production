import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";

/**
 * Equivalence-stock migration ("reinterpretación" de inventario).
 *
 * A diferencia de la consolidación ADITIVA (`calcBaseConsolidation` /
 * `consolidateAdditiveStockGroupTx`), que SUMA el stock de todos los miembros,
 * esta migración REINTERPRETA el mismo inventario físico sin subir el volumen.
 *
 * Caso real (hierro):
 *   HIERRO 3/8 STD (derivado, QUINTAL, factor=14) = 8 quintales
 *   VARILLA 3/8 STD (canónico, factor=1)          = 0 varillas
 *   Resultado correcto: VARILLA = 112, QUINTAL = 0 físico.
 *   NUNCA: VARILLA = 112 + 8 quintales, ni 224 varillas.
 *
 * Cuando AMBAS presentaciones tienen stock (posible doble conteo), NO se aplica
 * automáticamente: se requiere una resolución explícita del usuario.
 */

export const MIGRATION_RESOLUTIONS = [
  "USE_DERIVED_ONLY",
  "USE_CANONICAL_ONLY",
  "SUM_BOTH",
  "MANUAL_BASE_QTY",
  "CANCEL",
] as const;

export type MigrationResolution = (typeof MIGRATION_RESOLUTIONS)[number];

/** "RECOMMENDED" = aplica, por sucursal, la resolución recomendada (solo si no hay conflicto). */
export type ApplyResolution = MigrationResolution | "RECOMMENDED";

export const CONFLICT_WARNING =
  "Ambas presentaciones tienen stock. Esto puede ser doble conteo. Seleccione la fuente real.";

// ─── Capa pura: decisión y cálculo (sin dependencia de DB) ───────────────────

/**
 * Decide la resolución recomendada y si hay conflicto, a partir de las
 * cantidades en unidad base.
 *
 *  - canónico = 0 y derivado > 0  → USE_DERIVED_ONLY  (ej. 8 quintales → 112 varillas)
 *  - canónico > 0 y derivado = 0  → USE_CANONICAL_ONLY
 *  - canónico > 0 y derivado > 0  → CONFLICTO (no aplicar automáticamente)
 *  - ambos = 0                    → sin conflicto, sin migración (USE_CANONICAL_ONLY)
 *
 * Exportada para tests — opera sobre números.
 */
export function recommendResolution(input: {
  canonicalQty: number;
  derivedAsBaseQty: number;
}): { recommendedResolution: MigrationResolution; hasConflict: boolean; warning: string | null } {
  const { canonicalQty, derivedAsBaseQty } = input;
  if (canonicalQty <= 0 && derivedAsBaseQty > 0) {
    return { recommendedResolution: "USE_DERIVED_ONLY", hasConflict: false, warning: null };
  }
  if (canonicalQty > 0 && derivedAsBaseQty <= 0) {
    return { recommendedResolution: "USE_CANONICAL_ONLY", hasConflict: false, warning: null };
  }
  if (canonicalQty > 0 && derivedAsBaseQty > 0) {
    // Posible doble conteo: nunca se decide solo. Se sugiere conteo manual.
    return { recommendedResolution: "MANUAL_BASE_QTY", hasConflict: true, warning: CONFLICT_WARNING };
  }
  return { recommendedResolution: "USE_CANONICAL_ONLY", hasConflict: false, warning: null };
}

/**
 * Calcula la cantidad final en unidad base del producto canónico según la
 * resolución elegida. Versión numérica pura (para tests).
 */
export function resolveNewCanonicalBaseQtyNumber(
  resolution: MigrationResolution,
  input: { canonicalQty: number; derivedAsBaseQty: number; manualBaseQty?: number | null },
): number {
  switch (resolution) {
    case "USE_DERIVED_ONLY":
      return input.derivedAsBaseQty;
    case "USE_CANONICAL_ONLY":
      return input.canonicalQty;
    case "SUM_BOTH":
      return input.canonicalQty + input.derivedAsBaseQty;
    case "MANUAL_BASE_QTY":
      if (input.manualBaseQty == null || !Number.isFinite(input.manualBaseQty) || input.manualBaseQty < 0) {
        throw new Error("VALIDATION_ERROR: MANUAL_BASE_QTY requiere una cantidad base válida (>= 0).");
      }
      return input.manualBaseQty;
    case "CANCEL":
      throw new Error("VALIDATION_ERROR: CANCEL no produce un nuevo stock; no aplique cambios.");
    default:
      throw new Error(`VALIDATION_ERROR: Resolución desconocida: ${resolution as string}`);
  }
}

/** Versión Decimal (producción) — misma lógica que resolveNewCanonicalBaseQtyNumber. */
export function resolveNewCanonicalBaseQty(
  resolution: MigrationResolution,
  input: { canonicalQty: Prisma.Decimal; derivedAsBaseQty: Prisma.Decimal; manualBaseQty?: Prisma.Decimal | null },
): Prisma.Decimal {
  switch (resolution) {
    case "USE_DERIVED_ONLY":
      return input.derivedAsBaseQty;
    case "USE_CANONICAL_ONLY":
      return input.canonicalQty;
    case "SUM_BOTH":
      return input.canonicalQty.add(input.derivedAsBaseQty);
    case "MANUAL_BASE_QTY":
      if (input.manualBaseQty == null || input.manualBaseQty.lt(0)) {
        throw new Error("VALIDATION_ERROR: MANUAL_BASE_QTY requiere una cantidad base válida (>= 0).");
      }
      return input.manualBaseQty;
    case "CANCEL":
      throw new Error("VALIDATION_ERROR: CANCEL no produce un nuevo stock; no aplique cambios.");
    default:
      throw new Error(`VALIDATION_ERROR: Resolución desconocida: ${resolution as string}`);
  }
}

// ─── Tipos del preview ────────────────────────────────────────────────────────

export type BranchMigrationPreview = {
  branchId: string;
  branchCode: string;
  canonicalProductId: string;
  derivedProductId: string | null;
  canonicalQty: number;
  derivedQty: number;
  factor: number;
  derivedAsBaseQty: number;
  resultIfUseDerivedOnly: number;
  resultIfUseCanonicalOnly: number;
  resultIfSumBoth: number;
  hasConflict: boolean;
  recommendedResolution: MigrationResolution;
  warning: string | null;
};

export type EquivalentMigrationPreview = {
  stockGroupId: string;
  stockGroupCode: string;
  baseUnit: string;
  canonicalProductId: string;
  hasAnyConflict: boolean;
  branches: BranchMigrationPreview[];
};

type GroupForMigration = {
  id: string;
  code: string;
  baseUnit: string;
  canonical: { productId: string; saleUnit: string };
  derived: Array<{ productId: string; saleUnit: string; conversionFactor: Prisma.Decimal }>;
};

async function loadGroupForMigration(
  tx: Prisma.TransactionClient,
  stockGroupId: string,
): Promise<GroupForMigration> {
  const group = await tx.productStockGroup.findUnique({
    where: { id: stockGroupId, isActive: true },
    include: {
      products: {
        where: { isActive: true },
        select: { productId: true, isCanonical: true, conversionFactor: true, saleUnit: true },
        orderBy: [{ isCanonical: "desc" }, { conversionFactor: "asc" }],
      },
    },
  });
  if (!group) throw new Error(`NOT_FOUND: Fusión ${stockGroupId} no encontrada o inactiva.`);
  if (group.tracksPackages) {
    throw new Error(
      "VALIDATION_ERROR: La migración de equivalencia no aplica a grupos de empaque cerrado/suelto (tracksPackages).",
    );
  }
  const canonical = group.products.find((m) => m.isCanonical);
  if (!canonical) {
    throw new Error(`VALIDATION_ERROR: La fusión ${group.code} no tiene producto principal (canónico) activo.`);
  }
  const derived = group.products
    .filter((m) => !m.isCanonical)
    .map((m) => ({ productId: m.productId, saleUnit: m.saleUnit, conversionFactor: new Prisma.Decimal(m.conversionFactor) }));
  return {
    id: group.id,
    code: group.code,
    baseUnit: group.baseUnit,
    canonical: { productId: canonical.productId, saleUnit: canonical.saleUnit },
    derived,
  };
}

// ─── Preview seguro (no muta nada) ────────────────────────────────────────────

/**
 * Devuelve, por sucursal, cómo quedaría el inventario bajo cada resolución, junto
 * con la resolución recomendada y la detección de conflicto. No escribe nada.
 */
export async function previewEquivalentStockGroupMigrationTx(
  tx: Prisma.TransactionClient,
  input: { stockGroupId: string },
): Promise<EquivalentMigrationPreview> {
  const group = await loadGroupForMigration(tx, input.stockGroupId);
  const allProductIds = [group.canonical.productId, ...group.derived.map((d) => d.productId)];
  // Derivado "primario" para mostrar (el de mayor factor; en hierro hay uno solo).
  const primaryDerived = group.derived.reduce<typeof group.derived[number] | null>(
    (acc, d) => (acc === null || d.conversionFactor.gt(acc.conversionFactor) ? d : acc),
    null,
  );

  const branches = await tx.branch.findMany({
    where: { isActive: true },
    select: { id: true, code: true },
    orderBy: { code: "asc" },
  });

  const branchPreviews: BranchMigrationPreview[] = [];

  for (const branch of branches) {
    const balances = await tx.inventoryBalance.findMany({
      where: { branchId: branch.id, productId: { in: allProductIds } },
      select: { productId: true, quantityOnHand: true },
    });
    const byProduct = new Map(balances.map((b) => [b.productId, b.quantityOnHand]));

    const canonicalQty = new Prisma.Decimal(byProduct.get(group.canonical.productId) ?? 0);
    let derivedAsBaseQty = new Prisma.Decimal(0);
    for (const d of group.derived) {
      const qoh = new Prisma.Decimal(byProduct.get(d.productId) ?? 0);
      derivedAsBaseQty = derivedAsBaseQty.add(qoh.mul(d.conversionFactor));
    }
    const primaryQoh = primaryDerived
      ? new Prisma.Decimal(byProduct.get(primaryDerived.productId) ?? 0)
      : new Prisma.Decimal(0);
    const factor = primaryDerived ? primaryDerived.conversionFactor : new Prisma.Decimal(1);

    const rec = recommendResolution({
      canonicalQty: Number(canonicalQty),
      derivedAsBaseQty: Number(derivedAsBaseQty),
    });

    branchPreviews.push({
      branchId: branch.id,
      branchCode: branch.code,
      canonicalProductId: group.canonical.productId,
      derivedProductId: primaryDerived?.productId ?? null,
      canonicalQty: Number(canonicalQty),
      derivedQty: Number(primaryQoh),
      factor: Number(factor),
      derivedAsBaseQty: Number(derivedAsBaseQty),
      resultIfUseDerivedOnly: Number(derivedAsBaseQty),
      resultIfUseCanonicalOnly: Number(canonicalQty),
      resultIfSumBoth: Number(canonicalQty.add(derivedAsBaseQty)),
      hasConflict: rec.hasConflict,
      recommendedResolution: rec.recommendedResolution,
      warning: rec.warning,
    });
  }

  return {
    stockGroupId: group.id,
    stockGroupCode: group.code,
    baseUnit: group.baseUnit,
    canonicalProductId: group.canonical.productId,
    hasAnyConflict: branchPreviews.some((b) => b.hasConflict),
    branches: branchPreviews,
  };
}

// ─── WAC helpers ──────────────────────────────────────────────────────────────

/** Promedio ponderado por unidad base del lado derivado (cada miembro convertido a base). */
function derivedBaseWac(
  members: Array<{ qoh: Prisma.Decimal; factor: Prisma.Decimal; wac: Prisma.Decimal }>,
): { baseQty: Prisma.Decimal; baseWac: Prisma.Decimal } {
  let baseQty = new Prisma.Decimal(0);
  let numerator = new Prisma.Decimal(0);
  for (const m of members) {
    if (m.qoh.lte(0)) continue;
    const memberBaseQty = m.qoh.mul(m.factor);
    const wacPerBase = m.wac.gt(0) ? m.wac.div(m.factor) : new Prisma.Decimal(0);
    baseQty = baseQty.add(memberBaseQty);
    numerator = numerator.add(memberBaseQty.mul(wacPerBase));
  }
  const baseWac = baseQty.gt(0) ? numerator.div(baseQty) : new Prisma.Decimal(0);
  return { baseQty, baseWac };
}

// ─── Aplicación segura de la migración ────────────────────────────────────────

export type ApplyEquivalentMigrationInput = {
  stockGroupId: string;
  actorUserId: string;
  conflictResolution: ApplyResolution;
  /** Cantidad base real por sucursal (solo para MANUAL_BASE_QTY). branchId → baseQty. */
  manualBaseQtyByBranch?: Record<string, number>;
  reason?: string;
};

export type ApplyEquivalentMigrationBranchResult = {
  branchId: string;
  branchCode: string;
  resolution: MigrationResolution;
  previousCanonicalQty: string;
  previousDerivedBaseQty: string;
  newCanonicalBaseQty: string;
  newCanonicalWac: string;
  zeroedProductIds: string[];
  warning: string | null;
};

/**
 * Reinterpreta el inventario del grupo de equivalencia y lo escribe SOLO en el
 * producto canónico, dejando los derivados en cero físico. Idempotente cuando los
 * derivados ya están en cero (USE_DERIVED_ONLY/CANONICAL_ONLY producen el mismo
 * resultado). Debe ejecutarse dentro de una transacción.
 *
 * Seguridad ante doble conteo:
 *   - conflictResolution = "RECOMMENDED" aplica, por sucursal, la resolución
 *     recomendada y FALLA si alguna sucursal tiene conflicto.
 *   - SUM_BOTH solo se usa si el usuario lo elige explícitamente.
 */
export async function applyEquivalentStockGroupMigrationTx(
  tx: Prisma.TransactionClient,
  input: ApplyEquivalentMigrationInput,
): Promise<ApplyEquivalentMigrationBranchResult[]> {
  if (input.conflictResolution === "CANCEL") {
    throw new Error("VALIDATION_ERROR: CANCEL no aplica cambios.");
  }
  const group = await loadGroupForMigration(tx, input.stockGroupId);
  const allProductIds = [group.canonical.productId, ...group.derived.map((d) => d.productId)];
  const derivedIds = group.derived.map((d) => d.productId);

  const branches = await tx.branch.findMany({
    where: { isActive: true },
    select: { id: true, code: true },
    orderBy: { code: "asc" },
  });

  const results: ApplyEquivalentMigrationBranchResult[] = [];

  for (const branch of branches) {
    // Bloqueo FOR UPDATE de todos los balances del grupo (evita carreras con ventas/ajustes).
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
    const canonicalBalance = byProduct.get(group.canonical.productId) ?? null;

    const canonicalQty = canonicalBalance?.quantityOnHand ?? new Prisma.Decimal(0);
    const canonicalWac = canonicalBalance?.weightedAverageCost ?? new Prisma.Decimal(0);

    const derivedMembersWithBalance = group.derived.map((d) => {
      const b = byProduct.get(d.productId);
      return {
        qoh: b?.quantityOnHand ?? new Prisma.Decimal(0),
        factor: d.conversionFactor,
        wac: b?.weightedAverageCost ?? new Prisma.Decimal(0),
      };
    });
    const derived = derivedBaseWac(derivedMembersWithBalance);
    const derivedAsBaseQty = derived.baseQty;

    const rec = recommendResolution({
      canonicalQty: Number(canonicalQty),
      derivedAsBaseQty: Number(derivedAsBaseQty),
    });

    let resolution: MigrationResolution;
    if (input.conflictResolution === "RECOMMENDED") {
      if (rec.hasConflict) {
        throw new Error(
          `CONFLICT_REQUIRES_RESOLUTION: La sucursal ${branch.code} tiene stock en ambas presentaciones. ` +
            "Seleccione una fuente real para evitar doble conteo.",
        );
      }
      resolution = rec.recommendedResolution;
    } else {
      resolution = input.conflictResolution;
    }

    const manualBaseQty =
      resolution === "MANUAL_BASE_QTY"
        ? new Prisma.Decimal(input.manualBaseQtyByBranch?.[branch.id] ?? NaN)
        : null;
    if (resolution === "MANUAL_BASE_QTY" && (manualBaseQty === null || manualBaseQty.isNaN())) {
      throw new Error(
        `VALIDATION_ERROR: MANUAL_BASE_QTY requiere cantidad base para la sucursal ${branch.code}.`,
      );
    }

    const newCanonicalBaseQty = resolveNewCanonicalBaseQty(resolution, {
      canonicalQty,
      derivedAsBaseQty,
      manualBaseQty,
    });

    // WAC del resultado según la fuente elegida.
    let newWac: Prisma.Decimal;
    switch (resolution) {
      case "USE_DERIVED_ONLY":
        newWac = derived.baseWac;
        break;
      case "USE_CANONICAL_ONLY":
        newWac = canonicalWac;
        break;
      case "SUM_BOTH": {
        const total = canonicalQty.add(derivedAsBaseQty);
        newWac = total.gt(0)
          ? canonicalQty.mul(canonicalWac).add(derivedAsBaseQty.mul(derived.baseWac)).div(total)
          : new Prisma.Decimal(0);
        break;
      }
      case "MANUAL_BASE_QTY":
        // Conserva el costo del lado que tenía stock; prioriza el canónico si existía.
        newWac = canonicalWac.gt(0) ? canonicalWac : derived.baseWac;
        break;
      default:
        newWac = canonicalWac;
    }

    // Escribe SOLO el canónico.
    await tx.inventoryBalance.upsert({
      where: { branchId_productId: { branchId: branch.id, productId: group.canonical.productId } },
      create: {
        branchId: branch.id,
        productId: group.canonical.productId,
        quantityOnHand: newCanonicalBaseQty,
        closedPackageQuantity: 0,
        looseUnitQuantity: 0,
        weightedAverageCost: newWac,
        inventoryValue: newCanonicalBaseQty.mul(newWac),
      },
      update: {
        quantityOnHand: newCanonicalBaseQty,
        closedPackageQuantity: 0,
        looseUnitQuantity: 0,
        weightedAverageCost: newWac,
        inventoryValue: newCanonicalBaseQty.mul(newWac),
      },
    });

    // Deja todos los derivados en cero físico.
    if (derivedIds.length > 0) {
      await tx.inventoryBalance.updateMany({
        where: { branchId: branch.id, productId: { in: derivedIds } },
        data: {
          quantityOnHand: 0,
          closedPackageQuantity: 0,
          looseUnitQuantity: 0,
          weightedAverageCost: 0,
          inventoryValue: 0,
        },
      });
    }

    await tx.auditLog.create({
      data: {
        actorUserId: input.actorUserId,
        branchId: branch.id,
        module: "inventory",
        action: "STOCK_GROUP_EQUIVALENCE_MIGRATED",
        entityType: "ProductStockGroup",
        entityId: group.id,
        metadataJson: {
          reason: input.reason ?? "applyEquivalentStockGroupMigration",
          groupCode: group.code,
          resolution,
          factor: Number(group.derived[0]?.conversionFactor ?? 1),
          previousCanonicalQty: canonicalQty.toString(),
          previousDerivedBaseQty: derivedAsBaseQty.toString(),
          newCanonicalBaseQty: newCanonicalBaseQty.toString(),
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
      previousCanonicalQty: canonicalQty.toString(),
      previousDerivedBaseQty: derivedAsBaseQty.toString(),
      newCanonicalBaseQty: newCanonicalBaseQty.toString(),
      newCanonicalWac: newWac.toString(),
      zeroedProductIds: derivedIds,
      warning: rec.hasConflict ? rec.warning : null,
    });
  }

  return results;
}

/**
 * Alias semántico (tarea B): "reinterpretar" un grupo de equivalencia
 * (hierro/quintal/varilla) sin sumar automáticamente.
 */
export const reinterpretEquivalentStockGroupTx = applyEquivalentStockGroupMigrationTx;

// ─── Envoltorios con transacción propia (para rutas API) ──────────────────────

export function previewEquivalentStockGroupMigration(stockGroupId: string) {
  return prisma.$transaction((tx) => previewEquivalentStockGroupMigrationTx(tx, { stockGroupId }));
}

export function applyEquivalentStockGroupMigration(input: ApplyEquivalentMigrationInput) {
  return prisma.$transaction((tx) => applyEquivalentStockGroupMigrationTx(tx, input));
}
