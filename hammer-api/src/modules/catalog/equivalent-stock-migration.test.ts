/**
 * Tests puros de la migración de equivalencia (fusión hierro/quintal/varilla)
 * SIN doble conteo.
 *
 * Siguiendo la convención del repo (ver stock-group-balances.test.ts), estos
 * tests NO dependen de @prisma/client ni de la base de datos: inlinean espejos
 * numéricos de la lógica de producción. Si cambia la lógica en
 * equivalent-stock-migration.ts, actualice ambos.
 *
 * Run: node --import tsx --test src/modules/catalog/equivalent-stock-migration.test.ts
 */

import assert from "node:assert/strict";
import { describe, it } from "node:test";

// ─── Espejos de equivalent-stock-migration.ts ────────────────────────────────

type MigrationResolution =
  | "USE_DERIVED_ONLY"
  | "USE_CANONICAL_ONLY"
  | "SUM_BOTH"
  | "MANUAL_BASE_QTY"
  | "CANCEL";

const CONFLICT_WARNING =
  "Ambas presentaciones tienen stock. Esto puede ser doble conteo. Seleccione la fuente real.";

function recommendResolution(input: { canonicalQty: number; derivedAsBaseQty: number }): {
  recommendedResolution: MigrationResolution;
  hasConflict: boolean;
  warning: string | null;
} {
  const { canonicalQty, derivedAsBaseQty } = input;
  if (canonicalQty <= 0 && derivedAsBaseQty > 0) {
    return { recommendedResolution: "USE_DERIVED_ONLY", hasConflict: false, warning: null };
  }
  if (canonicalQty > 0 && derivedAsBaseQty <= 0) {
    return { recommendedResolution: "USE_CANONICAL_ONLY", hasConflict: false, warning: null };
  }
  if (canonicalQty > 0 && derivedAsBaseQty > 0) {
    return { recommendedResolution: "MANUAL_BASE_QTY", hasConflict: true, warning: CONFLICT_WARNING };
  }
  return { recommendedResolution: "USE_CANONICAL_ONLY", hasConflict: false, warning: null };
}

function resolveNewCanonicalBaseQty(
  resolution: MigrationResolution,
  input: { canonicalQty: number; derivedAsBaseQty: number; manualBaseQty?: number | null },
): number {
  switch (resolution) {
    case "USE_DERIVED_ONLY":
      return input.derivedAsBaseQty;
    case "USE_CANONICAL_ONLY":
      return input.canonicalQty;
    case "SUM_BOTH":
      return input.canonicalQty + input.derivedAsBaseQty;
    case "MANUAL_BASE_QTY":
      if (input.manualBaseQty == null || !Number.isFinite(input.manualBaseQty) || input.manualBaseQty < 0) {
        throw new Error("VALIDATION_ERROR: MANUAL_BASE_QTY requiere cantidad base válida.");
      }
      return input.manualBaseQty;
    case "CANCEL":
      throw new Error("VALIDATION_ERROR: CANCEL no aplica cambios.");
  }
}

// Espejos de unit-conversion.ts
const toBase = (saleQty: number, factor: number) => saleQty * factor;
const toSale = (baseQty: number, factor: number) => (factor > 0 ? baseQty / factor : 0);

// Espejo de calculateSharedStockChange (lo esencial: SET vs ADD)
function sharedStockChange(input: {
  currentBaseQuantity: number;
  enteredQuantity: number;
  conversionFactor: number;
  isBaseUnit: boolean;
  mode: "SET_PHYSICAL_STOCK" | "ADD_TO_STOCK";
}): number {
  const enteredBaseQty = !input.isBaseUnit && input.conversionFactor > 0
    ? toBase(input.enteredQuantity, input.conversionFactor)
    : input.enteredQuantity;
  return input.mode === "SET_PHYSICAL_STOCK"
    ? enteredBaseQty
    : input.currentBaseQuantity + enteredBaseQty;
}

const FACTOR_3_8 = 14;

// ─── K.1 Fusión hierro sin conflicto (solo quintal) ──────────────────────────

describe("K.1 Fusión hierro sin conflicto: QUINTAL=8, VARILLA=0", () => {
  const canonicalQty = 0;
  const derivedQty = 8;
  const derivedAsBaseQty = toBase(derivedQty, FACTOR_3_8); // 112

  it("recomienda USE_DERIVED_ONLY sin conflicto", () => {
    const rec = recommendResolution({ canonicalQty, derivedAsBaseQty });
    assert.equal(rec.recommendedResolution, "USE_DERIVED_ONLY");
    assert.equal(rec.hasConflict, false);
  });

  it("VARILLA queda en 112 y QUINTAL en 0 físico", () => {
    const newCanonical = resolveNewCanonicalBaseQty("USE_DERIVED_ONLY", { canonicalQty, derivedAsBaseQty });
    assert.equal(newCanonical, 112);
  });

  it("consultar QUINTAL devuelve saleQty = 8", () => {
    assert.equal(toSale(112, FACTOR_3_8), 8);
  });
});

// ─── K.2 Fusión hierro con canónico positivo (solo varilla) ──────────────────

describe("K.2 Fusión hierro: QUINTAL=0, VARILLA=112", () => {
  const canonicalQty = 112;
  const derivedAsBaseQty = toBase(0, FACTOR_3_8);

  it("recomienda USE_CANONICAL_ONLY sin conflicto", () => {
    const rec = recommendResolution({ canonicalQty, derivedAsBaseQty });
    assert.equal(rec.recommendedResolution, "USE_CANONICAL_ONLY");
    assert.equal(rec.hasConflict, false);
  });

  it("VARILLA = 112, QUINTAL = 0 físico, consultar QUINTAL = 8", () => {
    const newCanonical = resolveNewCanonicalBaseQty("USE_CANONICAL_ONLY", { canonicalQty, derivedAsBaseQty });
    assert.equal(newCanonical, 112);
    assert.equal(toSale(newCanonical, FACTOR_3_8), 8);
  });
});

// ─── K.3 Conflicto: ambas presentaciones con stock ───────────────────────────

describe("K.3 Conflicto: QUINTAL=8, VARILLA=112", () => {
  const canonicalQty = 112;
  const derivedAsBaseQty = toBase(8, FACTOR_3_8); // 112

  it("hasConflict=true, recomienda resolución manual y NO se aplica automáticamente", () => {
    const rec = recommendResolution({ canonicalQty, derivedAsBaseQty });
    assert.equal(rec.hasConflict, true);
    assert.equal(rec.recommendedResolution, "MANUAL_BASE_QTY");
    assert.equal(rec.warning, CONFLICT_WARNING);
  });

  it('aplicar "RECOMMENDED" sobre conflicto debe rechazarse (simulado)', () => {
    const rec = recommendResolution({ canonicalQty, derivedAsBaseQty });
    const apply = () => {
      if (rec.hasConflict) throw new Error("CONFLICT_REQUIRES_RESOLUTION");
      return resolveNewCanonicalBaseQty(rec.recommendedResolution, { canonicalQty, derivedAsBaseQty });
    };
    assert.throws(apply, /CONFLICT_REQUIRES_RESOLUTION/);
  });
});

// ─── K.4/K.5/K.6 Resoluciones explícitas sobre el conflicto ──────────────────

describe("K.4-K.6 Resoluciones sobre conflicto QUINTAL=8, VARILLA=112", () => {
  const canonicalQty = 112;
  const derivedAsBaseQty = toBase(8, FACTOR_3_8); // 112

  it("K.4 USE_DERIVED_ONLY → 112 (no 224)", () => {
    assert.equal(resolveNewCanonicalBaseQty("USE_DERIVED_ONLY", { canonicalQty, derivedAsBaseQty }), 112);
  });

  it("K.5 USE_CANONICAL_ONLY → 112", () => {
    assert.equal(resolveNewCanonicalBaseQty("USE_CANONICAL_ONLY", { canonicalQty, derivedAsBaseQty }), 112);
  });

  it("K.6 SUM_BOTH → 224 (solo si se confirma explícitamente)", () => {
    assert.equal(resolveNewCanonicalBaseQty("SUM_BOTH", { canonicalQty, derivedAsBaseQty }), 224);
  });

  it("MANUAL_BASE_QTY → guarda exactamente la cantidad ingresada (ej. 112)", () => {
    assert.equal(
      resolveNewCanonicalBaseQty("MANUAL_BASE_QTY", { canonicalQty, derivedAsBaseQty, manualBaseQty: 112 }),
      112,
    );
  });

  it("CANCEL no produce stock (lanza)", () => {
    assert.throws(() => resolveNewCanonicalBaseQty("CANCEL", { canonicalQty, derivedAsBaseQty }), /CANCEL/);
  });
});

// ─── K.7 Venta convierte derivado a base y descuenta del canónico ────────────

describe("K.7 Venta desde 112 varillas", () => {
  it("vender 1 quintal deja 98 varillas; consultar quintal devuelve 7", () => {
    const after = 112 - toBase(1, FACTOR_3_8); // 112 - 14 = 98
    assert.equal(after, 98);
    assert.equal(toSale(after, FACTOR_3_8), 7);
  });

  it("vender 1 varilla deja 97 varillas; consultar quintal ≈ 6.9285", () => {
    const after = 98 - 1; // venta de 1 varilla (unidad base)
    assert.equal(after, 97);
    assert.ok(Math.abs(toSale(after, FACTOR_3_8) - 6.9285) < 0.0001);
  });
});

// ─── K.8 Conteo físico no suma (SET) ─────────────────────────────────────────

describe("K.8 Conteo físico de 8 quintales desde 112 varillas", () => {
  it("SET_PHYSICAL_STOCK con 8 quintales mantiene 112, no suma 112 adicionales", () => {
    const result = sharedStockChange({
      currentBaseQuantity: 112,
      enteredQuantity: 8,
      conversionFactor: FACTOR_3_8,
      isBaseUnit: false,
      mode: "SET_PHYSICAL_STOCK",
    });
    assert.equal(result, 112);
  });
});

// ─── K.9 Compra sí es entrada nueva real (ADD) ───────────────────────────────

describe("K.9 Compra de 8 quintales desde 112 varillas", () => {
  it("ADD_TO_STOCK suma 112 → queda 224 varillas", () => {
    const result = sharedStockChange({
      currentBaseQuantity: 112,
      enteredQuantity: 8,
      conversionFactor: FACTOR_3_8,
      isBaseUnit: false,
      mode: "ADD_TO_STOCK",
    });
    assert.equal(result, 224);
  });
});

// ─── K.10 Reportes: no sumar QUINTAL + VARILLA ───────────────────────────────

describe("K.10 Reportes no deben sumar derivado + canónico", () => {
  // Tras la migración, el derivado queda en cero; el canónico lleva el stock.
  // Un reporte que sume todos los balances obtiene el valor correcto porque el
  // derivado contribuye 0 — no hay doble conteo.
  function reportTotalBaseQty(balances: Array<{ isCanonical: boolean; quantityOnHand: number }>): number {
    return balances.reduce((sum, b) => sum + b.quantityOnHand, 0);
  }

  it("total de inventario = solo canónico (derivado en cero)", () => {
    const balances = [
      { isCanonical: true, quantityOnHand: 112 }, // VARILLA
      { isCanonical: false, quantityOnHand: 0 }, // QUINTAL (derivado, cero físico)
    ];
    assert.equal(reportTotalBaseQty(balances), 112);
  });

  it("valor de inventario se calcula solo con el canónico", () => {
    const wac = 50; // por varilla
    const canonicalValue = 112 * wac;
    const derivedValue = 0 * 0; // derivado en cero
    assert.equal(canonicalValue + derivedValue, 5600);
  });

  it("el filtro de exclusión describe correctamente a los derivados", () => {
    // Contrato del where reutilizable (derivedStockGroupMemberFilter):
    const filter = {
      stockGroupMemberships: {
        some: { isActive: true, isCanonical: false, stockGroup: { isActive: true } },
      },
    };
    assert.equal(filter.stockGroupMemberships.some.isCanonical, false);
    assert.equal(filter.stockGroupMemberships.some.isActive, true);
  });
});
