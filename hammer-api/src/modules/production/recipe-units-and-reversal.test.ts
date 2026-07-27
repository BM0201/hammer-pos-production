import assert from "node:assert/strict";
import test from "node:test";
import { Prisma } from "@prisma/client";
import { validateRecipeInputUnitTx, assertBatchReversible } from "@/modules/production/service";

/**
 * Producción v2 Fase 1.3 — `ProductionRecipeInput.unit` era texto libre
 * nunca verificado contra la unidad de venta real del producto. Una receta
 * cargada con una unidad que no coincide (p.ej. "LIBRA" cuando el producto
 * se vende en "KILO") producía un descuadre silencioso de inventario: el
 * consumo se interpreta SIEMPRE en la unidad de venta propia del producto
 * (así es como createInventoryMovementTx convierte a base internamente).
 */

function createFakeDb(input: { productUnit: string; hasStockGroup?: boolean; stockGroupSaleUnit?: string }) {
  return {
    product: {
      findUnique: async () => ({ unit: input.productUnit, name: "Cemento Canal", sku: "CEM-001" }),
    },
    productStockGroupMember: {
      findFirst: async () =>
        input.hasStockGroup
          ? {
              stockGroupId: "sg-1",
              saleUnit: input.stockGroupSaleUnit,
              conversionFactor: new Prisma.Decimal(1),
              isCanonical: true,
              stockGroup: {
                code: "SG-1",
                name: "Grupo 1",
                baseUnit: "KILO",
                packageUnit: null,
                conversionFactorToBase: null,
                tracksPackages: false,
                approximateFactor: false,
                minimumClosedPackageReserve: new Prisma.Decimal(1),
                autoOpenForUnitSale: true,
                products: [{ productId: "self", isCanonical: true, conversionFactor: new Prisma.Decimal(1) }],
              },
            }
          : null,
    },
  } as unknown as Parameters<typeof validateRecipeInputUnitTx>[0];
}

test("Test de unidades: acepta cuando la unidad de receta coincide con la unidad de venta del producto (sin fusión)", async () => {
  const db = createFakeDb({ productUnit: "KILO" });
  await assert.doesNotReject(() => validateRecipeInputUnitTx(db, { inputProductId: "prod-cemento", unit: "kilo" }));
});

test("Test de unidades: rechaza cuando la unidad de receta NO coincide con la unidad de venta real", async () => {
  const db = createFakeDb({ productUnit: "KILO" });
  await assert.rejects(
    () => validateRecipeInputUnitTx(db, { inputProductId: "prod-cemento", unit: "LIBRA" }),
    /INVALID_INPUT/,
  );
});

test("Test de unidades: usa la unidad de venta del grupo de fusión (saleUnit), no la del producto base", async () => {
  const db = createFakeDb({ productUnit: "VARILLA", hasStockGroup: true, stockGroupSaleUnit: "QUINTAL" });
  await assert.doesNotReject(() => validateRecipeInputUnitTx(db, { inputProductId: "prod-hierro", unit: "quintal" }));
  await assert.rejects(() => validateRecipeInputUnitTx(db, { inputProductId: "prod-hierro", unit: "varilla" }), /INVALID_INPUT/);
});

/**
 * Producción v2 Fase 4 — reversión. Solo un lote COMPLETED puede revertirse;
 * un lote CANCELLED, PLANNED, o ya REVERSED no debe poder revertirse de nuevo
 * (evita duplicar los movimientos inversos).
 */
test("Test de reversión: solo un lote COMPLETED puede revertirse", () => {
  assert.doesNotThrow(() => assertBatchReversible("COMPLETED"));
  assert.throws(() => assertBatchReversible("PLANNED"), /ONLY_COMPLETED_BATCHES_CAN_BE_REVERSED/);
  assert.throws(() => assertBatchReversible("CANCELLED"), /ONLY_COMPLETED_BATCHES_CAN_BE_REVERSED/);
  assert.throws(() => assertBatchReversible("REVERSED"), /ONLY_COMPLETED_BATCHES_CAN_BE_REVERSED/);
  assert.throws(() => assertBatchReversible("DRAFT"), /ONLY_COMPLETED_BATCHES_CAN_BE_REVERSED/);
});
