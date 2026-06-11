import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { logAuditEvent } from "@/modules/audit/service";
import {
  detectNailPackagePreset,
  detectIronSaleUnit,
  getIronBarsPerQuintal,
  ironStockGroupCode,
  NAIL_PACKAGE_PRESETS,
} from "@/modules/inventory/unit-conversion";

type BootstrapIronInput = {
  actorUserId: string;
  apply?: boolean;
};

type IronCandidate = {
  productId: string;
  sku: string;
  name: string;
  categoryId: string;
  groupCode: string;
  groupName: string;
  saleUnit: "VARILLA" | "QUINTAL";
  conversionFactor: number;
  isCanonical: boolean;
  alreadyGrouped: boolean;
};

function ironGroupName(code: string) {
  const measure = code.replace("HIERRO_", "").replace("_", "/");
  return `Hierro ${measure} - stock compartido`;
}

export async function bootstrapIronStockGroups(input: BootstrapIronInput) {
  const products = await prisma.product.findMany({
    where: { isActive: true, name: { contains: "HIERRO" } },
    select: {
      id: true,
      sku: true,
      name: true,
      categoryId: true,
      stockGroupMemberships: { where: { isActive: true }, select: { id: true } },
    },
    orderBy: { name: "asc" },
  });

  const candidates: IronCandidate[] = products.flatMap((product) => {
    const groupCode = ironStockGroupCode(product.name);
    const saleUnit = detectIronSaleUnit(product.name);
    const barsPerQuintal = getIronBarsPerQuintal(product.name);
    if (!groupCode || !saleUnit || !barsPerQuintal) return [];
    return [{
      productId: product.id,
      sku: product.sku,
      name: product.name,
      categoryId: product.categoryId,
      groupCode,
      groupName: ironGroupName(groupCode),
      saleUnit,
      conversionFactor: saleUnit === "VARILLA" ? 1 : barsPerQuintal,
      isCanonical: saleUnit === "VARILLA",
      alreadyGrouped: product.stockGroupMemberships.length > 0,
    }];
  });

  const grouped = new Map<string, IronCandidate[]>();
  for (const candidate of candidates) {
    const rows = grouped.get(candidate.groupCode) ?? [];
    rows.push(candidate);
    grouped.set(candidate.groupCode, rows);
  }

  const suggestions = Array.from(grouped.entries()).map(([groupCode, rows]) => ({
    groupCode,
    groupName: rows[0]?.groupName ?? ironGroupName(groupCode),
    baseUnit: "VARILLA",
    categoryId: rows[0]?.categoryId ?? null,
    products: rows.map((row) => ({
      productId: row.productId,
      sku: row.sku,
      name: row.name,
      saleUnit: row.saleUnit,
      conversionFactor: row.conversionFactor,
      isCanonical: row.isCanonical,
      alreadyGrouped: row.alreadyGrouped,
    })),
    canApply: rows.some((row) => row.saleUnit === "VARILLA") && rows.some((row) => row.saleUnit === "QUINTAL"),
  }));

  if (!input.apply) {
    return {
      ok: true,
      applied: false,
      detectedProducts: candidates.length,
      groups: suggestions,
      warnings: ["Dry run: no se modifico inventario ni catalogo."],
    };
  }

  const result = await prisma.$transaction(async (tx) => {
    let groupsUpserted = 0;
    let membersUpserted = 0;
    const warnings: string[] = [];

    for (const suggestion of suggestions) {
      if (!suggestion.canApply) {
        warnings.push(`${suggestion.groupCode}: falta producto VARILLA o HIERRO en quintal; no se creo grupo.`);
        continue;
      }

      const group = await tx.productStockGroup.upsert({
        where: { code: suggestion.groupCode },
        create: {
          code: suggestion.groupCode,
          name: suggestion.groupName,
          baseUnit: "VARILLA",
          categoryId: suggestion.categoryId,
        },
        update: {
          name: suggestion.groupName,
          baseUnit: "VARILLA",
          categoryId: suggestion.categoryId,
          isActive: true,
        },
      });
      groupsUpserted += 1;

      for (const product of suggestion.products) {
        await tx.productStockGroupMember.updateMany({
          where: {
            productId: product.productId,
            stockGroupId: { not: group.id },
            isActive: true,
          },
          data: { isActive: false, isCanonical: false },
        });
        await tx.productStockGroupMember.upsert({
          where: { stockGroupId_productId: { stockGroupId: group.id, productId: product.productId } },
          create: {
            stockGroupId: group.id,
            productId: product.productId,
            saleUnit: product.saleUnit,
            conversionFactor: new Prisma.Decimal(product.conversionFactor),
            isCanonical: product.isCanonical,
          },
          update: {
            saleUnit: product.saleUnit,
            conversionFactor: new Prisma.Decimal(product.conversionFactor),
            isCanonical: product.isCanonical,
            isActive: true,
          },
        });
        membersUpserted += 1;
      }
    }

    return { groupsUpserted, membersUpserted, warnings };
  });

  await logAuditEvent({
    actorUserId: input.actorUserId,
    module: "catalog",
    action: "IRON_STOCK_GROUP_BOOTSTRAP",
    entityType: "ProductStockGroup",
    entityId: "IRON_STOCK_GROUPS",
    metadataJson: {
      detectedProducts: candidates.length,
      groupsUpserted: result.groupsUpserted,
      membersUpserted: result.membersUpserted,
      warnings: result.warnings,
      note: "No stock quantities were migrated. Inventory remains in canonical base product balances.",
    },
  });

  return {
    ok: true,
    applied: true,
    detectedProducts: candidates.length,
    groupsUpserted: result.groupsUpserted,
    membersUpserted: result.membersUpserted,
    groups: suggestions,
    warnings: result.warnings,
  };
}

function nailGroupCode(key: string) {
  return key.toUpperCase();
}

export async function bootstrapNailStockGroups(input: BootstrapIronInput) {
  const products = await prisma.product.findMany({
    where: { isActive: true, name: { contains: "CLAVO" } },
    select: {
      id: true,
      sku: true,
      name: true,
      unit: true,
      categoryId: true,
      stockGroupMemberships: { where: { isActive: true }, select: { id: true } },
    },
    orderBy: { name: "asc" },
  });

  const suggestions = NAIL_PACKAGE_PRESETS.map((preset) => {
    const rows = products.filter((product) => detectNailPackagePreset(product.name)?.key === preset.key);
    const base = rows.find((product) => product.unit.toUpperCase().includes("UNIDAD") || product.name.toUpperCase().includes(" UD"));
    const packaged = rows.find((product) => product.id !== base?.id && (
      product.unit.toUpperCase().includes("KILO")
      || product.name.toUpperCase().includes("KILO")
      || product.name.toUpperCase().includes("KG")
    ));
    return {
      groupCode: nailGroupCode(preset.key),
      groupName: `${preset.label} - stock compartido / presentaciones`,
      baseUnit: preset.baseUnit,
      packageUnit: preset.packageUnit,
      factor: preset.factor,
      categoryId: base?.categoryId ?? packaged?.categoryId ?? rows[0]?.categoryId ?? null,
      products: rows.map((row) => ({
        productId: row.id,
        sku: row.sku,
        name: row.name,
        saleUnit: row.id === base?.id ? preset.baseUnit : preset.packageUnit,
        conversionFactor: row.id === base?.id ? 1 : preset.factor,
        isCanonical: row.id === base?.id,
        isPackagePresentation: row.id === packaged?.id,
        alreadyGrouped: row.stockGroupMemberships.length > 0,
      })),
      canApply: Boolean(base && packaged),
    };
  });

  if (!input.apply) {
    return {
      ok: true,
      applied: false,
      detectedProducts: products.length,
      groups: suggestions,
      warnings: ["Dry run: no se modifico inventario ni catalogo."],
    };
  }

  const result = await prisma.$transaction(async (tx) => {
    let groupsUpserted = 0;
    let membersUpserted = 0;
    const warnings: string[] = [];

    for (const suggestion of suggestions) {
      if (!suggestion.canApply) {
        warnings.push(`${suggestion.groupCode}: falta producto base UNIDAD o presentacion KILO; no se creo grupo.`);
        continue;
      }

      const group = await tx.productStockGroup.upsert({
        where: { code: suggestion.groupCode },
        create: {
          code: suggestion.groupCode,
          name: suggestion.groupName,
          baseUnit: suggestion.baseUnit,
          packageUnit: suggestion.packageUnit,
          conversionFactorToBase: new Prisma.Decimal(suggestion.factor),
          tracksPackages: true,
          approximateFactor: true,
          categoryId: suggestion.categoryId,
        },
        update: {
          name: suggestion.groupName,
          baseUnit: suggestion.baseUnit,
          packageUnit: suggestion.packageUnit,
          conversionFactorToBase: new Prisma.Decimal(suggestion.factor),
          tracksPackages: true,
          approximateFactor: true,
          categoryId: suggestion.categoryId,
          isActive: true,
        },
      });
      groupsUpserted += 1;

      for (const product of suggestion.products) {
        await tx.productStockGroupMember.updateMany({
          where: {
            productId: product.productId,
            stockGroupId: { not: group.id },
            isActive: true,
          },
          data: { isActive: false, isCanonical: false, isPackagePresentation: false },
        });
        await tx.productStockGroupMember.upsert({
          where: { stockGroupId_productId: { stockGroupId: group.id, productId: product.productId } },
          create: {
            stockGroupId: group.id,
            productId: product.productId,
            saleUnit: product.saleUnit,
            conversionFactor: new Prisma.Decimal(product.conversionFactor),
            isCanonical: product.isCanonical,
            isPackagePresentation: product.isPackagePresentation,
          },
          update: {
            saleUnit: product.saleUnit,
            conversionFactor: new Prisma.Decimal(product.conversionFactor),
            isCanonical: product.isCanonical,
            isPackagePresentation: product.isPackagePresentation,
            isActive: true,
          },
        });
        membersUpserted += 1;
      }
    }

    return { groupsUpserted, membersUpserted, warnings };
  });

  await logAuditEvent({
    actorUserId: input.actorUserId,
    module: "catalog",
    action: "NAIL_STOCK_GROUP_BOOTSTRAP",
    entityType: "ProductStockGroup",
    entityId: "NAIL_STOCK_GROUPS",
    metadataJson: {
      detectedProducts: products.length,
      groupsUpserted: result.groupsUpserted,
      membersUpserted: result.membersUpserted,
      warnings: result.warnings,
      note: "Clavos usan stock cerrado/suelto con factor aproximado por movimiento.",
    },
  });

  return {
    ok: true,
    applied: true,
    detectedProducts: products.length,
    groupsUpserted: result.groupsUpserted,
    membersUpserted: result.membersUpserted,
    groups: suggestions,
    warnings: result.warnings,
  };
}
