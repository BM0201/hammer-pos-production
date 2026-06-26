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
import {
  previewEquivalentStockGroupMigrationTx,
  applyEquivalentStockGroupMigrationTx,
  type BranchMigrationPreview,
} from "@/modules/catalog/equivalent-stock-migration";

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
  existingConversionFactor: number | null;
  isCanonical: boolean;
  alreadyGrouped: boolean;
  factorMismatch: boolean;
};

function ironGroupName(code: string) {
  // Code format: HIERRO_<gauge>_<variant> or HIERRO_<gauge>
  // gauge: 1_2, 3_8, 1_4  →  1/2, 3/8, 1/4
  const withoutPrefix = code.replace("HIERRO_", "");
  // First two segments are always the gauge (e.g., "1_2", "3_8", "1_4")
  const gaugeCodes: Record<string, string> = { "1_2": "1/2", "3_8": "3/8", "1_4": "1/4" };
  const gaugeKey = withoutPrefix.match(/^(\d_\d)/)?.[1];
  const gauge = gaugeKey ? (gaugeCodes[gaugeKey] ?? gaugeKey.replace("_", "/")) : withoutPrefix.replace(/_/g, "/");
  const variantSuffix = gaugeKey ? withoutPrefix.slice(gaugeKey.length).replace(/^_/, "") : "";
  const variantLabel = variantSuffix
    ? ` ${variantSuffix.replace(/_/g, ".").replace("STD", "STD").replace("SEMI", "Semi-STD")}`
    : "";
  return `Hierro ${gauge}"${variantLabel} - stock compartido`;
}

export async function bootstrapIronStockGroups(input: BootstrapIronInput) {
  const products = await prisma.product.findMany({
    where: { isActive: true, name: { contains: "HIERRO" } },
    select: {
      id: true,
      sku: true,
      name: true,
      categoryId: true,
      stockGroupMemberships: {
        where: { isActive: true },
        select: { id: true, conversionFactor: true, stockGroupId: true },
      },
    },
    orderBy: { name: "asc" },
  });

  const candidates: IronCandidate[] = products.flatMap((product) => {
    const groupCode = ironStockGroupCode(product.name);
    const saleUnit = detectIronSaleUnit(product.name);
    const barsPerQuintal = getIronBarsPerQuintal(product.name);
    if (!groupCode || !saleUnit || !barsPerQuintal) return [];
    const nameFactor = saleUnit === "VARILLA" ? 1 : barsPerQuintal;
    const existingMember = product.stockGroupMemberships[0];
    const existingConversionFactor = existingMember ? Number(existingMember.conversionFactor) : null;
    return [{
      productId: product.id,
      sku: product.sku,
      name: product.name,
      categoryId: product.categoryId,
      groupCode,
      groupName: ironGroupName(groupCode),
      saleUnit,
      conversionFactor: nameFactor,
      existingConversionFactor,
      isCanonical: saleUnit === "VARILLA",
      alreadyGrouped: product.stockGroupMemberships.length > 0,
      factorMismatch: existingConversionFactor !== null && existingConversionFactor !== nameFactor,
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
      existingConversionFactor: row.existingConversionFactor,
      factorMismatch: row.factorMismatch,
      isCanonical: row.isCanonical,
      alreadyGrouped: row.alreadyGrouped,
    })),
    factorMismatches: rows.filter((row) => row.factorMismatch).map((row) =>
      `${row.sku}: factor en DB=${row.existingConversionFactor}, detectado por nombre=${row.conversionFactor} (no se sobreescribira en re-bootstrap)`
    ),
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
    let groupsMigrated = 0;
    let groupsNeedingResolution = 0;
    const warnings: string[] = [];
    const conflicts: Array<{ groupCode: string; branches: BranchMigrationPreview[] }> = [];

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

      // Reinterpretación de equivalencia (NO suma): el quintal y la varilla son la
      // MISMA existencia física. Se calcula un preview por sucursal y:
      //   - sin conflicto → se aplica la resolución recomendada
      //     (USE_DERIVED_ONLY: 8 quintales → 112 varillas; o USE_CANONICAL_ONLY).
      //   - con conflicto (ambas presentaciones con stock) → NO se aplica
      //     automáticamente; requiere resolución manual para evitar doble conteo.
      const preview = await previewEquivalentStockGroupMigrationTx(tx, { stockGroupId: group.id });
      if (preview.hasAnyConflict) {
        groupsNeedingResolution += 1;
        const conflictBranches = preview.branches.filter((b) => b.hasConflict);
        conflicts.push({ groupCode: suggestion.groupCode, branches: conflictBranches });
        warnings.push(
          `${suggestion.groupCode}: Hay stock en varilla y quintal (${conflictBranches
            .map((b) => b.branchCode)
            .join(", ")}). Requiere resolución manual para evitar doble conteo.`,
        );
      } else {
        await applyEquivalentStockGroupMigrationTx(tx, {
          stockGroupId: group.id,
          actorUserId: input.actorUserId,
          conflictResolution: "RECOMMENDED",
          reason: `bootstrapIronStockGroups group=${suggestion.groupCode}`,
        });
        groupsMigrated += 1;
      }
    }

    return { groupsUpserted, membersUpserted, groupsMigrated, groupsNeedingResolution, warnings, conflicts };
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
      groupsMigrated: result.groupsMigrated,
      groupsNeedingResolution: result.groupsNeedingResolution,
      warnings: result.warnings,
      note:
        "Equivalencia reinterpretada por sucursal: el quintal se convierte a varillas y queda en cero; " +
        "grupos con stock en ambas presentaciones quedan pendientes de resolución manual (no se sumó).",
    },
  });

  return {
    ok: true,
    applied: true,
    detectedProducts: candidates.length,
    groupsUpserted: result.groupsUpserted,
    membersUpserted: result.membersUpserted,
    groupsMigrated: result.groupsMigrated,
    groupsNeedingResolution: result.groupsNeedingResolution,
    conflicts: result.conflicts,
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
          minimumClosedPackageReserve: new Prisma.Decimal(1),
          autoOpenForUnitSale: true,
          categoryId: suggestion.categoryId,
        },
        update: {
          name: suggestion.groupName,
          baseUnit: suggestion.baseUnit,
          packageUnit: suggestion.packageUnit,
          conversionFactorToBase: new Prisma.Decimal(suggestion.factor),
          tracksPackages: true,
          approximateFactor: true,
          minimumClosedPackageReserve: new Prisma.Decimal(1),
          autoOpenForUnitSale: true,
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
