import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { logAuditEvent } from "@/modules/audit/service";
import { NAIL_PACKAGE_PRESETS, detectNailPackagePreset } from "@/modules/inventory/unit-conversion";

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
 * Exported for unit tests — no DB dependency.
 */
export function calcTracksPackagesConsolidation(input: {
  packageBalance: BalanceSnapshot | null | undefined;
  canonicalBalance: BalanceSnapshot | null | undefined;
  factor: Prisma.Decimal;
}): {
  finalClosed: Prisma.Decimal;
  finalLoose: Prisma.Decimal;
  totalBaseQty: Prisma.Decimal;
  newWac: Prisma.Decimal;
  warnings: string[];
} {
  const { packageBalance, canonicalBalance, factor } = input;
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

  const finalClosed = closedFromPackage.add(closedFromCanonical);
  const finalLoose = looseFromCanonical;
  const totalBaseQty = finalClosed.mul(factor).add(finalLoose);

  // WAC: weighted average of package-side cost and canonical-side cost, both in base units
  let newWac = new Prisma.Decimal(0);
  if (totalBaseQty.gt(0)) {
    const pkgBaseQty = closedFromPackage.mul(factor);
    // packageBalance.weightedAverageCost is cost per PACKAGE unit (e.g., per KILO)
    const pkgWacPerBase =
      pkgBaseQty.gt(0) && packageBalance && packageBalance.weightedAverageCost.gt(0)
        ? packageBalance.weightedAverageCost.div(factor)
        : new Prisma.Decimal(0);

    const canonBaseQty = closedFromCanonical.mul(factor).add(finalLoose);
    // canonicalBalance.weightedAverageCost is already per BASE unit (e.g., per UNIDAD)
    const canonWacPerBase = canonicalBalance?.weightedAverageCost ?? new Prisma.Decimal(0);

    const wacNumerator = pkgBaseQty.mul(pkgWacPerBase).add(canonBaseQty.mul(canonWacPerBase));
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

  // Package member for tracksPackages=true
  const packageMember = group.tracksPackages
    ? group.products.find((m) => m.isPackagePresentation && !m.isCanonical) ??
      group.products.find((m) => !m.isCanonical)
    : null;

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
    const previousBalances: Record<string, unknown> = {};

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

// ─── Helpers ─────────────────────────────────────────────────────────────────

function slugifyCode(name: string) {
  const base = name
    .toUpperCase()
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[^A-Z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .slice(0, 28);
  return base || `GRUPO_${Date.now()}`;
}

function validateMembers(members: StockGroupMemberInput[]) {
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

  const seen = new Set<string>();
  for (const member of members) {
    if (!member.productId) throw new Error("VALIDATION_ERROR: Falta un producto en la fusión.");
    if (seen.has(member.productId)) {
      throw new Error("VALIDATION_ERROR: Un producto no puede aparecer dos veces en la misma fusión.");
    }
    seen.add(member.productId);
    if (!member.saleUnit || !member.saleUnit.trim()) {
      throw new Error("VALIDATION_ERROR: Cada producto debe tener una unidad de venta.");
    }
    if (!Number.isFinite(Number(member.conversionFactor)) || Number(member.conversionFactor) <= 0) {
      throw new Error("VALIDATION_ERROR: El factor de conversión debe ser mayor que 0.");
    }
  }

  return canonical;
}

function validatePackageSettings(input: {
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
  const packageMembers = input.members.filter((member) => member.isPackagePresentation || !member.isCanonical);
  if (packageMembers.length < 1) {
    throw new Error("VALIDATION_ERROR: Debe marcar una presentacion cerrada para manejar stock cerrado/suelto.");
  }
}

async function assertProductsAvailable(
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

export async function listStockGroups() {
  const [groups, branches] = await Promise.all([
    prisma.productStockGroup.findMany({
      where: { isActive: true },
      include: {
        category: { select: { id: true, code: true, name: true } },
        products: {
          where: { isActive: true },
          include: {
            product: { select: { id: true, sku: true, name: true, unit: true } },
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
          },
        })
      : [];
  const balanceByBranchProduct = new Map(
    balances.map((balance) => [`${balance.branchId}:${balance.productId}`, balance]),
  );

  return groups.map((group) => ({
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
      : {
          branchStocks: [],
          totalClosedPackageQuantity: 0,
          totalLooseUnitQuantity: 0,
          totalEquivalentBaseQuantity: 0,
          displayConversionFactor: null,
        }),
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
    members: group.products.map((m) => ({
      id: m.id,
      productId: m.productId,
      sku: m.product.sku,
      productName: m.product.name,
      saleUnit: m.saleUnit,
      conversionFactor: Number(m.conversionFactor),
      isCanonical: m.isCanonical,
      isPackagePresentation: m.isPackagePresentation,
    })),
  }));
}

export async function createStockGroup(input: CreateStockGroupInput, actorUserId: string) {
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
  const baseUnit = (input.baseUnit ?? canonical.saleUnit).trim();
  const packageUnit = input.packageUnit?.trim().toUpperCase() || null;
  const conversionFactorToBase =
    input.conversionFactorToBase ?? input.members.find((member) => !member.isCanonical)?.conversionFactor ?? null;
  const minimumClosedPackageReserve = input.minimumClosedPackageReserve ?? 1;
  const code = (input.code?.trim() || slugifyCode(name)).toUpperCase();

  const group = await prisma.$transaction(async (tx) => {
    const existing = await tx.productStockGroup.findUnique({ where: { code } });
    if (existing) {
      throw new Error("VALIDATION_ERROR: Ya existe una fusión con ese código.");
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
          saleUnit: member.saleUnit.trim(),
          conversionFactor: new Prisma.Decimal(member.conversionFactor),
          isCanonical: member.isCanonical,
          isPackagePresentation: Boolean(
            member.isPackagePresentation || (!member.isCanonical && input.tracksPackages),
          ),
        },
      });
    }

    // Consolidate all pre-existing member balances into the canonical product.
    // For tracksPackages=true this also populates closedPackageQuantity and looseUnitQuantity.
    await rebuildStockGroupBalancesTx(tx, {
      stockGroupId: createdGroup.id,
      actorUserId,
      reason: "Stock group creation — merging pre-existing member balances",
      mode: "CREATE",
    });

    return createdGroup;
  });

  await logAuditEvent({
    actorUserId,
    module: "catalog",
    action: "STOCK_GROUP_CREATED",
    entityType: "ProductStockGroup",
    entityId: group.id,
    metadataJson: { code: group.code, name: group.name, members: input.members.length },
  });

  return group;
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
      data.baseUnit = canonical.saleUnit.trim();
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
            saleUnit: member.saleUnit.trim(),
            conversionFactor: new Prisma.Decimal(member.conversionFactor),
            isCanonical: member.isCanonical,
            isPackagePresentation: Boolean(
              member.isPackagePresentation ||
                (!member.isCanonical && (input.tracksPackages ?? current.tracksPackages)),
            ),
          },
          update: {
            saleUnit: member.saleUnit.trim(),
            conversionFactor: new Prisma.Decimal(member.conversionFactor),
            isCanonical: member.isCanonical,
            isPackagePresentation: Boolean(
              member.isPackagePresentation ||
                (!member.isCanonical && (input.tracksPackages ?? current.tracksPackages)),
            ),
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
  });

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

export async function deleteStockGroup(id: string, actorUserId: string) {
  const group = await prisma.$transaction(async (tx) => {
    const current = await tx.productStockGroup.findUnique({
      where: { id },
      include: {
        products: {
          where: { isActive: true, isCanonical: true },
          select: { productId: true },
        },
      },
    });
    if (!current) throw new Error("NOT_FOUND: Fusión no encontrada.");

    // Block deletion if any branch still holds stock on the canonical product.
    // Allowing deletion with live stock would silently orphan inventory.
    const canonicalProductId = current.products.find((m) => m.isCanonical)?.productId;
    if (canonicalProductId) {
      const stockCheck = await tx.inventoryBalance.aggregate({
        where: { productId: canonicalProductId },
        _sum: { quantityOnHand: true },
      });
      const totalStock = Number(stockCheck._sum.quantityOnHand ?? 0);
      if (totalStock > 0) {
        throw new Error(
          "STOCK_NOT_ZERO: No se puede eliminar una fusión con stock. " +
            "Primero exporte, reasigne o repare el inventario.",
        );
      }
    }

    await tx.productStockGroupMember.updateMany({
      where: { stockGroupId: id },
      data: { isActive: false },
    });

    return tx.productStockGroup.update({ where: { id }, data: { isActive: false } });
  });

  await logAuditEvent({
    actorUserId,
    module: "catalog",
    action: "STOCK_GROUP_DELETED",
    entityType: "ProductStockGroup",
    entityId: group.id,
    metadataJson: { code: group.code, name: group.name },
  });

  return group;
}

// ─── Nail normalization ───────────────────────────────────────────────────────

function normalizedName(value: string) {
  return value
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toUpperCase()
    .replace(/\s+/g, " ")
    .trim();
}

function isKiloNailProduct(product: { name: string; sku: string; unit: string }) {
  const name = normalizedName(`${product.sku} ${product.name} ${product.unit}`);
  return (
    name.includes("CLAVO") &&
    name.includes("ACERO") &&
    (name.includes(" KILO ") ||
      name.includes("KILO CLAVO") ||
      product.unit.toUpperCase() === "KILO")
  );
}

function isLooseNailProduct(product: { name: string; sku: string; unit: string }) {
  const name = normalizedName(`${product.sku} ${product.name} ${product.unit}`);
  return (
    name.includes("CLAVO") &&
    name.includes("ACERO") &&
    (name.includes(" UD") || name.includes("UNIDAD") || product.unit.toUpperCase() === "UNIDAD")
  );
}

/**
 * Ensures every KILO/UNIDAD nail preset has a correctly-configured stock group and
 * that all branch balances are consolidated. Idempotent — safe to run multiple times.
 *
 * Unlike the previous implementation, this does NOT skip branches that were already
 * normalized. rebuildStockGroupBalancesTx is idempotent, so re-running is harmless
 * and repairs any corruption from a previous failed normalization.
 */
export async function normalizeNailStockGroups(actorUserId: string) {
  const products = await prisma.product.findMany({
    where: {
      isActive: true,
      OR: [
        { name: { contains: "CLAVO", mode: "insensitive" } },
        { sku: { contains: "CLV", mode: "insensitive" } },
      ],
    },
    select: { id: true, sku: true, name: true, unit: true, categoryId: true },
    orderBy: { sku: "asc" },
  });

  const results = [];

  for (const preset of NAIL_PACKAGE_PRESETS) {
    const matching = products.filter(
      (product) => detectNailPackagePreset(product.name)?.key === preset.key,
    );
    const packageProduct = matching.find(isKiloNailProduct);
    const looseProduct = matching.find(isLooseNailProduct);
    if (!packageProduct || !looseProduct) {
      results.push({ preset: preset.key, status: "SKIPPED", reason: "PAIR_NOT_FOUND" });
      continue;
    }

    const groupResult = await prisma.$transaction(async (tx) => {
      const memberships = await tx.productStockGroupMember.findMany({
        where: {
          productId: { in: [packageProduct.id, looseProduct.id] },
          isActive: true,
          stockGroup: { isActive: true },
        },
        include: { stockGroup: true },
      });
      const groupIds = Array.from(new Set(memberships.map((membership) => membership.stockGroupId)));
      if (groupIds.length > 1) {
        throw new Error(
          `VALIDATION_ERROR: Los productos de ${preset.label} pertenecen a fusiones activas distintas.`,
        );
      }

      const code = preset.key.toUpperCase();
      const currentGroup = groupIds[0]
        ? await tx.productStockGroup.findUniqueOrThrow({ where: { id: groupIds[0] } })
        : await tx.productStockGroup.findUnique({ where: { code } });

      const normalizedGroup = currentGroup
        ? await tx.productStockGroup.update({
            where: { id: currentGroup.id },
            data: {
              code: currentGroup.code,
              name: `${preset.label} - KILO/UNIDAD por sucursal`,
              baseUnit: preset.baseUnit,
              packageUnit: preset.packageUnit,
              conversionFactorToBase: new Prisma.Decimal(preset.factor),
              tracksPackages: true,
              approximateFactor: true,
              minimumClosedPackageReserve: new Prisma.Decimal(1),
              autoOpenForUnitSale: true,
              categoryId: packageProduct.categoryId ?? looseProduct.categoryId,
              isActive: true,
            },
          })
        : await tx.productStockGroup.create({
            data: {
              code,
              name: `${preset.label} - KILO/UNIDAD por sucursal`,
              baseUnit: preset.baseUnit,
              packageUnit: preset.packageUnit,
              conversionFactorToBase: new Prisma.Decimal(preset.factor),
              tracksPackages: true,
              approximateFactor: true,
              minimumClosedPackageReserve: new Prisma.Decimal(1),
              autoOpenForUnitSale: true,
              categoryId: packageProduct.categoryId ?? looseProduct.categoryId,
            },
          });

      await tx.productStockGroupMember.updateMany({
        where: {
          stockGroupId: normalizedGroup.id,
          productId: { notIn: [packageProduct.id, looseProduct.id] },
        },
        data: { isActive: false, isCanonical: false },
      });

      // Canonical = loose (UNIDAD), package = kilo (KILO)
      await tx.productStockGroupMember.upsert({
        where: { stockGroupId_productId: { stockGroupId: normalizedGroup.id, productId: looseProduct.id } },
        create: {
          stockGroupId: normalizedGroup.id,
          productId: looseProduct.id,
          saleUnit: preset.baseUnit,
          conversionFactor: new Prisma.Decimal(1),
          isCanonical: true,
          isPackagePresentation: false,
        },
        update: {
          saleUnit: preset.baseUnit,
          conversionFactor: new Prisma.Decimal(1),
          isCanonical: true,
          isPackagePresentation: false,
          isActive: true,
        },
      });
      await tx.productStockGroupMember.upsert({
        where: { stockGroupId_productId: { stockGroupId: normalizedGroup.id, productId: packageProduct.id } },
        create: {
          stockGroupId: normalizedGroup.id,
          productId: packageProduct.id,
          saleUnit: preset.packageUnit,
          conversionFactor: new Prisma.Decimal(preset.factor),
          isCanonical: false,
          isPackagePresentation: true,
        },
        update: {
          saleUnit: preset.packageUnit,
          conversionFactor: new Prisma.Decimal(preset.factor),
          isCanonical: false,
          isPackagePresentation: true,
          isActive: true,
        },
      });

      // Consolidate balances for every branch — always (no auditLog skip).
      // rebuildStockGroupBalancesTx is idempotent so re-running is safe.
      const branchResults = await rebuildStockGroupBalancesTx(tx, {
        stockGroupId: normalizedGroup.id,
        actorUserId,
        reason: `normalizeNailStockGroups preset=${preset.key}`,
        mode: "NORMALIZE_NAILS",
      });

      return { group: normalizedGroup, branchResults };
    });

    results.push({
      preset: preset.key,
      status: "NORMALIZED",
      stockGroupId: groupResult.group.id,
      code: groupResult.group.code,
      packageProductId: packageProduct.id,
      looseProductId: looseProduct.id,
      branchResults: groupResult.branchResults,
    });
  }

  return { results };
}
