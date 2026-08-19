/**
 * Reescritura de la capa de presentaciones de fusión — pruebas 7, 8 y 9 del
 * prompt (frontend, sobre la función REAL, no un espejo — shared-stock-format.ts
 * no tiene dependencias de React/Prisma, así que se puede importar y ejecutar
 * directo bajo `node --import tsx --test`).
 *
 * Ejecutar: npm run test:unit:logic
 */
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { formatSharedStock } from "@/lib/inventory/shared-stock-format";
import type { ProductStockView } from "@/lib/inventory/types";

// ── Test 7: fusión de agregados (sin empaque) — LATA base, METRO derivado ──

describe("Test 7: formatSharedStock — fusión de agregados (LATA / METRO), sin empaque", () => {
  it('base LATA con 53 en stock, presentación METRO factor 22 → "2.41 metros" / "Equivale a 53 latas" / "1 metro = 22 latas"', () => {
    const product: ProductStockView = {
      stockConversion: {
        stockGroupName: "Piedrín",
        baseUnit: "LATA",
        saleUnit: "METRO",
        conversionFactor: 22,
        tracksPackages: false,
        isPackagePresentation: false,
        isCanonical: false,
      },
      sharedStock: {
        baseQuantity: 53,
        saleQuantity: 53 / 22,
        baseUnit: "LATA",
        saleUnit: "METRO",
      },
    };

    const result = formatSharedStock(product);
    assert.ok(result);
    assert.equal(result!.primary, "2.41 metros");
    assert.equal(result!.secondary, "Equivale a 53 latas");
    assert.equal(result!.chip, "1 metro = 22 latas");

    const fullText = `${result!.primary} ${result!.secondary} ${result!.chip}`;
    assert.ok(!/quintal/i.test(fullText), "no debe contener 'quintal'");
    assert.ok(!/varilla/i.test(fullText), "no debe contener 'varilla'");
  });
});

// ── Test 8: el canónico nombra la fusión, nunca "Stock compartido - Stock compartido" ──

describe("Test 8: formatSharedStock sobre el canónico", () => {
  it("el chip nombra la fusión, no repite 'Stock compartido'", () => {
    const product: ProductStockView = {
      stockConversion: {
        stockGroupName: "Piedrín",
        baseUnit: "LATA",
        saleUnit: "LATA",
        conversionFactor: 1,
        tracksPackages: false,
        isPackagePresentation: false,
        isCanonical: true,
      },
      sharedStock: {
        baseQuantity: 53,
        saleQuantity: 53,
        baseUnit: "LATA",
        saleUnit: "LATA",
      },
    };

    const result = formatSharedStock(product);
    assert.ok(result);
    assert.equal(result!.chip, "Unidad base de Piedrín");
    assert.ok(!result!.chip.includes("Stock compartido - Stock compartido"));
    assert.ok(!result!.primary.includes("Stock compartido - Stock compartido"));
    assert.ok(!result!.secondary.includes("Stock compartido - Stock compartido"));
  });
});

// ── Test 9: fusión con empaque (hierro QUINTAL/VARILLA) — las unidades salen del grupo ──

describe("Test 9: formatSharedStock — fusión con empaque, unidades del propio grupo (hierro)", () => {
  it("sigue diciendo quintales/varillas porque son las unidades REALES de este grupo, no porque estén hardcodeadas", () => {
    const product: ProductStockView = {
      stockConversion: {
        stockGroupName: "Hierro 3/8",
        baseUnit: "VARILLA",
        saleUnit: "VARILLA",
        packageUnit: "QUINTAL",
        conversionFactor: 14,
        tracksPackages: true,
        isPackagePresentation: false,
        isCanonical: false,
      },
      sharedStock: {
        baseQuantity: 30,
        saleQuantity: 30,
        baseUnit: "VARILLA",
        saleUnit: "VARILLA",
        packageStock: {
          closedPackageQuantity: 2,
          looseUnitQuantity: 2,
          equivalentBaseQuantity: 30,
          conversionFactor: 14,
          packageUnit: "QUINTAL",
          baseUnit: "VARILLA",
        },
      },
    };

    const result = formatSharedStock(product);
    assert.ok(result);
    assert.match(result!.secondary, /varilla/i);
    assert.match(result!.chip, /quintal/i);
    assert.match(result!.chip, /varilla/i);
  });

  it("una fusión de piedrín con empaque (CAMION/PALADA) no menciona quintal ni varilla — mismo código, otro grupo", () => {
    const product: ProductStockView = {
      stockConversion: {
        stockGroupName: "Piedrín",
        baseUnit: "PALADA",
        saleUnit: "PALADA",
        packageUnit: "CAMION",
        conversionFactor: 100,
        tracksPackages: true,
        isPackagePresentation: false,
        isCanonical: false,
      },
      sharedStock: {
        baseQuantity: 250,
        saleQuantity: 250,
        baseUnit: "PALADA",
        saleUnit: "PALADA",
        packageStock: {
          closedPackageQuantity: 2,
          looseUnitQuantity: 50,
          equivalentBaseQuantity: 250,
          conversionFactor: 100,
          packageUnit: "CAMION",
          baseUnit: "PALADA",
        },
      },
    };

    const result = formatSharedStock(product);
    assert.ok(result);
    const fullText = `${result!.primary} ${result!.secondary} ${result!.chip}`;
    assert.ok(!/quintal/i.test(fullText));
    assert.ok(!/varilla/i.test(fullText));
    assert.match(result!.chip, /camion/i);
  });
});

describe("formatSharedStock — casos base", () => {
  it("sin sharedStock o sin stockConversion, devuelve null", () => {
    assert.equal(formatSharedStock({}), null);
    assert.equal(formatSharedStock({ sharedStock: { baseQuantity: 1, saleQuantity: 1, baseUnit: "LATA", saleUnit: "LATA" } }), null);
  });
});
