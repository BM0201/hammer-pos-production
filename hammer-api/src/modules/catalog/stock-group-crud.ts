import { Prisma } from "@prisma/client";
import { createHash } from "crypto";
import { prisma } from "@/lib/prisma";
import { logAuditEvent } from "@/modules/audit/service";
import { checkStockGroupHealth } from "@/modules/catalog/stock-group-health";
import { canonicalizePresentationUnit, findUnitCollisions } from "@/modules/catalog/presentation-units";
import { resolveCostChain, resolveFusionMemberCost } from "@/modules/catalog/effective-pricing";

export type StockGroupMemberInput = {
  productId: string;
  saleUnit: string;
  conversionFactor: number;
  isCanonical: boolean;
  isPackagePresentation?: boolean;
};

export type CreateStockGroupInput = {
  name: string;
  code?: string;
  baseUnit?: string;
  packageUnit?: string | null;
  conversionFactorToBase?: number | null;
  tracksPackages?: boolean;
  approximateFactor?: boolean;
  minimumClosedPackageReserve?: number | null;
  autoOpenForUnitSale?: boolean;
  categoryId?: string | null;
  members: StockGroupMemberInput[];
};

export type UpdateStockGroupInput = {
  name?: string;
  isActive?: boolean;
  packageUnit?: string | null;
  conversionFactorToBase?: number | null;
  tracksPackages?: boolean;
  approximateFactor?: boolean;
  minimumClosedPackageReserve?: number | null;
  autoOpenForUnitSale?: boolean;
  members?: StockGroupMemberInput[];
};

export type RebuildMode = "CREATE" | "UPDATE" | "NORMALIZE_NAILS" | "BOOTSTRAP_IRON" | "REPAIR";

type RebuildStockGroupBalancesInput = {
  stockGroupId: string;
  actorUserId: string;
  reason: string;
  mode: RebuildMode;
};

type BranchRebuildResult = {
  branchId: string;
  branchCode: string;
  newCanonicalQty: string;
  newCanonicalClosed: string;
  newCanonicalLoose: string;
  newCanonicalWac: string;
  zeroedProductIds: string[];
  warnings: string[];
};

// ─── Pure calculation helpers (exported for unit tests) ──────────────────────

type BalanceSnapshot = {
  quantityOnHand: Prisma.Decimal;
  closedPackageQuantity: Prisma.Decimal;
  looseUnitQuantity: Prisma.Decimal;
  weightedAverageCost: Prisma.Decimal;
};

/**
 * Consolidates all member balances (tracksPackages=false) into a single base total.
 * Each member's quantityOnHand is multiplied by its conversionFactor to convert to base units.
 * WAC is recalculated as a weighted average per base unit.
 *
 * Exported for unit tests — no DB dependency.
 */
export function calcBaseConsolidation(
  members: Array<{ conversionFactor: Prisma.Decimal; balance: BalanceSnapshot | null }>,
): { totalBaseQty: Prisma.Decimal; newWac: Prisma.Decimal } {
  let totalBaseQty = new Prisma.Decimal(0);
  let wacNumerator = new Prisma.Decimal(0);
  for (const m of members) {
    if (!m.balance || m.balance.quantityOnHand.lte(0)) continue;
    const factor = new Prisma.Decimal(m.conversionFactor);
    const baseQty = m.balance.quantityOnHand.mul(factor);
    const wacPerBase = m.balance.weightedAverageCost.gt(0)
      ? m.balance.weightedAverageCost.div(factor)
      : new Prisma.Decimal(0);
    totalBaseQty = totalBaseQty.add(baseQty);
    wacNumerator = wacNumerator.add(baseQty.mul(wacPerBase));
  }
  const newWac = totalBaseQty.gt(0) ? wacNumerator.div(totalBaseQty) : new Prisma.Decimal(0);
  return { totalBaseQty, newWac };
}

/**
 * Consolidates balances for a tracksPackages=true group into structured closed/loose fields.
 *
 * Sources of truth (in priority order):
 *   closedPackageQuantity: from packageBalance.closedPkg > 0, else packageBalance.qoh;
 *     PLUS any already-consolidated closedPkg from canonical (idempotency).
 *   looseUnitQuantity: from canonical.looseUnitQuantity, else canonical.qoh (repair path for
 *     old unstructured data when there is no package-side stock at all).
 *
 * `looseAlternateMembers` — Fusión triple (Caja/Kilo + Unidad + Libra): miembros
 * no-canónicos que NO son el empaque (ej. Libra, cuando Caja es el empaque).
 * En el flujo normal nunca deberían acumular saldo propio — venta/compra/ajuste
 * ya resuelven todo contra el canónico (unit-conversion.ts) — pero si alguien
 * recibió/ajustó por error directamente contra uno de ellos, ese saldo se
 * convierte a unidades base con su propio conversionFactor y se suma al lado
 * suelto en vez de perderse en silencio al zonarlos más abajo.
 *
 * Exported for unit tests — no DB dependency.
 */
export function calcTracksPackagesConsolidation(input: {
  packageBalance: BalanceSnapshot | null | undefined;
  canonicalBalance: BalanceSnapshot | null | undefined;
  factor: Prisma.Decimal;
  looseAlternateMembers?: Array<{ conversionFactor: Prisma.Decimal; balance: BalanceSnapshot | null | undefined }>;
}): {
  finalClosed: Prisma.Decimal;
  finalLoose: Prisma.Decimal;
  totalBaseQty: Prisma.Decimal;
  newWac: Prisma.Decimal;
  warnings: string[];
} {
  const { packageBalance, canonicalBalance, factor, looseAlternateMembers = [] } = input;
  const warnings: string[] = [];

  // Closed packages from the package-presentation member (pre-consolidation source)
  const closedFromPackage: Prisma.Decimal = packageBalance
    ? packageBalance.closedPackageQuantity.gt(0)
      ? packageBalance.closedPackageQuantity
      : packageBalance.quantityOnHand
    : new Prisma.Decimal(0);

  // Already-consolidated closed packages on the canonical (idempotency)
  const closedFromCanonical: Prisma.Decimal =
    canonicalBalance?.closedPackageQuantity ?? new Prisma.Decimal(0);

  // Loose units from canonical.
  // Priority:
  //   1. canonical.looseUnitQuantity > 0 — structured, use directly.
  //   2. canonical.closedPackageQuantity == 0 AND canonical.quantityOnHand > 0 —
  //      unstructured historical data; treat qoh as loose units. This covers both
  //      the first consolidation of a newly-created group (pre-fusion loose stock on
  //      the canonical product) and repair of old data that never had structured fields.
  //   3. Otherwise 0.
  let looseFromCanonical: Prisma.Decimal;
  if ((canonicalBalance?.looseUnitQuantity ?? new Prisma.Decimal(0)).gt(0)) {
    looseFromCanonical = canonicalBalance!.looseUnitQuantity;
  } else if (
    (canonicalBalance?.closedPackageQuantity ?? new Prisma.Decimal(0)).eq(0) &&
    (canonicalBalance?.quantityOnHand ?? new Prisma.Decimal(0)).gt(0)
  ) {
    looseFromCanonical = canonicalBalance!.quantityOnHand;
    // Emit a warning only for genuine repair cases (no package-side stock of any kind)
    if (closedFromPackage.eq(0) && closedFromCanonical.eq(0)) {
      warnings.push("repair: used canonicalBalance.quantityOnHand as looseUnitQuantity (old unstructured data)");
    }
  } else {
    looseFromCanonical = new Prisma.Decimal(0);
  }

  // Saldo suelto varado en presentaciones alternativas (Libra, Unidad, etc.)
  // — mismo cálculo escalar que calcBaseConsolidation, convertido a base con
  // el conversionFactor propio de cada miembro (dimensión-agnóstico: da igual
  // si es peso↔peso o peso↔conteo, es solo multiplicar).
  let strayAlternateBaseQty = new Prisma.Decimal(0);
  let strayAlternateWacNumerator = new Prisma.Decimal(0);
  for (const alt of looseAlternateMembers) {
    if (!alt.balance || alt.balance.quantityOnHand.lte(0)) continue;
    const altFactor = new Prisma.Decimal(alt.conversionFactor);
    const altBaseQty = alt.balance.quantityOnHand.mul(altFactor);
    const altWacPerBase = alt.balance.weightedAverageCost.gt(0)
      ? alt.balance.weightedAverageCost.div(altFactor)
      : new Prisma.Decimal(0);
    strayAlternateBaseQty = strayAlternateBaseQty.add(altBaseQty);
    strayAlternateWacNumerator = strayAlternateWacNumerator.add(altBaseQty.mul(altWacPerBase));
    warnings.push(`stray balance folded from loose-alternate member into canonical: +${altBaseQty.toString()} base units`);
  }

  const finalClosed = closedFromPackage.add(closedFromCanonical);
  const finalLoose = looseFromCanonical.add(strayAlternateBaseQty);
  const totalBaseQty = finalClosed.mul(factor).add(finalLoose);

  // WAC: weighted average of package-side cost, canonical-side cost, and any
  // stray loose-alternate cost, all in base units.
  let newWac = new Prisma.Decimal(0);
  if (totalBaseQty.gt(0)) {
    const pkgBaseQty = closedFromPackage.mul(factor);
    // packageBalance.weightedAverageCost is cost per PACKAGE unit (e.g., per KILO)
    const pkgWacPerBase =
      pkgBaseQty.gt(0) && packageBalance && packageBalance.weightedAverageCost.gt(0)
        ? packageBalance.weightedAverageCost.div(factor)
        : new Prisma.Decimal(0);

    const canonBaseQty = closedFromCanonical.mul(factor).add(looseFromCanonical);
    // canonicalBalance.weightedAverageCost is already per BASE unit (e.g., per UNIDAD)
    const canonWacPerBase = canonicalBalance?.weightedAverageCost ?? new Prisma.Decimal(0);

    const wacNumerator = pkgBaseQty.mul(pkgWacPerBase)
      .add(canonBaseQty.mul(canonWacPerBase))
      .add(strayAlternateWacNumerator);
    newWac = wacNumerator.div(totalBaseQty);
  }

  return { finalClosed, finalLoose, totalBaseQty, newWac, warnings };
}

// ─── Central balance rebuild (runs inside an existing transaction) ────────────

/**
 * Atomically consolidates all member balances into the canonical product, then zeros
 * all non-canonical products. Idempotent: safe to call multiple times on the same group.
 *
 * Must be called inside an existing Prisma transaction (tx).
 */
export async function rebuildStockGroupBalancesTx(
  tx: Prisma.TransactionClient,
  input: RebuildStockGroupBalancesInput,
): Promise<BranchRebuildResult[]> {
  const group = await tx.productStockGroup.findUnique({
    where: { id: input.stockGroupId, isActive: true },
    include: {
      products: {
        where: { isActive: true },
        select: {
          productId: true,
          conversionFactor: true,
          isCanonical: true,
          isPackagePresentation: true,
          saleUnit: true,
        },
        orderBy: [{ isCanonical: "desc" }, { conversionFactor: "asc" }],
      },
    },
  });
  if (!group) throw new Error(`NOT_FOUND: Fusión ${input.stockGroupId} no encontrada o inactiva.`);

  const canonicalMember = group.products.find((m) => m.isCanonical);
  if (!canonicalMember) {
    throw new Error(`VALIDATION_ERROR: La fusión ${group.code} no tiene producto principal (canónico) activo.`);
  }

  const nonCanonicalMembers = group.products.filter((m) => !m.isCanonical);
  const nonCanonicalIds = nonCanonicalMembers.map((m) => m.productId);
  const allProductIds = group.products.map((m) => m.productId);

  // Package member para tracksPackages=true — validatePackageSettings ya
  // garantiza (al crear/editar) que hay EXACTAMENTE uno marcado
  // isPackagePresentation. Sin fallback a "el primer no-canónico": con 3+
  // miembros (fusión triple) eso agarraría cualquier suelto alternativo
  // (Libra, Unidad) como si fuera la caja.
  const packageMember = group.tracksPackages
    ? group.products.find((m) => m.isPackagePresentation && !m.isCanonical) ?? null
    : null;

  // Fusión triple: los demás no-canónicos (ni empaque) son presentaciones
  // sueltas alternativas — su saldo (si por error tienen alguno) se pliega
  // al lado suelto del canónico en vez de perderse al zonarlos.
  const looseAlternateMembers = group.tracksPackages
    ? nonCanonicalMembers.filter((m) => m.productId !== packageMember?.productId)
    : [];

  const factor: Prisma.Decimal | null = group.tracksPackages
    ? new Prisma.Decimal(
        group.conversionFactorToBase ??
          packageMember?.conversionFactor ??
          1,
      )
    : null;

  const branches = await tx.branch.findMany({
    where: { isActive: true },
    select: { id: true, code: true },
    orderBy: { code: "asc" },
  });

  const results: BranchRebuildResult[] = [];

  for (const branch of branches) {
    // Lock all member balance rows atomically (prevent races with sales/adjustments)
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
    const balanceByProduct = new Map(balances.map((b) => [b.productId, b]));
    const canonicalBalance = balanceByProduct.get(canonicalMember.productId) ?? null;

    let newQty: Prisma.Decimal;
    let newClosed = new Prisma.Decimal(0);
    let newLoose = new Prisma.Decimal(0);
    let newWac: Prisma.Decimal;
    let branchWarnings: string[] = [];
    const previousBalances: Record<string, { qoh: string; closed: string; loose: string; wac: string }> = {};

    for (const m of group.products) {
      const b = balanceByProduct.get(m.productId);
      if (b) {
        previousBalances[m.productId] = {
          qoh: b.quantityOnHand.toString(),
          closed: b.closedPackageQuantity.toString(),
          loose: b.looseUnitQuantity.toString(),
          wac: b.weightedAverageCost.toString(),
        };
      }
    }

    if (!group.tracksPackages) {
      // Standard group: aggregate all members to base units
      const memberInputs = group.products.map((m) => ({
        conversionFactor: new Prisma.Decimal(m.conversionFactor),
        balance: balanceByProduct.get(m.productId) ?? null,
      }));
      const calc = calcBaseConsolidation(memberInputs);
      newQty = calc.totalBaseQty;
      newWac = calc.newWac;
    } else {
      // Package group: structured closed/loose consolidation
      const packageBalance = packageMember
        ? balanceByProduct.get(packageMember.productId) ?? null
        : null;
      const calc = calcTracksPackagesConsolidation({
        packageBalance,
        canonicalBalance,
        factor: factor!,
        looseAlternateMembers: looseAlternateMembers.map((m) => ({
          conversionFactor: new Prisma.Decimal(m.conversionFactor),
          balance: balanceByProduct.get(m.productId) ?? null,
        })),
      });
      newQty = calc.totalBaseQty;
      newClosed = calc.finalClosed;
      newLoose = calc.finalLoose;
      newWac = calc.newWac;
      branchWarnings = calc.warnings.map((w) => `[${branch.code}] ${w}`);
    }

    // Write canonical balance
    await tx.inventoryBalance.upsert({
      where: { branchId_productId: { branchId: branch.id, productId: canonicalMember.productId } },
      create: {
        branchId: branch.id,
        productId: canonicalMember.productId,
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

    // Zero all non-canonical balances (their stock is now in the canonical)
    if (nonCanonicalIds.length > 0) {
      await tx.inventoryBalance.updateMany({
        where: { branchId: branch.id, productId: { in: nonCanonicalIds } },
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
        action: "STOCK_GROUP_BALANCES_REBUILT",
        entityType: "ProductStockGroup",
        entityId: input.stockGroupId,
        metadataJson: {
          mode: input.mode,
          reason: input.reason,
          groupCode: group.code,
          factor: factor?.toString() ?? null,
          previousBalances,
          newCanonicalBalance: {
            productId: canonicalMember.productId,
            quantityOnHand: newQty.toString(),
            closedPackageQuantity: newClosed.toString(),
            looseUnitQuantity: newLoose.toString(),
            weightedAverageCost: newWac.toString(),
          },
          zeroedProductIds: nonCanonicalIds,
          warnings: branchWarnings,
        },
      },
    });

    results.push({
      branchId: branch.id,
      branchCode: branch.code,
      newCanonicalQty: newQty.toString(),
      newCanonicalClosed: newClosed.toString(),
      newCanonicalLoose: newLoose.toString(),
      newCanonicalWac: newWac.toString(),
      zeroedProductIds: nonCanonicalIds,
      warnings: branchWarnings,
    });
  }

  return results;
}

// ─── Reparación GUIADA (Fase 1.6) — preview obligatorio con hash ──────────────

export type StockGroupRepairPreviewBranch = {
  branchId: string;
  branchCode: string;
  before: { quantityOnHand: string; closedPackageQuantity: string; looseUnitQuantity: string; weightedAverageCost: string };
  after: { quantityOnHand: string; closedPackageQuantity: string; looseUnitQuantity: string; weightedAverageCost: string };
  changed: boolean;
  warnings: string[];
};

export type StockGroupRepairPreview = {
  stockGroupId: string;
  stockGroupCode: string;
  branches: StockGroupRepairPreviewBranch[];
  anyChange: boolean;
  hash: string;
};

/**
 * Calcula, por sucursal, antes → después → si cambia, SIN escribir nada —
 * usa las mismas funciones puras (calcBaseConsolidation/
 * calcTracksPackagesConsolidation) que rebuildStockGroupBalancesTx, pero solo
 * lee. El hash es la garantía de "nadie repara sin ver": applyStockGroupRepairTx
 * exige que el hash siga siendo el mismo al momento de aplicar.
 *
 * Recibe `tx` inyectado (testeable sin DB real, mismo patrón que
 * rebuildStockGroupBalancesTx / previewEquivalentStockGroupMigrationTx).
 */
export async function previewStockGroupRepairTx(
  tx: Prisma.TransactionClient,
  stockGroupId: string,
): Promise<StockGroupRepairPreview> {
  const group = await tx.productStockGroup.findUnique({
    where: { id: stockGroupId, isActive: true },
    include: {
      products: {
        where: { isActive: true },
        select: { productId: true, conversionFactor: true, isCanonical: true, isPackagePresentation: true },
        orderBy: [{ isCanonical: "desc" }, { conversionFactor: "asc" }],
      },
    },
  });
  if (!group) throw new Error(`NOT_FOUND: Fusión ${stockGroupId} no encontrada o inactiva.`);

  const canonicalMember = group.products.find((m) => m.isCanonical);
  if (!canonicalMember) {
    throw new Error(`VALIDATION_ERROR: La fusión ${group.code} no tiene producto principal (canónico) activo.`);
  }
  const allProductIds = group.products.map((m) => m.productId);
  // Ver comentario equivalente en rebuildStockGroupBalancesTx: sin fallback a
  // "el primer no-canónico", la validación ya garantiza exactamente un
  // empaque marcado.
  const packageMember = group.tracksPackages
    ? group.products.find((m) => m.isPackagePresentation && !m.isCanonical) ?? null
    : null;
  const looseAlternateMembers = group.tracksPackages
    ? group.products.filter((m) => !m.isCanonical && m.productId !== packageMember?.productId)
    : [];
  const factor: Prisma.Decimal | null = group.tracksPackages
    ? new Prisma.Decimal(group.conversionFactorToBase ?? packageMember?.conversionFactor ?? 1)
    : null;

  const branches = await tx.branch.findMany({
    where: { isActive: true },
    select: { id: true, code: true },
    orderBy: { code: "asc" },
  });

  const branchPreviews: StockGroupRepairPreviewBranch[] = [];

  for (const branch of branches) {
    const balances = await tx.inventoryBalance.findMany({
      where: { branchId: branch.id, productId: { in: allProductIds } },
    });
    const balanceByProduct = new Map(balances.map((b) => [b.productId, b]));
    const canonicalBalance = balanceByProduct.get(canonicalMember.productId) ?? null;
    const zero = new Prisma.Decimal(0);
    const before = {
      quantityOnHand: canonicalBalance?.quantityOnHand ?? zero,
      closedPackageQuantity: canonicalBalance?.closedPackageQuantity ?? zero,
      looseUnitQuantity: canonicalBalance?.looseUnitQuantity ?? zero,
      weightedAverageCost: canonicalBalance?.weightedAverageCost ?? zero,
    };

    let newQty: Prisma.Decimal;
    let newClosed = zero;
    let newLoose = zero;
    let newWac: Prisma.Decimal;
    let warnings: string[] = [];

    if (!group.tracksPackages) {
      const memberInputs = group.products.map((m) => ({
        conversionFactor: new Prisma.Decimal(m.conversionFactor),
        balance: balanceByProduct.get(m.productId) ?? null,
      }));
      const calc = calcBaseConsolidation(memberInputs);
      newQty = calc.totalBaseQty;
      newWac = calc.newWac;
    } else {
      const packageBalance = packageMember ? balanceByProduct.get(packageMember.productId) ?? null : null;
      const calc = calcTracksPackagesConsolidation({
        packageBalance,
        canonicalBalance,
        factor: factor!,
        looseAlternateMembers: looseAlternateMembers.map((m) => ({
          conversionFactor: new Prisma.Decimal(m.conversionFactor),
          balance: balanceByProduct.get(m.productId) ?? null,
        })),
      });
      newQty = calc.totalBaseQty;
      newClosed = calc.finalClosed;
      newLoose = calc.finalLoose;
      newWac = calc.newWac;
      warnings = calc.warnings.map((w) => `[${branch.code}] ${w}`);
    }

    const changed = !before.quantityOnHand.eq(newQty)
      || !before.closedPackageQuantity.eq(newClosed)
      || !before.looseUnitQuantity.eq(newLoose)
      || !before.weightedAverageCost.eq(newWac);

    branchPreviews.push({
      branchId: branch.id,
      branchCode: branch.code,
      before: {
        quantityOnHand: before.quantityOnHand.toString(),
        closedPackageQuantity: before.closedPackageQuantity.toString(),
        looseUnitQuantity: before.looseUnitQuantity.toString(),
        weightedAverageCost: before.weightedAverageCost.toString(),
      },
      after: {
        quantityOnHand: newQty.toString(),
        closedPackageQuantity: newClosed.toString(),
        looseUnitQuantity: newLoose.toString(),
        weightedAverageCost: newWac.toString(),
      },
      changed,
      warnings,
    });
  }

  const hashInput = JSON.stringify(branchPreviews.map((b) => [b.branchId, b.before, b.after]));
  const hash = createHash("sha256").update(hashInput).digest("hex");

  return {
    stockGroupId: group.id,
    stockGroupCode: group.code,
    branches: branchPreviews,
    anyChange: branchPreviews.some((b) => b.changed),
    hash,
  };
}

/**
 * Aplica la reparación SOLO si el hash coincide con un preview recién
 * recalculado DENTRO de la misma transacción — si el inventario cambió desde
 * que se generó el preview que el usuario vio (otra venta, otro ajuste),
 * rechaza y pide generar uno nuevo. "Nadie repara sin ver" — no hay atajo
 * que se salte el preview, y el re-chequeo ocurre en la misma tx que el
 * rebuild (con el FOR UPDATE de rebuildStockGroupBalancesTx) para que no
 * quede una ventana entre validar el hash y escribir.
 */
export async function applyStockGroupRepairTx(
  tx: Prisma.TransactionClient,
  input: {
    stockGroupId: string;
    actorUserId: string;
    reason: string;
    expectedHash: string;
  },
): Promise<BranchRebuildResult[]> {
  const freshPreview = await previewStockGroupRepairTx(tx, input.stockGroupId);
  if (freshPreview.hash !== input.expectedHash) {
    throw new Error(
      "REPAIR_PREVIEW_STALE: El inventario cambió desde que se generó este preview. Generá uno nuevo antes de aplicar.",
    );
  }
  return rebuildStockGroupBalancesTx(tx, {
    stockGroupId: input.stockGroupId,
    actorUserId: input.actorUserId,
    reason: input.reason,
    mode: "REPAIR",
  });
}

// ─── Envoltorios con transacción propia (para rutas API) ─────────────────────

export function previewStockGroupRepair(stockGroupId: string): Promise<StockGroupRepairPreview> {
  return prisma.$transaction((tx) => previewStockGroupRepairTx(tx, stockGroupId));
}

export function applyStockGroupRepair(input: {
  stockGroupId: string;
  actorUserId: string;
  reason: string;
  expectedHash: string;
}): Promise<BranchRebuildResult[]> {
  return prisma.$transaction((tx) => applyStockGroupRepairTx(tx, input));
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

export function slugifyCode(name: string) {
  const base = name
    .toUpperCase()
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[^A-Z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .slice(0, 28);
  return base || `GRUPO_${Date.now()}`;
}

export function validateMembers(members: StockGroupMemberInput[]) {
  if (!Array.isArray(members) || members.length < 2) {
    throw new Error("VALIDATION_ERROR: Una fusión requiere al menos 2 productos (1 principal y 1 derivado).");
  }

  const canonicalMembers = members.filter((m) => m.isCanonical);
  if (canonicalMembers.length !== 1) {
    throw new Error("VALIDATION_ERROR: Debe haber exactamente un producto principal (unidad base).");
  }

  const canonical = canonicalMembers[0];
  if (Number(canonical.conversionFactor) !== 1) {
    throw new Error("VALIDATION_ERROR: El producto principal debe tener factor de conversión = 1.");
  }

  const seenProducts = new Set<string>();
  for (const member of members) {
    if (!member.productId) throw new Error("VALIDATION_ERROR: Falta un producto en la fusión.");
    if (seenProducts.has(member.productId)) {
      throw new Error("VALIDATION_ERROR: Un producto no puede aparecer dos veces en la misma fusión.");
    }
    seenProducts.add(member.productId);
    if (!member.saleUnit?.trim()) {
      throw new Error("VALIDATION_ERROR: Cada presentación debe tener una unidad de venta.");
    }
    if (!Number.isFinite(Number(member.conversionFactor)) || Number(member.conversionFactor) <= 0) {
      throw new Error("VALIDATION_ERROR: El factor de conversión debe ser mayor que 0.");
    }
  }

  // Unidades de venta distintas entre presentaciones. Sin esto, una fusión
  // puede guardarse con los N miembros en la misma unidad: el asistente
  // rotula todas las filas "1 UNIDAD = __ UNIDAD", el usuario no puede saber
  // cuál está editando, y el catálogo no puede decir de qué presentación
  // habla cada cifra. Es la causa raíz del bug de piedrín.
  const collisions = findUnitCollisions(members);
  if (collisions.length > 0) {
    const detail = collisions.map((c) => c.unit).join(", ");
    throw new Error(
      `VALIDATION_ERROR: Cada presentación necesita una unidad de venta distinta. Repetida: ${detail}. ` +
      "Ej: la base en LATA, y las otras en PALADA, METRO, CAMION.",
    );
  }

  return canonical;
}

export function validatePackageSettings(input: {
  tracksPackages?: boolean;
  packageUnit?: string | null;
  conversionFactorToBase?: number | null;
  minimumClosedPackageReserve?: number | null;
  members: StockGroupMemberInput[];
}) {
  if (!input.tracksPackages) return;
  if (!input.packageUnit?.trim()) {
    throw new Error("VALIDATION_ERROR: La unidad de empaque es obligatoria para presentaciones cerradas.");
  }
  if (!Number.isFinite(Number(input.conversionFactorToBase)) || Number(input.conversionFactorToBase) <= 0) {
    throw new Error("VALIDATION_ERROR: El factor de empaque debe ser mayor que 0.");
  }
  if (
    input.minimumClosedPackageReserve !== null &&
    input.minimumClosedPackageReserve !== undefined &&
    Number(input.minimumClosedPackageReserve) < 0
  ) {
    throw new Error("VALIDATION_ERROR: La reserva minima de empaques cerrados no puede ser negativa.");
  }
  // Fusión triple: con 3+ miembros puede haber varias presentaciones sueltas
  // alternativas (Libra, Unidad) además del canónico — pero el empaque
  // cerrado (Caja) tiene que ser exactamente UNO, marcado explícitamente.
  // Sin este tope, un segundo miembro con isPackagePresentation:true rompe
  // la resolución determinística de "cuál caja es la caja" en todo el resto
  // del módulo (rebuild, health check, apertura automática).
  const packageMembers = input.members.filter((member) => member.isPackagePresentation);
  if (packageMembers.length !== 1) {
    throw new Error(
      packageMembers.length === 0
        ? "VALIDATION_ERROR: Debe marcar una presentacion cerrada (empaque) para manejar stock cerrado/suelto."
        : "VALIDATION_ERROR: Solo puede haber una presentacion marcada como empaque cerrado — las demás deben ser presentaciones sueltas alternativas.",
    );
  }
}

export async function assertProductsAvailable(
  tx: Prisma.TransactionClient,
  members: StockGroupMemberInput[],
  allowGroupId?: string,
) {
  const productIds = members.map((m) => m.productId);
  const products = await tx.product.findMany({
    where: { id: { in: productIds } },
    select: { id: true, name: true, sku: true },
  });
  if (products.length !== productIds.length) {
    throw new Error("VALIDATION_ERROR: Uno o más productos seleccionados no existen.");
  }

  const conflicts = await tx.productStockGroupMember.findMany({
    where: {
      productId: { in: productIds },
      isActive: true,
      stockGroup: { isActive: true },
      ...(allowGroupId ? { stockGroupId: { not: allowGroupId } } : {}),
    },
    include: { product: { select: { sku: true, name: true } } },
  });
  if (conflicts.length > 0) {
    const names = conflicts.map((c) => `${c.product.sku} (${c.product.name})`).join(", ");
    throw new Error(`VALIDATION_ERROR: Estos productos ya están en otra fusión activa: ${names}.`);
  }
}

// ─── CRUD operations ──────────────────────────────────────────────────────────

/**
 * "es para poner el precio" — el costo de compra que se MUESTRA por
 * presentación en el apartado Fusiones (Catálogo e Inventario), fuera de
 * cualquier sucursal (Costo de compra es network-wide, "el mismo para
 * todas las sucursales" — mismo criterio que Precios y costos). Pura, sin
 * DB: aislada para probar la lectura sin base de datos, mismo principio
 * que resolveGlobalCostWriteTarget (catalog/service.ts), su contraparte
 * de ESCRITURA — no reimplementa esa lógica, es la misma regla mirada
 * desde el otro lado: el canónico manda su propio costo, un derivado
 * SIEMPRE deriva canonicalGlobalCost × factor, nunca guarda el suyo.
 */
export function computeFusionMemberGlobalCost(input: {
  isCanonical: boolean;
  ownGlobalCost: number | null;
  canonicalGlobalCost: number | null;
  conversionFactor: number;
}): number | null {
  if (input.isCanonical) return input.ownGlobalCost;
  if (input.canonicalGlobalCost === null) return null;
  return input.canonicalGlobalCost * input.conversionFactor;
}

/**
 * "las cosas no se ejecutan bien... revisa completo todo" — el WAC de red
 * que Fusiones usa para el costo REAL (effectiveCost) es un promedio
 * ponderado por cantidad entre TODAS las sucursales (Fusiones no tiene
 * selector de sucursal) — mismo criterio que enrichProduct en
 * catalog-inventory/service.ts. Pura, sin DB: aislada para probar el
 * cálculo sin base de datos.
 */
export function aggregateWeightedAverageCost(balances: Array<{ quantityOnHand: number; weightedAverageCost: number }>): number | null {
  const qty = balances.reduce((sum, b) => sum + b.quantityOnHand, 0);
  if (qty <= 0) return null;
  const value = balances.reduce((sum, b) => sum + b.quantityOnHand * b.weightedAverageCost, 0);
  return value / qty;
}

export async function listStockGroups() {
  const [groups, branches] = await Promise.all([
    prisma.productStockGroup.findMany({
      where: { isActive: true },
      include: {
        category: { select: { id: true, code: true, name: true } },
        products: {
          where: { isActive: true },
          include: {
            product: { select: { id: true, sku: true, name: true, unit: true, globalCost: true, standardSalePrice: true, averageCost: true, lastPurchaseCost: true } },
          },
          orderBy: [{ isCanonical: "desc" }, { conversionFactor: "asc" }],
        },
      },
      orderBy: { name: "asc" },
    }),
    prisma.branch.findMany({
      where: { isActive: true },
      select: { id: true, code: true, name: true },
      orderBy: { code: "asc" },
    }),
  ]);

  const canonicalProductIds = groups.flatMap((group) =>
    group.products.filter((member) => member.isCanonical).map((member) => member.productId),
  );
  const balances =
    canonicalProductIds.length > 0
      ? await prisma.inventoryBalance.findMany({
          where: { productId: { in: canonicalProductIds } },
          select: {
            branchId: true,
            productId: true,
            quantityOnHand: true,
            closedPackageQuantity: true,
            looseUnitQuantity: true,
            weightedAverageCost: true,
          },
        })
      : [];
  const balanceByBranchProduct = new Map(
    balances.map((balance) => [`${balance.branchId}:${balance.productId}`, balance]),
  );
  // "las cosas no se ejecutan bien... revisa completo todo" — "Precios y
  // costos" (branchEffectivePricing, getEffectiveProductPricingBatch) usa
  // resolveCostChain, que prioriza el WAC real de compras SOBRE globalCost
  // (decisión histórica ya establecida — "el WAC real siempre gana sobre
  // el relleno"). "Fusiones" mostraba costo/margen basados SOLO en
  // globalCost, ignorando el WAC — dos pantallas, dos costos y dos
  // márgenes DISTINTOS para el mismo producto (un margen sano acá,
  // "Precio bajo costo" allá). Acá se agrega el WAC de red (ponderado por
  // cantidad entre TODAS las sucursales — Fusiones no tiene selector de
  // sucursal, mismo criterio que resolveCatalogDisplayCost en
  // catalog-inventory/service.ts) para poder mostrar el costo REAL, no
  // uno que el resto del sistema ignora en cuanto hay compras reales.
  const wacByProductId = new Map<string, number>();
  for (const productId of canonicalProductIds) {
    const rows = balances.filter((b) => b.productId === productId);
    const aggregated = aggregateWeightedAverageCost(rows.map((b) => ({ quantityOnHand: Number(b.quantityOnHand), weightedAverageCost: Number(b.weightedAverageCost) })));
    if (aggregated !== null) wacByProductId.set(productId, aggregated);
  }

  const healthByGroupId = new Map(
    await Promise.all(
      groups.map(async (group) => [group.id, await checkStockGroupHealth(prisma, { stockGroupId: group.id })] as const),
    ),
  );

  // "es para poner el precio" (apartado Fusiones, prompt-fusiones-pestana-precio.md
  // o equivalente) — costo de compra por presentación, NETWORK-WIDE (sin
  // sucursal — mismo criterio que Precios y costos: "el costo de compra es
  // el mismo para todas las sucursales"). Para el canónico es su propio
  // globalCost; un derivado SIGUE sin guardar costo propio, siempre
  // canonicalGlobalCost × factor — la misma regla de siempre, solo que acá
  // se calcula para MOSTRAR, no para escribir (eso lo sigue haciendo
  // resolveGlobalCostWriteTarget, catalog/service.ts).
  const globalCostByProductId = new Map(
    groups.flatMap((group) => group.products.map((m) => [m.productId, m.product.globalCost !== null ? Number(m.product.globalCost) : null] as const)),
  );
  // "el precio de venta no se mueva solo" (catalog/service.ts, Parte A) —
  // a diferencia del costo (arriba), el standardSalePrice de cada miembro
  // ahora se lee TAL CUAL — updateProduct ya no lo redirige al canónico,
  // así que el campo propio dejó de ser fantasma: es la decisión real de
  // esa presentación.
  const standardSalePriceByProductId = new Map(
    groups.flatMap((group) => group.products.map((m) => [m.productId, Number(m.product.standardSalePrice)] as const)),
  );

  return groups.map((group) => ({
    health: healthByGroupId.get(group.id) ?? { stockGroupId: group.id, stockGroupCode: group.code, healthy: true, issues: [] },
    ...(group.tracksPackages
      ? (() => {
          const canonical = group.products.find((member) => member.isCanonical);
          const factor =
            group.conversionFactorToBase ??
            group.products.find((member) => !member.isCanonical)?.conversionFactor ??
            new Prisma.Decimal(1);
          const reserve = group.minimumClosedPackageReserve ?? new Prisma.Decimal(1);
          const branchStocks = canonical
            ? branches.map((branch) => {
                const balance = balanceByBranchProduct.get(`${branch.id}:${canonical.productId}`);
                const closed = new Prisma.Decimal(balance?.closedPackageQuantity ?? 0);
                const loose = new Prisma.Decimal(balance?.looseUnitQuantity ?? 0);
                const autoOpenablePackages = Prisma.Decimal.max(0, closed.sub(reserve));
                const autoOpenableUnitsTotal = autoOpenablePackages.mul(factor);
                const equivalentBaseQuantity = closed.mul(factor).add(loose);
                return {
                  branch,
                  closedPackageQuantity: Number(closed),
                  looseUnitQuantity: Number(loose),
                  autoOpenablePackages: Number(autoOpenablePackages),
                  autoOpenableUnitsTotal: Number(autoOpenableUnitsTotal),
                  equivalentBaseQuantity: Number(equivalentBaseQuantity),
                  unitSaleAutomaticallyEnabled: Boolean(
                    group.autoOpenForUnitSale && autoOpenablePackages.gt(0),
                  ),
                  onlyClosedReserveRemaining: closed.lte(reserve) && loose.eq(0),
                };
              })
            : [];
          return {
            branchStocks,
            totalClosedPackageQuantity: branchStocks.reduce(
              (sum, item) => sum + item.closedPackageQuantity,
              0,
            ),
            totalLooseUnitQuantity: branchStocks.reduce(
              (sum, item) => sum + item.looseUnitQuantity,
              0,
            ),
            totalAutoOpenableUnits: branchStocks.reduce(
              (sum, item) => sum + item.autoOpenableUnitsTotal,
              0,
            ),
            totalEquivalentBaseQuantity: branchStocks.reduce(
              (sum, item) => sum + item.equivalentBaseQuantity,
              0,
            ),
            displayConversionFactor: Number(factor),
          };
        })()
      : (() => {
          const canonical = group.products.find((member) => member.isCanonical);
          const derived = group.products.find((member) => !member.isCanonical);
          const factor = derived?.conversionFactor ?? new Prisma.Decimal(1);
          const branchStocks = canonical
            ? branches.map((branch) => {
                const balance = balanceByBranchProduct.get(`${branch.id}:${canonical.productId}`);
                const baseQty = new Prisma.Decimal(balance?.quantityOnHand ?? 0);
                const equivalentDerivedQuantity = factor.gt(0) ? baseQty.div(factor) : new Prisma.Decimal(0);
                return {
                  branch,
                  closedPackageQuantity: 0,
                  looseUnitQuantity: Number(baseQty),
                  autoOpenablePackages: 0,
                  autoOpenableUnitsTotal: 0,
                  equivalentBaseQuantity: Number(baseQty),
                  equivalentDerivedQuantity: Number(equivalentDerivedQuantity),
                  unitSaleAutomaticallyEnabled: false,
                  onlyClosedReserveRemaining: false,
                };
              })
            : [];
          return {
            branchStocks,
            totalClosedPackageQuantity: 0,
            totalLooseUnitQuantity: branchStocks.reduce((sum, item) => sum + item.looseUnitQuantity, 0),
            totalEquivalentBaseQuantity: branchStocks.reduce((sum, item) => sum + item.equivalentBaseQuantity, 0),
            displayConversionFactor: Number(factor),
          };
        })()),
    id: group.id,
    code: group.code,
    name: group.name,
    baseUnit: group.baseUnit,
    packageUnit: group.packageUnit,
    conversionFactorToBase: group.conversionFactorToBase ? Number(group.conversionFactorToBase) : null,
    tracksPackages: group.tracksPackages,
    approximateFactor: group.approximateFactor,
    minimumClosedPackageReserve: Number(group.minimumClosedPackageReserve ?? 1),
    autoOpenForUnitSale: group.autoOpenForUnitSale,
    isActive: group.isActive,
    category: group.category,
    members: (() => {
      const canonicalMember = group.products.find((member) => member.isCanonical) ?? null;
      const canonicalProductId = canonicalMember?.productId ?? null;
      const canonicalGlobalCost = canonicalProductId ? globalCostByProductId.get(canonicalProductId) ?? null : null;
      const canonicalWac = canonicalProductId ? wacByProductId.get(canonicalProductId) ?? null : null;
      return group.products.map((m) => {
        const globalCost = computeFusionMemberGlobalCost({
          isCanonical: m.isCanonical,
          ownGlobalCost: globalCostByProductId.get(m.productId) ?? null,
          canonicalGlobalCost,
          conversionFactor: Number(m.conversionFactor),
        });
        // "las cosas no se ejecutan bien... revisa completo todo" — el
        // costo REAL que gobierna la venta (Precios y costos, Brain, POS
        // vía resolveCostChain/getEffectiveProductPricingBatch) prioriza
        // el WAC de compras reales SOBRE globalCost — no es un bug, es la
        // misma decisión histórica de siempre ("el WAC real gana sobre el
        // relleno"). Mostrar acá un margen basado SOLO en globalCost,
        // ignorando que el WAC ya lo superó, es mostrar un margen que
        // contradice la realidad — exactamente lo reportado (20.5% acá,
        // -14.2% real en Precios y costos, para el mismo producto).
        // docs/COSTO-UNA-FUENTE.md #7 — resolveCostChain + resolveFusionMemberCost
        // directo (los mismos dos primitivos que usa
        // getEffectiveProductPricingBatch por dentro), no resolveCatalogDisplayCost
        // (borrada). Sin branchId a propósito: Fusiones no tiene selector de
        // sucursal, el WAC ya viene agregado entre TODAS las sucursales
        // arriba (canonicalWac) — branchCost no aplica acá, no hay UNA
        // sucursal a la que atribuírselo.
        const canonicalCost = canonicalMember
          ? resolveCostChain({
              branchCost: null,
              averageCost: canonicalMember.product.averageCost,
              globalCost: canonicalMember.product.globalCost,
              lastPurchaseCost: canonicalMember.product.lastPurchaseCost,
              weightedAverageCost: canonicalWac !== null ? new Prisma.Decimal(canonicalWac) : null,
            }).cost
          : null;
        const memberCost = canonicalCost !== null ? resolveFusionMemberCost(canonicalCost, m.conversionFactor) : null;
        const effectiveCost = memberCost !== null && memberCost.gt(0) ? Number(memberCost) : null;
        // "el precio de venta no se mueva solo... el PRECIO es una
        // decisión comercial POR PRESENTACIÓN" (catalog/service.ts, Parte
        // A/C) — a diferencia del costo (un hecho físico compartido, que
        // SÍ sigue derivándose del canónico arriba), el precio de cada
        // presentación YA NO se deriva de nada: es su propio
        // standardSalePrice, escrito directo por updateProduct (sin
        // redirect) y leído directo acá (sin computeFusionMemberGlobalCost
        // — esa función es para lo que SÍ se deriva del canónico × factor,
        // y el precio dejó de serlo). Antes de esto, Fusiones mostraba el
        // precio IMPLÍCITO aunque el usuario ya hubiera guardado un precio
        // propio distinto para esa presentación — la misma contradicción
        // entre pantallas que 03b87aa cerró para el margen, del lado de la
        // escritura.
        const standardSalePrice = standardSalePriceByProductId.get(m.productId) ?? null;
        return {
          id: m.id,
          productId: m.productId,
          sku: m.product.sku,
          productName: m.product.name,
          saleUnit: m.saleUnit,
          conversionFactor: Number(m.conversionFactor),
          isCanonical: m.isCanonical,
          isPackagePresentation: m.isPackagePresentation,
          globalCost,
          effectiveCost,
          standardSalePrice,
          // El margen se calcula con effectiveCost (el costo REAL que usa
          // el resto del motor), no con globalCost — así el margen que
          // muestra Fusiones nunca contradice al que muestra Precios y
          // costos/Brain/POS para el mismo producto.
          marginPercent: effectiveCost !== null && effectiveCost > 0 && standardSalePrice !== null && standardSalePrice > 0
            ? ((standardSalePrice - effectiveCost) / standardSalePrice) * 100
            : null,
        };
      });
    })(),
  }));
}

/**
 * Fusión de Inventario v2, Fase 2.1 — crea las filas de grupo + miembros
 * (SIN consolidar balances). Usado exclusivamente por el asistente de
 * creación (fusion-wizard-service.ts), que decide la composición final vía
 * el preview con resolución de conflictos del paso 3 antes de escribir
 * ningún balance — nunca por el flujo viejo "crear y sumar a ciegas".
 */
export async function createStockGroupRowsTx(
  tx: Prisma.TransactionClient,
  input: CreateStockGroupInput,
) {
  const name = (input.name ?? "").trim();
  if (!name) throw new Error("VALIDATION_ERROR: El nombre de la fusión es obligatorio.");

  const canonical = validateMembers(input.members);
  validatePackageSettings({
    tracksPackages: input.tracksPackages,
    packageUnit: input.packageUnit,
    conversionFactorToBase: input.conversionFactorToBase,
    minimumClosedPackageReserve: input.minimumClosedPackageReserve,
    members: input.members,
  });
  const baseUnit = canonicalizePresentationUnit(input.baseUnit ?? canonical.saleUnit);
  const packageUnit = input.packageUnit?.trim().toUpperCase() || null;
  const conversionFactorToBase =
    input.conversionFactorToBase ?? input.members.find((member) => !member.isCanonical)?.conversionFactor ?? null;
  const minimumClosedPackageReserve = input.minimumClosedPackageReserve ?? 1;
  const baseCode = (input.code?.trim() || slugifyCode(name)).toUpperCase();

  // El código es un identificador interno (nunca se muestra al usuario) —
  // varias fusiones distintas pueden generar el mismo código si comparten
  // nombre o preset (p.ej. "Hierro 3/8" para variantes STD/9V/8MM, que ya no
  // se distinguen automáticamente tras Fase 2.3). En vez de bloquear la
  // creación, se desambigua agregando un sufijo numérico.
  let code = baseCode;
  for (let suffix = 2; await tx.productStockGroup.findUnique({ where: { code } }); suffix += 1) {
    code = `${baseCode}_${suffix}`;
  }

  await assertProductsAvailable(tx, input.members);

  const createdGroup = await tx.productStockGroup.create({
    data: {
      code,
      name,
      baseUnit,
      packageUnit,
      conversionFactorToBase:
        conversionFactorToBase === null ? null : new Prisma.Decimal(conversionFactorToBase),
      tracksPackages: Boolean(input.tracksPackages),
      approximateFactor: Boolean(input.approximateFactor),
      minimumClosedPackageReserve: new Prisma.Decimal(minimumClosedPackageReserve),
      autoOpenForUnitSale: input.tracksPackages ? (input.autoOpenForUnitSale ?? true) : false,
      categoryId: input.categoryId ?? null,
    },
  });

  for (const member of input.members) {
    await tx.productStockGroupMember.create({
      data: {
        stockGroupId: createdGroup.id,
        productId: member.productId,
        saleUnit: canonicalizePresentationUnit(member.saleUnit),
        conversionFactor: new Prisma.Decimal(member.conversionFactor),
        isCanonical: member.isCanonical,
        // Fusión triple: ya NO se fuerza a todo no-canónico a ser "el
        // empaque" — con 3+ miembros eso marcaría dos cajas a la vez. Se
        // respeta exactamente lo que decidió el llamador (validado arriba:
        // con tracksPackages=true, validatePackageSettings ya exige que haya
        // exactamente uno marcado true).
        isPackagePresentation: Boolean(member.isPackagePresentation),
      },
    });
  }

  return { group: createdGroup, canonical };
}

export async function updateStockGroup(id: string, input: UpdateStockGroupInput, actorUserId: string) {
  const group = await prisma.$transaction(async (tx) => {
    const current = await tx.productStockGroup.findUnique({ where: { id } });
    if (!current) throw new Error("NOT_FOUND: Fusión no encontrada.");

    const data: Prisma.ProductStockGroupUpdateInput = {};
    if (typeof input.name === "string" && input.name.trim()) data.name = input.name.trim();
    if (typeof input.isActive === "boolean") data.isActive = input.isActive;
    if (typeof input.packageUnit !== "undefined")
      data.packageUnit = input.packageUnit?.trim().toUpperCase() || null;
    if (typeof input.conversionFactorToBase !== "undefined") {
      data.conversionFactorToBase =
        input.conversionFactorToBase === null
          ? null
          : new Prisma.Decimal(input.conversionFactorToBase);
    }
    if (typeof input.tracksPackages === "boolean") data.tracksPackages = input.tracksPackages;
    if (typeof input.approximateFactor === "boolean") data.approximateFactor = input.approximateFactor;
    if (typeof input.minimumClosedPackageReserve !== "undefined") {
      data.minimumClosedPackageReserve = new Prisma.Decimal(input.minimumClosedPackageReserve ?? 1);
    }
    if (typeof input.autoOpenForUnitSale === "boolean") data.autoOpenForUnitSale = input.autoOpenForUnitSale;

    let needsRebuild = false;

    if (input.members) {
      const canonical = validateMembers(input.members);
      validatePackageSettings({
        tracksPackages: input.tracksPackages ?? current.tracksPackages,
        packageUnit: input.packageUnit ?? current.packageUnit,
        conversionFactorToBase:
          input.conversionFactorToBase ??
          (current.conversionFactorToBase ? Number(current.conversionFactorToBase) : null),
        minimumClosedPackageReserve:
          input.minimumClosedPackageReserve ?? Number(current.minimumClosedPackageReserve),
        members: input.members,
      });
      data.baseUnit = canonicalizePresentationUnit(canonical.saleUnit);
      await assertProductsAvailable(tx, input.members, id);

      const keepProductIds = new Set(input.members.map((m) => m.productId));
      await tx.productStockGroupMember.updateMany({
        where: { stockGroupId: id, productId: { notIn: Array.from(keepProductIds) } },
        data: { isActive: false, isCanonical: false },
      });

      for (const member of input.members) {
        await tx.productStockGroupMember.upsert({
          where: { stockGroupId_productId: { stockGroupId: id, productId: member.productId } },
          create: {
            stockGroupId: id,
            productId: member.productId,
            saleUnit: canonicalizePresentationUnit(member.saleUnit),
            conversionFactor: new Prisma.Decimal(member.conversionFactor),
            isCanonical: member.isCanonical,
            // Fusión triple: idem createStockGroupRowsTx — se respeta la
            // bandera explícita, no se fuerza a todo no-canónico.
            isPackagePresentation: Boolean(member.isPackagePresentation),
          },
          update: {
            saleUnit: canonicalizePresentationUnit(member.saleUnit),
            conversionFactor: new Prisma.Decimal(member.conversionFactor),
            isCanonical: member.isCanonical,
            isPackagePresentation: Boolean(member.isPackagePresentation),
            isActive: true,
          },
        });
      }
      needsRebuild = true;
    }

    // Structural changes that affect how stock is read also require a rebuild
    const structuralChange =
      typeof input.tracksPackages === "boolean" ||
      typeof input.conversionFactorToBase !== "undefined" ||
      typeof input.packageUnit !== "undefined";
    if (structuralChange) needsRebuild = true;

    const updatedGroup = await tx.productStockGroup.update({ where: { id }, data });

    if (needsRebuild) {
      await rebuildStockGroupBalancesTx(tx, {
        stockGroupId: id,
        actorUserId,
        reason: "Stock group update — members or structural settings changed",
        mode: "UPDATE",
      });
    }

    return updatedGroup;
  }, { timeout: 20000, maxWait: 10000 });

  await logAuditEvent({
    actorUserId,
    module: "catalog",
    action: "STOCK_GROUP_UPDATED",
    entityType: "ProductStockGroup",
    entityId: group.id,
    metadataJson: { code: group.code, name: group.name },
  });

  return group;
}

// ─── Desfusión (Fase 2.2) — reemplaza el delete-callejón ─────────────────────

type UnmergeGroupInfo = {
  id: string;
  code: string;
  name: string;
  tracksPackages: boolean;
  members: Array<{ productId: string; isCanonical: boolean; conversionFactor: Prisma.Decimal }>;
};

async function loadGroupForUnmerge(tx: Prisma.TransactionClient, stockGroupId: string): Promise<UnmergeGroupInfo> {
  const group = await tx.productStockGroup.findUnique({
    where: { id: stockGroupId },
    include: {
      products: {
        where: { isActive: true },
        select: { productId: true, isCanonical: true, conversionFactor: true },
      },
    },
  });
  if (!group) throw new Error("NOT_FOUND: Fusión no encontrada.");
  return {
    id: group.id,
    code: group.code,
    name: group.name,
    tracksPackages: group.tracksPackages,
    members: group.products,
  };
}

export type UnmergeBranchPreview = {
  branchId: string;
  branchCode: string;
  targetNewQty: string;
  otherMemberIdsZeroed: string[];
};

export type UnmergePreview = {
  stockGroupId: string;
  stockGroupCode: string;
  totalStock: string;
  targetProductId: string;
  branches: UnmergeBranchPreview[];
};

/**
 * Preview de desfusión: muestra cómo quedaría el stock si se reasigna TODO
 * el consolidado (que hoy vive en el canónico) al producto `targetProductId`.
 * No escribe nada.
 */
export async function previewUnmergeStockGroupTx(
  tx: Prisma.TransactionClient,
  input: { stockGroupId: string; targetProductId?: string },
): Promise<UnmergePreview> {
  const group = await loadGroupForUnmerge(tx, input.stockGroupId);
  const canonical = group.members.find((m) => m.isCanonical);
  if (!canonical) throw new Error(`VALIDATION_ERROR: La fusión ${group.code} no tiene producto principal activo.`);
  const targetProductId = input.targetProductId ?? canonical.productId;
  const target = group.members.find((m) => m.productId === targetProductId);
  if (!target) throw new Error("VALIDATION_ERROR: El producto de destino no pertenece a esta fusión.");

  const allProductIds = group.members.map((m) => m.productId);
  const otherMemberIds = allProductIds.filter((id) => id !== targetProductId);

  const branches = await tx.branch.findMany({ where: { isActive: true }, select: { id: true, code: true }, orderBy: { code: "asc" } });
  const balances = await tx.inventoryBalance.findMany({ where: { productId: { in: allProductIds } } });
  const byBranchProduct = new Map(balances.map((b) => [`${b.branchId}:${b.productId}`, b]));

  const branchPreviews: UnmergeBranchPreview[] = [];
  let totalStock = new Prisma.Decimal(0);
  for (const branch of branches) {
    const canonicalBalance = byBranchProduct.get(`${branch.id}:${canonical.productId}`);
    const baseQty = canonicalBalance?.quantityOnHand ?? new Prisma.Decimal(0);
    totalStock = totalStock.add(baseQty);
    const targetQty = target.conversionFactor.eq(1) ? baseQty : baseQty.div(target.conversionFactor);
    branchPreviews.push({
      branchId: branch.id,
      branchCode: branch.code,
      targetNewQty: targetQty.toString(),
      otherMemberIdsZeroed: otherMemberIds,
    });
  }

  return {
    stockGroupId: group.id,
    stockGroupCode: group.code,
    totalStock: totalStock.toString(),
    targetProductId,
    branches: branchPreviews,
  };
}

export function previewUnmergeStockGroup(input: { stockGroupId: string; targetProductId?: string }) {
  return prisma.$transaction((tx) => previewUnmergeStockGroupTx(tx, input));
}

/**
 * Desfusiona: reasigna todo el stock consolidado (base) a `targetProductId`
 * — convertido a la unidad de venta propia de ese producto vía su factor —
 * deja a cero físico los demás miembros, y desactiva el grupo. Reemplaza el
 * viejo bloqueo STOCK_NOT_ZERO: ahora siempre hay un camino con inventario
 * vivo, auditado por sucursal.
 */
export async function unmergeStockGroupTx(
  tx: Prisma.TransactionClient,
  input: { stockGroupId: string; targetProductId?: string; actorUserId: string; reason?: string },
) {
  const group = await loadGroupForUnmerge(tx, input.stockGroupId);
  const canonical = group.members.find((m) => m.isCanonical);
  if (!canonical) throw new Error(`VALIDATION_ERROR: La fusión ${group.code} no tiene producto principal activo.`);
  const targetProductId = input.targetProductId ?? canonical.productId;
  const target = group.members.find((m) => m.productId === targetProductId);
  if (!target) throw new Error("VALIDATION_ERROR: El producto de destino no pertenece a esta fusión.");

  const allProductIds = group.members.map((m) => m.productId);
  const otherMemberIds = allProductIds.filter((id) => id !== targetProductId);

  const branches = await tx.branch.findMany({ where: { isActive: true }, select: { id: true, code: true }, orderBy: { code: "asc" } });
  const results: Array<{ branchId: string; branchCode: string; targetNewQty: string }> = [];

  for (const branch of branches) {
    for (const productId of allProductIds) {
      await tx.$queryRaw`
        SELECT id FROM "InventoryBalance"
        WHERE "branchId" = ${branch.id}
          AND "productId" = ${productId}
        FOR UPDATE
      `;
    }

    const balances = await tx.inventoryBalance.findMany({ where: { branchId: branch.id, productId: { in: allProductIds } } });
    const byProduct = new Map(balances.map((b) => [b.productId, b]));
    const canonicalBalance = byProduct.get(canonical.productId);
    const baseQty = canonicalBalance?.quantityOnHand ?? new Prisma.Decimal(0);
    const wac = canonicalBalance?.weightedAverageCost ?? new Prisma.Decimal(0);
    const targetQty = target.conversionFactor.eq(1) ? baseQty : baseQty.div(target.conversionFactor);
    const targetWac = target.conversionFactor.eq(1) ? wac : wac.mul(target.conversionFactor);

    await tx.inventoryBalance.upsert({
      where: { branchId_productId: { branchId: branch.id, productId: target.productId } },
      create: {
        branchId: branch.id,
        productId: target.productId,
        quantityOnHand: targetQty,
        closedPackageQuantity: 0,
        looseUnitQuantity: 0,
        weightedAverageCost: targetWac,
        inventoryValue: targetQty.mul(targetWac),
      },
      update: {
        quantityOnHand: targetQty,
        closedPackageQuantity: 0,
        looseUnitQuantity: 0,
        weightedAverageCost: targetWac,
        inventoryValue: targetQty.mul(targetWac),
      },
    });

    if (otherMemberIds.length > 0) {
      await tx.inventoryBalance.updateMany({
        where: { branchId: branch.id, productId: { in: otherMemberIds } },
        data: { quantityOnHand: 0, closedPackageQuantity: 0, looseUnitQuantity: 0, weightedAverageCost: 0, inventoryValue: 0 },
      });
    }

    await tx.auditLog.create({
      data: {
        actorUserId: input.actorUserId,
        branchId: branch.id,
        module: "catalog",
        action: "STOCK_GROUP_UNMERGED",
        entityType: "ProductStockGroup",
        entityId: group.id,
        metadataJson: {
          groupCode: group.code,
          reason: input.reason ?? "unmerge stock group",
          targetProductId: target.productId,
          previousCanonicalBaseQty: baseQty.toString(),
          targetNewQty: targetQty.toString(),
          zeroedProductIds: otherMemberIds,
        },
      },
    });

    results.push({ branchId: branch.id, branchCode: branch.code, targetNewQty: targetQty.toString() });
  }

  await tx.productStockGroupMember.updateMany({ where: { stockGroupId: group.id }, data: { isActive: false } });
  const updatedGroup = await tx.productStockGroup.update({ where: { id: group.id }, data: { isActive: false } });

  return { group: updatedGroup, branches: results };
}

export async function unmergeStockGroup(input: { stockGroupId: string; targetProductId?: string; actorUserId: string; reason?: string }) {
  return prisma.$transaction((tx) => unmergeStockGroupTx(tx, input));
}
