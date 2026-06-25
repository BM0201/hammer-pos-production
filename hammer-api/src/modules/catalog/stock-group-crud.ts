import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { logAuditEvent } from "@/modules/audit/service";
import { NAIL_PACKAGE_PRESETS, detectNailPackagePreset } from "@/modules/inventory/unit-conversion";

/**
 * CRUD genérico de "Fusión de Inventario" (ProductStockGroup).
 *
 * Concepto: un grupo de stock comparte un único inventario físico que se
 * lleva en la "unidad base" (el producto canónico, factor de conversión = 1).
 * Los demás productos del grupo (derivados) se venden en otra presentación y
 * descuentan del mismo inventario según su factor de conversión.
 *
 * Ejemplo Hierro 3/8": base = VARILLA (factor 1); QUINTAL factor 14
 * (1 quintal = 14 varillas). Vender 1 quintal descuenta 14 varillas del stock.
 */

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

function slugifyCode(name: string) {
  const base = name
    .toUpperCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
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
  if (input.minimumClosedPackageReserve !== null && input.minimumClosedPackageReserve !== undefined && Number(input.minimumClosedPackageReserve) < 0) {
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

  // Un producto solo puede pertenecer a un grupo activo a la vez.
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

  const canonicalProductIds = groups.flatMap((group) => group.products.filter((member) => member.isCanonical).map((member) => member.productId));
  const balances = canonicalProductIds.length > 0
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
  const balanceByBranchProduct = new Map(balances.map((balance) => [`${balance.branchId}:${balance.productId}`, balance]));

  return groups.map((group) => ({
    ...(group.tracksPackages ? (() => {
      const canonical = group.products.find((member) => member.isCanonical);
      const factor = group.conversionFactorToBase ?? group.products.find((member) => !member.isCanonical)?.conversionFactor ?? new Prisma.Decimal(1);
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
              unitSaleAutomaticallyEnabled: Boolean(group.autoOpenForUnitSale && autoOpenablePackages.gt(0)),
              onlyClosedReserveRemaining: closed.lte(reserve) && loose.eq(0),
            };
          })
        : [];
      return {
        branchStocks,
        totalClosedPackageQuantity: branchStocks.reduce((sum, item) => sum + item.closedPackageQuantity, 0),
        totalLooseUnitQuantity: branchStocks.reduce((sum, item) => sum + item.looseUnitQuantity, 0),
        totalAutoOpenableUnits: branchStocks.reduce((sum, item) => sum + item.autoOpenableUnitsTotal, 0),
        totalEquivalentBaseQuantity: branchStocks.reduce((sum, item) => sum + item.equivalentBaseQuantity, 0),
        displayConversionFactor: Number(factor),
      };
    })() : {
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
  const conversionFactorToBase = input.conversionFactorToBase ?? input.members.find((member) => !member.isCanonical)?.conversionFactor ?? null;
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
        conversionFactorToBase: conversionFactorToBase === null ? null : new Prisma.Decimal(conversionFactorToBase),
        tracksPackages: Boolean(input.tracksPackages),
        approximateFactor: Boolean(input.approximateFactor),
        minimumClosedPackageReserve: new Prisma.Decimal(minimumClosedPackageReserve),
        autoOpenForUnitSale: input.tracksPackages ? input.autoOpenForUnitSale ?? true : false,
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
          isPackagePresentation: Boolean(member.isPackagePresentation || (!member.isCanonical && input.tracksPackages)),
        },
      });
    }

    // ── Migrar balances existentes al producto canónico ─────────────────────
    // Cada producto miembro puede tener stock propio antes de la fusión.
    // Convertimos todo a unidades base (factor del canónico = 1) y lo
    // consolidamos en el balance del canónico. Los no-canónicos quedan en 0
    // porque a partir de ahora el sistema lee siempre desde el canónico.
    const productIds = input.members.map((m) => m.productId);
    const existingBalances = await tx.inventoryBalance.findMany({
      where: { productId: { in: productIds } },
      select: { branchId: true, productId: true, quantityOnHand: true, weightedAverageCost: true },
    });

    const affectedBranchIds = [...new Set(existingBalances.map((b) => b.branchId))];

    for (const branchId of affectedBranchIds) {
      let totalBaseQty = new Prisma.Decimal(0);
      let weightedCostNumerator = new Prisma.Decimal(0);

      for (const member of input.members) {
        const balance = existingBalances.find((b) => b.branchId === branchId && b.productId === member.productId);
        if (!balance || balance.quantityOnHand.lte(0)) continue;

        const factor = new Prisma.Decimal(member.conversionFactor);
        // Convert qty to base units: qty_quintal × 14 = qty_varilla
        const baseQty = balance.quantityOnHand.mul(factor);
        // Convert WAC to per-base-unit: wac_quintal / 14 = wac_varilla
        const wacPerBase = balance.weightedAverageCost.gt(0)
          ? balance.weightedAverageCost.div(factor)
          : new Prisma.Decimal(0);

        totalBaseQty = totalBaseQty.add(baseQty);
        weightedCostNumerator = weightedCostNumerator.add(baseQty.mul(wacPerBase));
      }

      const newWac = totalBaseQty.gt(0)
        ? weightedCostNumerator.div(totalBaseQty)
        : new Prisma.Decimal(0);

      // Consolidar todo en el canónico
      await tx.inventoryBalance.upsert({
        where: { branchId_productId: { branchId, productId: canonical.productId } },
        create: {
          branchId,
          productId: canonical.productId,
          quantityOnHand: totalBaseQty,
          weightedAverageCost: newWac,
          inventoryValue: totalBaseQty.mul(newWac),
        },
        update: {
          quantityOnHand: totalBaseQty,
          weightedAverageCost: newWac,
          inventoryValue: totalBaseQty.mul(newWac),
        },
      });

      // Poner a cero los no-canónicos (su stock pasó al canónico)
      const nonCanonicalIds = input.members.filter((m) => !m.isCanonical).map((m) => m.productId);
      if (nonCanonicalIds.length > 0) {
        await tx.inventoryBalance.updateMany({
          where: { branchId, productId: { in: nonCanonicalIds } },
          data: { quantityOnHand: 0, weightedAverageCost: 0, inventoryValue: 0 },
        });
      }
    }

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
    if (typeof input.packageUnit !== "undefined") data.packageUnit = input.packageUnit?.trim().toUpperCase() || null;
    if (typeof input.conversionFactorToBase !== "undefined") {
      data.conversionFactorToBase = input.conversionFactorToBase === null ? null : new Prisma.Decimal(input.conversionFactorToBase);
    }
    if (typeof input.tracksPackages === "boolean") data.tracksPackages = input.tracksPackages;
    if (typeof input.approximateFactor === "boolean") data.approximateFactor = input.approximateFactor;
    if (typeof input.minimumClosedPackageReserve !== "undefined") {
      data.minimumClosedPackageReserve = new Prisma.Decimal(input.minimumClosedPackageReserve ?? 1);
    }
    if (typeof input.autoOpenForUnitSale === "boolean") data.autoOpenForUnitSale = input.autoOpenForUnitSale;

    if (input.members) {
      const canonical = validateMembers(input.members);
      validatePackageSettings({
        tracksPackages: input.tracksPackages ?? current.tracksPackages,
        packageUnit: input.packageUnit ?? current.packageUnit,
        conversionFactorToBase: input.conversionFactorToBase ?? (current.conversionFactorToBase ? Number(current.conversionFactorToBase) : null),
        minimumClosedPackageReserve: input.minimumClosedPackageReserve ?? Number(current.minimumClosedPackageReserve),
        members: input.members,
      });
      data.baseUnit = canonical.saleUnit.trim();
      await assertProductsAvailable(tx, input.members, id);

      // Desactivar miembros que ya no estén en la lista; upsert del resto.
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
            isPackagePresentation: Boolean(member.isPackagePresentation || (!member.isCanonical && (input.tracksPackages ?? current.tracksPackages))),
          },
          update: {
            saleUnit: member.saleUnit.trim(),
            conversionFactor: new Prisma.Decimal(member.conversionFactor),
            isCanonical: member.isCanonical,
            isPackagePresentation: Boolean(member.isPackagePresentation || (!member.isCanonical && (input.tracksPackages ?? current.tracksPackages))),
            isActive: true,
          },
        });
      }
    }

    return tx.productStockGroup.update({ where: { id }, data });
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
    const current = await tx.productStockGroup.findUnique({ where: { id } });
    if (!current) throw new Error("NOT_FOUND: Fusión no encontrada.");

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

function normalizedName(value: string) {
  return value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toUpperCase()
    .replace(/\s+/g, " ")
    .trim();
}

function isKiloNailProduct(product: { name: string; sku: string; unit: string }) {
  const name = normalizedName(`${product.sku} ${product.name} ${product.unit}`);
  return name.includes("CLAVO") && name.includes("ACERO") && (name.includes(" KILO ") || name.includes("KILO CLAVO") || product.unit.toUpperCase() === "KILO");
}

function isLooseNailProduct(product: { name: string; sku: string; unit: string }) {
  const name = normalizedName(`${product.sku} ${product.name} ${product.unit}`);
  return name.includes("CLAVO") && name.includes("ACERO") && (name.includes(" UD") || name.includes("UNIDAD") || product.unit.toUpperCase() === "UNIDAD");
}

export async function normalizeNailStockGroups(actorUserId: string) {
  const [products, branches] = await Promise.all([
    prisma.product.findMany({
      where: {
        isActive: true,
        OR: [
          { name: { contains: "CLAVO", mode: "insensitive" } },
          { sku: { contains: "CLV", mode: "insensitive" } },
        ],
      },
      select: { id: true, sku: true, name: true, unit: true, categoryId: true },
      orderBy: { sku: "asc" },
    }),
    prisma.branch.findMany({
      where: { isActive: true },
      select: { id: true, code: true, name: true },
      orderBy: { code: "asc" },
    }),
  ]);

  const results = [];

  for (const preset of NAIL_PACKAGE_PRESETS) {
    const matching = products.filter((product) => detectNailPackagePreset(product.name)?.key === preset.key);
    const packageProduct = matching.find(isKiloNailProduct);
    const looseProduct = matching.find(isLooseNailProduct);
    if (!packageProduct || !looseProduct) {
      results.push({ preset: preset.key, status: "SKIPPED", reason: "PAIR_NOT_FOUND" });
      continue;
    }

    const group = await prisma.$transaction(async (tx) => {
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
        throw new Error(`VALIDATION_ERROR: Los productos de ${preset.label} pertenecen a fusiones activas distintas.`);
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

      const migratedBranches = [];
      for (const branch of branches) {
        const existingAudit = await tx.auditLog.findFirst({
          where: {
            branchId: branch.id,
            module: "inventory",
            action: "NAIL_STOCK_GROUP_NORMALIZED",
            entityType: "ProductStockGroup",
            entityId: normalizedGroup.id,
          },
          select: { id: true },
        });
        if (existingAudit) continue;

        const [packageBalance, looseBalance] = await Promise.all([
          tx.inventoryBalance.findUnique({
            where: { branchId_productId: { branchId: branch.id, productId: packageProduct.id } },
          }),
          tx.inventoryBalance.findUnique({
            where: { branchId_productId: { branchId: branch.id, productId: looseProduct.id } },
          }),
        ]);
        const closedPackageQuantity = packageBalance?.closedPackageQuantity.gt(0)
          ? packageBalance.closedPackageQuantity
          : packageBalance?.quantityOnHand ?? new Prisma.Decimal(0);
        const looseUnitQuantity = looseBalance?.looseUnitQuantity.gt(0)
          ? looseBalance.looseUnitQuantity
          : looseBalance?.quantityOnHand ?? new Prisma.Decimal(0);
        const equivalentBaseQuantity = closedPackageQuantity.mul(preset.factor).add(looseUnitQuantity);
        const weightedAverageCost = looseBalance?.weightedAverageCost
          ?? (packageBalance?.weightedAverageCost ? packageBalance.weightedAverageCost.div(preset.factor) : new Prisma.Decimal(0));

        await tx.inventoryBalance.upsert({
          where: { branchId_productId: { branchId: branch.id, productId: looseProduct.id } },
          create: {
            branchId: branch.id,
            productId: looseProduct.id,
            quantityOnHand: equivalentBaseQuantity,
            closedPackageQuantity,
            looseUnitQuantity,
            weightedAverageCost,
            inventoryValue: equivalentBaseQuantity.mul(weightedAverageCost),
          },
          update: {
            quantityOnHand: equivalentBaseQuantity,
            closedPackageQuantity,
            looseUnitQuantity,
            weightedAverageCost,
            inventoryValue: equivalentBaseQuantity.mul(weightedAverageCost),
          },
        });

        await tx.auditLog.create({
          data: {
            actorUserId,
            branchId: branch.id,
            module: "inventory",
            action: "NAIL_STOCK_GROUP_NORMALIZED",
            entityType: "ProductStockGroup",
            entityId: normalizedGroup.id,
            metadataJson: {
              preset: preset.key,
              packageProductId: packageProduct.id,
              looseProductId: looseProduct.id,
              factor: preset.factor,
              closedPackageQuantity: closedPackageQuantity.toString(),
              looseUnitQuantity: looseUnitQuantity.toString(),
              equivalentBaseQuantity: equivalentBaseQuantity.toString(),
            },
          },
        });
        migratedBranches.push(branch.code);
      }

      return { ...normalizedGroup, migratedBranches };
    });

    results.push({
      preset: preset.key,
      status: "NORMALIZED",
      stockGroupId: group.id,
      code: group.code,
      packageProductId: packageProduct.id,
      looseProductId: looseProduct.id,
      migratedBranches: group.migratedBranches,
    });
  }

  return { results };
}
