import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { Prisma } from "@prisma/client";
import {
  canonicalizePresentationUnit,
  findDuplicateFactors,
  findUnitCollisions,
  normalizePresentationUnit,
} from "@/modules/catalog/presentation-units";
import { validateMembers } from "@/modules/catalog/stock-group-crud";
import { checkStockGroupHealth } from "@/modules/catalog/stock-group-health";

/**
 * Reescritura de la capa de presentaciones de fusión — pruebas de la Fase 1
 * (backend). El bug de origen: una fusión triple de piedrín quedó con las
 * tres presentaciones en saleUnit="UNIDAD" porque nada impedía guardarla así.
 */

// ── Test 1: dos miembros en la misma unidad — rechaza nombrando la unidad ──

describe("Test 1: validateMembers rechaza dos miembros con saleUnit idéntico", () => {
  it('dos miembros en "UNIDAD" — VALIDATION_ERROR nombrando la unidad repetida', () => {
    assert.throws(
      () => validateMembers([
        { productId: "p1", saleUnit: "UNIDAD", conversionFactor: 1, isCanonical: true },
        { productId: "p2", saleUnit: "UNIDAD", conversionFactor: 5, isCanonical: false },
      ]),
      (error: unknown) => {
        const message = (error as Error).message;
        return message.startsWith("VALIDATION_ERROR") && message.includes("UNIDAD");
      },
    );
  });
});

// ── Test 2: "Lata" vs "LATA" — comparación normalizada ──────────────────────

describe("Test 2: validateMembers normaliza antes de comparar", () => {
  it('"Lata" y "LATA" colisionan igual que dos "LATA" literales', () => {
    assert.throws(
      () => validateMembers([
        { productId: "p1", saleUnit: "Lata", conversionFactor: 1, isCanonical: true },
        { productId: "p2", saleUnit: "LATA", conversionFactor: 8, isCanonical: false },
      ]),
      /VALIDATION_ERROR/,
    );
  });

  it("acentos y espacios múltiples también normalizan igual", () => {
    assert.equal(normalizePresentationUnit("Metro Cúbico"), normalizePresentationUnit("METRO  CUBICO"));
  });
});

// ── Test 3: LATA / PALADA / METRO con factores distintos — pasa ────────────

describe("Test 3: validateMembers acepta unidades distintas", () => {
  it("LATA (base) / PALADA factor 8 / METRO factor 176 — no lanza", () => {
    assert.doesNotThrow(() => validateMembers([
      { productId: "p-lata", saleUnit: "LATA", conversionFactor: 1, isCanonical: true },
      { productId: "p-palada", saleUnit: "PALADA", conversionFactor: 8, isCanonical: false },
      { productId: "p-metro", saleUnit: "METRO", conversionFactor: 176, isCanonical: false },
    ]));
  });
});

// ── Test 4: findDuplicateFactors ────────────────────────────────────────────

describe("Test 4: findDuplicateFactors", () => {
  it("dos derivados con factor 5 se reportan; el canónico en factor 1 nunca se reporta", () => {
    const dups = findDuplicateFactors([
      { productId: "p-base", conversionFactor: 1, isCanonical: true },
      { productId: "p-palada", conversionFactor: 5, isCanonical: false },
      { productId: "p-metro", conversionFactor: 5, isCanonical: false },
    ]);
    assert.equal(dups.length, 1);
    assert.equal(dups[0].factor, 5);
    assert.deepEqual(dups[0].productIds.sort(), ["p-metro", "p-palada"]);
  });

  it("factores todos distintos — no reporta nada", () => {
    assert.equal(findDuplicateFactors([
      { productId: "p-base", conversionFactor: 1, isCanonical: true },
      { productId: "p-a", conversionFactor: 8, isCanonical: false },
      { productId: "p-b", conversionFactor: 176, isCanonical: false },
    ]).length, 0);
  });
});

// ── Test 5: checkStockGroupHealth reporta UNIT_COLLISION una sola vez ──────

describe("Test 5: checkStockGroupHealth — colisión de unidad es de DEFINICIÓN, no por sucursal", () => {
  it("un grupo con dos miembros en la misma unidad reporta UNA incidencia UNIT_COLLISION con branchId null", async () => {
    const group = {
      id: "group-piedrin",
      code: "GRP-PIEDRIN",
      tracksPackages: false,
      conversionFactorToBase: null,
      isActive: true,
      products: [
        { productId: "p-lata", isCanonical: true, conversionFactor: new Prisma.Decimal(1), isPackagePresentation: false, saleUnit: "UNIDAD" },
        { productId: "p-palada", isCanonical: false, conversionFactor: new Prisma.Decimal(5), isPackagePresentation: false, saleUnit: "UNIDAD" },
        { productId: "p-metro", isCanonical: false, conversionFactor: new Prisma.Decimal(22), isPackagePresentation: false, saleUnit: "METRO" },
      ],
    };
    const fakeTx = {
      productStockGroup: { findUnique: async () => group },
      inventoryBalance: { findMany: async () => [] },
    } as unknown as Prisma.TransactionClient;

    const result = await checkStockGroupHealth(fakeTx, { stockGroupId: "group-piedrin" });

    assert.equal(result.healthy, false);
    const collisions = result.issues.filter((i) => i.kind === "UNIT_COLLISION");
    assert.equal(collisions.length, 1, "una sola incidencia, no una por sucursal (no depende de balances)");
    assert.equal(collisions[0].branchId, null);
    assert.ok(collisions[0].actual.includes("p-lata") && collisions[0].actual.includes("p-palada"));
  });

  it("un grupo con unidades todas distintas y sin balances no reporta nada — healthy true", async () => {
    const group = {
      id: "group-sano",
      code: "GRP-SANO",
      tracksPackages: false,
      conversionFactorToBase: null,
      isActive: true,
      products: [
        { productId: "p-lata", isCanonical: true, conversionFactor: new Prisma.Decimal(1), isPackagePresentation: false, saleUnit: "LATA" },
        { productId: "p-metro", isCanonical: false, conversionFactor: new Prisma.Decimal(22), isPackagePresentation: false, saleUnit: "METRO" },
      ],
    };
    const fakeTx = {
      productStockGroup: { findUnique: async () => group },
      inventoryBalance: { findMany: async () => [] },
    } as unknown as Prisma.TransactionClient;

    const result = await checkStockGroupHealth(fakeTx, { stockGroupId: "group-sano" });
    assert.equal(result.healthy, true);
    assert.equal(result.issues.length, 0);
  });
});

// ── Test 6: normalización al escribir (canonicalizePresentationUnit) ───────
//
// createStockGroupRowsTx y updateStockGroup llaman exactamente esta función
// —canonicalizePresentationUnit— para saleUnit y baseUnit antes de escribir
// (ver stock-group-crud.ts). Probar la función pura es probar el mismo
// criterio de normalización que se persiste, sin tener que mockear una
// transacción completa de Prisma para una aserción de string.

describe("Test 6: canonicalizePresentationUnit — el criterio que persiste createStockGroupRowsTx/updateStockGroup", () => {
  it('" lata " se normaliza a "LATA"', () => {
    assert.equal(canonicalizePresentationUnit(" lata "), "LATA");
  });

  it('"Metro Cúbico" se normaliza a "METRO CUBICO" (sin acentos, mayúsculas)', () => {
    assert.equal(canonicalizePresentationUnit("Metro Cúbico"), "METRO CUBICO");
  });
});

// ── findUnitCollisions — cobertura directa de la función pura ──────────────

describe("findUnitCollisions", () => {
  it("no colisiona si las unidades son distintas", () => {
    assert.equal(findUnitCollisions([
      { productId: "a", saleUnit: "LATA" },
      { productId: "b", saleUnit: "METRO" },
    ]).length, 0);
  });
});
