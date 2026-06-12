import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { logAuditEvent } from "@/modules/audit/service";

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
