import assert from "node:assert/strict";
import test from "node:test";
import { Prisma } from "@prisma/client";
import { applyTimberCostsTx, resolveSellingPriceForPolicy } from "@/modules/timber/service";

/**
 * Madera v2 Fase 2 — el bug a matar: resolveTimberProductForLineTx retornaba
 * temprano cuando el producto ya existía, sin actualizar nada. Del segundo
 * viaje en adelante TimberProduct.baseCost/sellingPrice, Product.standardSalePrice
 * y el BranchProductSetting de la sucursal destino quedaban congelados en los
 * valores del primer viaje. applyTimberCostsTx es la función que ahora
 * SIEMPRE escribe los 4 valores — este test prueba exactamente eso: aplicar
 * dos veces con costos distintos sobre el MISMO producto y verificar que la
 * segunda vez pisa completamente a la primera.
 */

const BRANCH_ID = "branch-msy";
const PRODUCT_ID = "prod-mad-tab-1x12x16";
const TIMBER_PRODUCT_ID = "tp-1x12x16";

function createTimberFakeTx(initial: { baseCost: number; sellingPrice: number; standardSalePrice: number; branchCost: number | null; branchPrice: number | null }) {
  const timberProduct = {
    id: TIMBER_PRODUCT_ID,
    productId: PRODUCT_ID,
    timberType: "TABLA",
    boardFeet: new Prisma.Decimal(16),
    baseCost: new Prisma.Decimal(initial.baseCost),
    pricePerInch: new Prisma.Decimal(8.9),
    sellingPrice: new Prisma.Decimal(initial.sellingPrice),
    varaLength: 6,
  };
  const product = { id: PRODUCT_ID, standardSalePrice: new Prisma.Decimal(initial.standardSalePrice) };
  let branchSetting: { branchCost: Prisma.Decimal | null; branchPrice: Prisma.Decimal | null } | null =
    initial.branchCost !== null
      ? { branchCost: new Prisma.Decimal(initial.branchCost), branchPrice: new Prisma.Decimal(initial.branchPrice ?? 0) }
      : null;

  const auditLogs: Array<Record<string, unknown>> = [];

  const tx = {
    product: {
      findUnique: async () => ({ standardSalePrice: product.standardSalePrice }),
      update: async (args: { data: { standardSalePrice: Prisma.Decimal } }) => {
        product.standardSalePrice = args.data.standardSalePrice;
        return product;
      },
    },
    timberProduct: {
      findUnique: async () => ({ baseCost: timberProduct.baseCost, sellingPrice: timberProduct.sellingPrice }),
      update: async (args: { data: Partial<typeof timberProduct> }) => {
        Object.assign(timberProduct, args.data);
        return timberProduct;
      },
    },
    // "revisa todo... para evitar bugs" — applyTimberCostsTx ahora resuelve
    // la conversión de fusión de input.productId antes de escribir el
    // costo (resolveGlobalCostWriteTarget). El producto de este test no
    // está en ninguna fusión — null, el mismo caso que ya maneja
    // getProductStockConversion cuando findFirst no encuentra membresía.
    productStockGroupMember: {
      findFirst: async () => null,
    },
    branchProductSetting: {
      findUnique: async () => branchSetting,
      upsert: async (args: { create: Record<string, unknown>; update: Record<string, unknown> }) => {
        const data = (branchSetting ? args.update : args.create) as { branchCost: Prisma.Decimal; branchPrice: Prisma.Decimal };
        Object.assign(branchSetting ?? (branchSetting = { branchCost: data.branchCost, branchPrice: data.branchPrice }), data);
        return branchSetting;
      },
    },
    auditLog: {
      create: async (args: { data: Record<string, unknown> }) => {
        auditLogs.push(args.data);
        return args.data;
      },
    },
  };

  return {
    tx: tx as unknown as Prisma.TransactionClient,
    getProduct: () => product,
    getTimberProduct: () => timberProduct,
    getBranchSetting: () => branchSetting,
    auditLogs,
  };
}

test("resolveSellingPriceForPolicy: RECALC_FROM_PRICE_PER_INCH usa siempre el precio recalculado", () => {
  const price = resolveSellingPriceForPolicy({
    pricePolicy: "RECALC_FROM_PRICE_PER_INCH",
    recalculatedSellingPrice: 1447.2,
    existingSellingPrice: 640.8,
    costPerPiece: 825.54,
    targetMarginPercent: 0.4,
    targetMarginRoundingMultiple: 1,
  });
  assert.equal(price, 1447.2);
});

test("resolveSellingPriceForPolicy: COST_ONLY conserva el precio existente", () => {
  const price = resolveSellingPriceForPolicy({
    pricePolicy: "COST_ONLY",
    recalculatedSellingPrice: 1447.2,
    existingSellingPrice: 640.8,
    costPerPiece: 825.54,
    targetMarginPercent: 0.4,
    targetMarginRoundingMultiple: 1,
  });
  assert.equal(price, 640.8);
});

test("resolveSellingPriceForPolicy: TARGET_MARGIN garantiza el margen objetivo redondeando hacia arriba", () => {
  const price = resolveSellingPriceForPolicy({
    pricePolicy: "TARGET_MARGIN",
    recalculatedSellingPrice: 640.8,
    existingSellingPrice: 640.8,
    costPerPiece: 825.54,
    targetMarginPercent: 0.4,
    targetMarginRoundingMultiple: 1,
  });
  // 825.54 / (1-0.4) = 1375.90 -> redondeado hacia arriba al entero = 1376
  assert.equal(price, 1376);
  const margin = (price - 825.54) / price;
  assert.ok(margin >= 0.4, `el margen resultante (${margin}) debe ser >= 40%`);
});

test("Test de inyeccion — segundo viaje con costo distinto pisa TODOS los valores del primero", async () => {
  // Primer viaje: producto recien creado a C$320/pieza, venta C$640.80 (costo C$20/pie).
  const { tx, getProduct, getTimberProduct, getBranchSetting, auditLogs } = createTimberFakeTx({
    baseCost: 320,
    sellingPrice: 640.8,
    standardSalePrice: 640.8,
    branchCost: 320,
    branchPrice: 640.8,
  });

  // Segundo viaje: mismo producto, costo aterrizado bien distinto (C$825.54/pieza, C$49/pie + gastos).
  const result = await applyTimberCostsTx(tx, {
    actorUserId: "user-1",
    branchId: BRANCH_ID,
    productId: PRODUCT_ID,
    timberProductId: TIMBER_PRODUCT_ID,
    priceGroup: "TABLA",
    boardFeet: 16,
    pricePerInch: 8.9,
    varaLength: 6,
    costPerPiece: 825.54,
    recalculatedSellingPrice: 1447.2,
    pricePolicy: "RECALC_FROM_PRICE_PER_INCH",
    targetMarginPercent: 0.4,
    targetMarginRoundingMultiple: 1,
  });

  // El bug real: ANTES de este fix, estos 4 valores se quedaban en 320/640.80 para siempre.
  assert.equal(getTimberProduct().baseCost.toNumber(), 825.54, "TimberProduct.baseCost debe actualizarse");
  assert.equal(getTimberProduct().sellingPrice.toNumber(), 1447.2, "TimberProduct.sellingPrice debe actualizarse");
  assert.equal(getProduct().standardSalePrice.toNumber(), 1447.2, "Product.standardSalePrice debe actualizarse");
  assert.equal(getBranchSetting()?.branchCost?.toNumber(), 825.54, "BranchProductSetting.branchCost debe actualizarse");
  assert.equal(getBranchSetting()?.branchPrice?.toNumber(), 1447.2, "BranchProductSetting.branchPrice debe actualizarse");

  // Antes/después correctos en el resultado y en auditoría.
  assert.equal(result.before.baseCost, 320);
  assert.equal(result.after.baseCost, 825.54);
  assert.equal(result.before.sellingPrice, 640.8);
  assert.equal(result.after.sellingPrice, 1447.2);
  assert.equal(auditLogs.length, 1);
  const logged = auditLogs[0].metadataJson as { before: { baseCost: number }; after: { baseCost: number } };
  assert.equal(logged.before.baseCost, 320);
  assert.equal(logged.after.baseCost, 825.54);
});

test("Test de inyeccion — producto nuevo (sin BranchProductSetting previo) crea el registro con costo/precio correctos", async () => {
  const { tx, getBranchSetting } = createTimberFakeTx({
    baseCost: 0,
    sellingPrice: 0,
    standardSalePrice: 0,
    branchCost: null,
    branchPrice: null,
  });

  await applyTimberCostsTx(tx, {
    actorUserId: "user-1",
    branchId: BRANCH_ID,
    productId: PRODUCT_ID,
    timberProductId: TIMBER_PRODUCT_ID,
    priceGroup: "TABLA",
    boardFeet: 16,
    pricePerInch: 8.9,
    varaLength: 6,
    costPerPiece: 320,
    recalculatedSellingPrice: 640.8,
    pricePolicy: "RECALC_FROM_PRICE_PER_INCH",
    targetMarginPercent: 0.4,
    targetMarginRoundingMultiple: 1,
  });

  assert.equal(getBranchSetting()?.branchCost?.toNumber(), 320);
  assert.equal(getBranchSetting()?.branchPrice?.toNumber(), 640.8);
});

/**
 * "revisa todo... para evitar bugs" — applyTimberCostsTx escribía
 * branchCost SIEMPRE en input.productId, incluso si ese producto de
 * madera es un miembro DERIVADO de una fusión (nada lo impide) —
 * resolveEffectivePricing ignora el branchCost propio de un derivado. El
 * precio (standardSalePrice/branchPrice) se queda siempre en
 * input.productId — los precios de venta por presentación son
 * individuales, nunca se redirigen.
 */
const TIMBER_CANONICAL_ID = "prod-tabla-1x12";
const TIMBER_DERIVED_ID = "prod-tabla-1x12-atado"; // 1 atado = 10 tablas

test("Prueba LA QUE IMPORTA — producto de madera derivado de una fusión: el costo va al canónico, convertido por el factor", async () => {
  const { tx, getBranchSetting, getProduct } = createTimberFakeTx({
    baseCost: 320, sellingPrice: 640.8, standardSalePrice: 640.8, branchCost: 320, branchPrice: 640.8,
  });
  const canonicalSetting: { branchCost: Prisma.Decimal | null } = { branchCost: null };
  const fakeTx = tx as unknown as {
    branchProductSetting: { upsert: (args: { where: { branchId_productId: { productId: string } }; create: Record<string, unknown>; update: Record<string, unknown> }) => Promise<unknown> };
    productStockGroupMember: { findFirst: () => Promise<unknown> };
  };
  fakeTx.productStockGroupMember.findFirst = async () => ({
    stockGroupId: "sg-tabla", isActive: true, isCanonical: false, conversionFactor: new Prisma.Decimal(10), saleUnit: "ATADO", isPackagePresentation: false,
    stockGroup: {
      isActive: true, code: "TABLA-GRP", name: "Tabla 1x12", baseUnit: "TABLA", packageUnit: null, conversionFactorToBase: null,
      tracksPackages: false, approximateFactor: false, minimumClosedPackageReserve: new Prisma.Decimal(1), autoOpenForUnitSale: true,
      products: [
        { productId: TIMBER_CANONICAL_ID, isCanonical: true, conversionFactor: new Prisma.Decimal(1) },
        { productId: TIMBER_DERIVED_ID, isCanonical: false, conversionFactor: new Prisma.Decimal(10) },
      ],
    },
  });
  const originalUpsert = fakeTx.branchProductSetting.upsert.bind(fakeTx.branchProductSetting);
  fakeTx.branchProductSetting.upsert = async (args) => {
    if (args.where.branchId_productId.productId === TIMBER_CANONICAL_ID) {
      const data = (canonicalSetting.branchCost === null ? args.create : args.update) as { branchCost: Prisma.Decimal };
      canonicalSetting.branchCost = data.branchCost;
      return canonicalSetting;
    }
    return originalUpsert(args);
  };

  await applyTimberCostsTx(tx, {
    actorUserId: "user-1",
    branchId: BRANCH_ID,
    productId: TIMBER_DERIVED_ID,
    timberProductId: TIMBER_PRODUCT_ID,
    priceGroup: "TABLA",
    boardFeet: 16,
    pricePerInch: 8.9,
    varaLength: 6,
    costPerPiece: 3000, // costo del ATADO completo (10 tablas)
    recalculatedSellingPrice: 5000,
    pricePolicy: "COST_ONLY",
    targetMarginPercent: 0.4,
    targetMarginRoundingMultiple: 1,
  });

  assert.equal(canonicalSetting.branchCost?.toNumber(), 300, "3000 / 10 = 300 — el costo real por tabla, en el canónico");
  assert.equal(getBranchSetting()?.branchCost?.toNumber() ?? null, 320, "el derivado NUNCA guarda su propio costo — sigue con el valor viejo, no 3000");
  assert.equal(getProduct().standardSalePrice.toNumber(), 640.8, "el precio de venta se queda en el producto (derivado) — COST_ONLY, sin tocar");
});
