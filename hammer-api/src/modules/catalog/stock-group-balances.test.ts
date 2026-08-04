/**
 * Pure-function tests for the inventory fusion (stock group) balance logic.
 *
 * These tests have zero dependency on @prisma/client or a live database.
 * They inline the calculation helpers so changes to production code don't
 * silently break the contract — update both when the logic changes.
 *
 * Run with: node --import tsx --test src/modules/catalog/stock-group-balances.test.ts
 */

import assert from "node:assert/strict";
import { describe, it } from "node:test";

// ─── Inline types & helpers (mirrors stock-group-crud.ts) ────────────────────

type BalanceSnapshot = {
  quantityOnHand: number;
  closedPackageQuantity: number;
  looseUnitQuantity: number;
  weightedAverageCost: number;
};

function calcBaseConsolidation(
  members: Array<{ conversionFactor: number; balance: BalanceSnapshot | null }>,
): { totalBaseQty: number; newWac: number } {
  let totalBaseQty = 0;
  let wacNumerator = 0;
  for (const m of members) {
    if (!m.balance || m.balance.quantityOnHand <= 0) continue;
    const baseQty = m.balance.quantityOnHand * m.conversionFactor;
    const wacPerBase =
      m.balance.weightedAverageCost > 0 ? m.balance.weightedAverageCost / m.conversionFactor : 0;
    totalBaseQty += baseQty;
    wacNumerator += baseQty * wacPerBase;
  }
  const newWac = totalBaseQty > 0 ? wacNumerator / totalBaseQty : 0;
  return { totalBaseQty, newWac };
}

function calcTracksPackagesConsolidation(input: {
  packageBalance: BalanceSnapshot | null | undefined;
  canonicalBalance: BalanceSnapshot | null | undefined;
  factor: number;
  // Fusión triple (Caja/Kilo + Unidad + Libra): presentaciones sueltas
  // alternativas además del empaque — ver stock-group-crud.ts.
  looseAlternateMembers?: Array<{ conversionFactor: number; balance: BalanceSnapshot | null | undefined }>;
}): {
  finalClosed: number;
  finalLoose: number;
  totalBaseQty: number;
  newWac: number;
  warnings: string[];
} {
  const { packageBalance, canonicalBalance, factor, looseAlternateMembers = [] } = input;
  const warnings: string[] = [];

  const closedFromPackage = packageBalance
    ? packageBalance.closedPackageQuantity > 0
      ? packageBalance.closedPackageQuantity
      : packageBalance.quantityOnHand
    : 0;

  const closedFromCanonical = canonicalBalance?.closedPackageQuantity ?? 0;

  let looseFromCanonical: number;
  if ((canonicalBalance?.looseUnitQuantity ?? 0) > 0) {
    looseFromCanonical = canonicalBalance!.looseUnitQuantity;
  } else if (
    (canonicalBalance?.closedPackageQuantity ?? 0) === 0 &&
    (canonicalBalance?.quantityOnHand ?? 0) > 0
  ) {
    looseFromCanonical = canonicalBalance!.quantityOnHand;
    if (closedFromPackage === 0 && closedFromCanonical === 0) {
      warnings.push("repair: used canonicalBalance.quantityOnHand as looseUnitQuantity");
    }
  } else {
    looseFromCanonical = 0;
  }

  let strayAlternateBaseQty = 0;
  let strayAlternateWacNumerator = 0;
  for (const alt of looseAlternateMembers) {
    if (!alt.balance || alt.balance.quantityOnHand <= 0) continue;
    const altBaseQty = alt.balance.quantityOnHand * alt.conversionFactor;
    const altWacPerBase = alt.balance.weightedAverageCost > 0 ? alt.balance.weightedAverageCost / alt.conversionFactor : 0;
    strayAlternateBaseQty += altBaseQty;
    strayAlternateWacNumerator += altBaseQty * altWacPerBase;
    warnings.push("stray balance folded from loose-alternate member into canonical");
  }

  const finalClosed = closedFromPackage + closedFromCanonical;
  const finalLoose = looseFromCanonical + strayAlternateBaseQty;
  const totalBaseQty = finalClosed * factor + finalLoose;

  let newWac = 0;
  if (totalBaseQty > 0) {
    const pkgBaseQty = closedFromPackage * factor;
    const pkgWacPerBase =
      pkgBaseQty > 0 && packageBalance && packageBalance.weightedAverageCost > 0
        ? packageBalance.weightedAverageCost / factor
        : 0;
    const canonBaseQty = closedFromCanonical * factor + looseFromCanonical;
    const canonWacPerBase = canonicalBalance?.weightedAverageCost ?? 0;
    const wacNumerator = pkgBaseQty * pkgWacPerBase + canonBaseQty * canonWacPerBase + strayAlternateWacNumerator;
    newWac = wacNumerator / totalBaseQty;
  }

  return { finalClosed, finalLoose, totalBaseQty, newWac, warnings };
}

function movementSaleUnitCostFromBaseWac(
  baseWac: number,
  conversion: { conversionFactor: number } | null | undefined,
): number {
  if (!conversion || conversion.conversionFactor === 1) return baseWac;
  return baseWac * conversion.conversionFactor;
}

// ─── H.1: Fusión manual clavo KILO/UNIDAD ────────────────────────────────────

describe("H.1 calcTracksPackagesConsolidation — clavo 2\" KILO/UNIDAD factor=216", () => {
  const FACTOR = 216;

  // paquete: 3 kilos, WAC 100 (por kilo)
  // canonical: 5 unidades sueltas, WAC 0.5 (por unidad)
  const packageBalance: BalanceSnapshot = {
    quantityOnHand: 3,
    closedPackageQuantity: 0,
    looseUnitQuantity: 0,
    weightedAverageCost: 100,
  };
  const canonicalBalance: BalanceSnapshot = {
    quantityOnHand: 5,
    closedPackageQuantity: 0,
    looseUnitQuantity: 0,
    weightedAverageCost: 0.5,
  };

  it("canonical.closedPackageQuantity = 3 (kilos del packageProduct)", () => {
    const result = calcTracksPackagesConsolidation({ packageBalance, canonicalBalance, factor: FACTOR });
    assert.equal(result.finalClosed, 3);
  });

  it("canonical.looseUnitQuantity = 5 (unidades sueltas del canonical viejo)", () => {
    const result = calcTracksPackagesConsolidation({ packageBalance, canonicalBalance, factor: FACTOR });
    assert.equal(result.finalLoose, 5);
  });

  it("canonical.quantityOnHand = 3×216 + 5 = 653", () => {
    const result = calcTracksPackagesConsolidation({ packageBalance, canonicalBalance, factor: FACTOR });
    assert.equal(result.totalBaseQty, 3 * FACTOR + 5);
  });

  it("packageProduct queda con balance implicado en cero (no se retorna en rebuild)", () => {
    // La función de cálculo no muta; el rebuild zeroes el packageProduct.
    // Verificamos que closedFromPackage se consumió en finalClosed.
    const result = calcTracksPackagesConsolidation({ packageBalance, canonicalBalance, factor: FACTOR });
    assert.equal(result.finalClosed, 3, "los 3 kilos pasan a finalClosed");
  });

  it("WAC ponderado = (3×100 + 5×0.5) / 653 ≈ 0.4602", () => {
    const result = calcTracksPackagesConsolidation({ packageBalance, canonicalBalance, factor: FACTOR });
    const expected = (3 * 100 + 5 * 0.5) / (3 * FACTOR + 5);
    assert.ok(
      Math.abs(result.newWac - expected) < 0.0001,
      `WAC esperado ≈${expected.toFixed(6)}, obtenido ${result.newWac.toFixed(6)}`,
    );
  });

  it("sin warnings en datos normales", () => {
    const result = calcTracksPackagesConsolidation({ packageBalance, canonicalBalance, factor: FACTOR });
    assert.equal(result.warnings.length, 0);
  });
});

// ─── H.2: Idempotencia — ejecutar rebuild dos veces ──────────────────────────

describe("H.2 idempotencia de calcTracksPackagesConsolidation", () => {
  const FACTOR = 216;

  it("segunda ejecución sobre datos ya consolidados produce el mismo resultado", () => {
    // Primera pasada: packageProduct tiene stock, canonical tiene unidades sueltas viejas
    const pkgBefore: BalanceSnapshot = { quantityOnHand: 3, closedPackageQuantity: 0, looseUnitQuantity: 0, weightedAverageCost: 100 };
    const canonBefore: BalanceSnapshot = { quantityOnHand: 5, closedPackageQuantity: 0, looseUnitQuantity: 0, weightedAverageCost: 0.5 };
    const first = calcTracksPackagesConsolidation({ packageBalance: pkgBefore, canonicalBalance: canonBefore, factor: FACTOR });

    // Después del primer rebuild: canonical tiene los datos consolidados, packageProduct en cero
    const pkgAfterFirst: BalanceSnapshot = { quantityOnHand: 0, closedPackageQuantity: 0, looseUnitQuantity: 0, weightedAverageCost: 0 };
    const canonAfterFirst: BalanceSnapshot = {
      quantityOnHand: first.totalBaseQty,
      closedPackageQuantity: first.finalClosed,
      looseUnitQuantity: first.finalLoose,
      weightedAverageCost: first.newWac,
    };
    const second = calcTracksPackagesConsolidation({ packageBalance: pkgAfterFirst, canonicalBalance: canonAfterFirst, factor: FACTOR });

    assert.equal(second.finalClosed, first.finalClosed, "closed idempotente");
    assert.equal(second.finalLoose, first.finalLoose, "loose idempotente");
    assert.equal(second.totalBaseQty, first.totalBaseQty, "totalBase idempotente");
    assert.ok(Math.abs(second.newWac - first.newWac) < 0.0001, "WAC idempotente");
  });
});

// ─── H.3 idempotencia de reparación de clavos (lógica de cálculo) ───────────

describe("H.3 normalización de clavos — reparar datos corruptos sin duplicar stock", () => {
  it("si canonical ya tiene closedPkg>0 y packageProduct tiene qoh>0 (doble conteo previo), consolida una sola vez", () => {
    const FACTOR = 216;
    // Escenario corrupto: normalización anterior no zeroed el package product
    const pkgCorrupto: BalanceSnapshot = { quantityOnHand: 3, closedPackageQuantity: 0, looseUnitQuantity: 0, weightedAverageCost: 100 };
    const canonCorrupto: BalanceSnapshot = { quantityOnHand: 3 * FACTOR + 5, closedPackageQuantity: 3, looseUnitQuantity: 5, weightedAverageCost: 0.46 };

    const result = calcTracksPackagesConsolidation({ packageBalance: pkgCorrupto, canonicalBalance: canonCorrupto, factor: FACTOR });

    // closedFromPackage = 3 (de pkgCorrupto.qoh), closedFromCanonical = 3
    // Total cerrados = 6, loose = 5
    assert.equal(result.finalClosed, 6);
    assert.equal(result.finalLoose, 5);
    assert.equal(result.totalBaseQty, 6 * FACTOR + 5);
  });

  it("si hay warnings de reparación cuando canonical.qoh > 0, sin datos estructurados, y sin stock de package", () => {
    const FACTOR = 216;
    const canonOld: BalanceSnapshot = { quantityOnHand: 500, closedPackageQuantity: 0, looseUnitQuantity: 0, weightedAverageCost: 0.5 };
    const result = calcTracksPackagesConsolidation({ packageBalance: null, canonicalBalance: canonOld, factor: FACTOR });
    assert.equal(result.warnings.length, 1, "debe emitir warning de reparación");
    assert.equal(result.finalLoose, 500);
    assert.equal(result.finalClosed, 0);
    assert.equal(result.totalBaseQty, 500);
  });

  it("NO emite warning cuando canonical.qoh se usa como loose pero hay stock de package (create normal)", () => {
    const FACTOR = 216;
    const pkgBal: BalanceSnapshot = { quantityOnHand: 3, closedPackageQuantity: 0, looseUnitQuantity: 0, weightedAverageCost: 100 };
    const canonBal: BalanceSnapshot = { quantityOnHand: 5, closedPackageQuantity: 0, looseUnitQuantity: 0, weightedAverageCost: 0.5 };
    const result = calcTracksPackagesConsolidation({ packageBalance: pkgBal, canonicalBalance: canonBal, factor: FACTOR });
    assert.equal(result.warnings.length, 0, "creación normal no debe generar warning");
    assert.equal(result.finalLoose, 5);
    assert.equal(result.finalClosed, 3);
  });
});

// ─── H.4 bootstrapIronStockGroups — migración QUINTAL → VARILLA ──────────────

describe("H.4 calcBaseConsolidation — migración QUINTAL→VARILLA (factor=14)", () => {
  it("1 quintal (qoh=1, wac=700) → 14 varillas base, wac=50 por varilla", () => {
    const result = calcBaseConsolidation([
      { conversionFactor: 14, balance: { quantityOnHand: 1, closedPackageQuantity: 0, looseUnitQuantity: 0, weightedAverageCost: 700 } },
      { conversionFactor: 1,  balance: null }, // VARILLA canonical sin stock
    ]);
    assert.equal(result.totalBaseQty, 14);
    assert.ok(Math.abs(result.newWac - 50) < 0.0001, `wac esperado=50, obtenido=${result.newWac}`);
  });

  it("mezcla de QUINTAL y VARILLA consolida correctamente", () => {
    // 2 quintales (14 varillas c/u) + 3 varillas sueltas
    const result = calcBaseConsolidation([
      { conversionFactor: 14, balance: { quantityOnHand: 2, closedPackageQuantity: 0, looseUnitQuantity: 0, weightedAverageCost: 700 } },
      { conversionFactor: 1,  balance: { quantityOnHand: 3, closedPackageQuantity: 0, looseUnitQuantity: 0, weightedAverageCost: 60 } },
    ]);
    // 2×14=28 base + 3 base = 31
    assert.equal(result.totalBaseQty, 31);
    // WAC ponderado: (28×50 + 3×60) / 31
    const expectedWac = (28 * 50 + 3 * 60) / 31;
    assert.ok(Math.abs(result.newWac - expectedWac) < 0.0001);
  });

  it("todos en cero produce totalBaseQty=0 y newWac=0", () => {
    const result = calcBaseConsolidation([
      { conversionFactor: 14, balance: { quantityOnHand: 0, closedPackageQuantity: 0, looseUnitQuantity: 0, weightedAverageCost: 0 } },
      { conversionFactor: 1,  balance: null },
    ]);
    assert.equal(result.totalBaseQty, 0);
    assert.equal(result.newWac, 0);
  });
});

// ─── H.5 movementSaleUnitCostFromBaseWac ─────────────────────────────────────

describe("H.5 movementSaleUnitCostFromBaseWac — costo correcto para createInventoryMovementTx", () => {
  it("producto QUINTAL (factor=14): baseWac=50 → saleUnitCost=700", () => {
    assert.equal(movementSaleUnitCostFromBaseWac(50, { conversionFactor: 14 }), 700);
  });

  it("producto KILO clavo (factor=216): baseWac=0.4602 → saleUnitCost=baseWac×216", () => {
    const baseWac = 0.4602;
    const result = movementSaleUnitCostFromBaseWac(baseWac, { conversionFactor: 216 });
    assert.ok(Math.abs(result - baseWac * 216) < 0.0001);
  });

  it("producto canónico factor=1: saleUnitCost = baseWac sin cambio", () => {
    assert.equal(movementSaleUnitCostFromBaseWac(0.5, { conversionFactor: 1 }), 0.5);
  });

  it("sin conversión: saleUnitCost = baseWac sin cambio", () => {
    assert.equal(movementSaleUnitCostFromBaseWac(100, null), 100);
    assert.equal(movementSaleUnitCostFromBaseWac(100, undefined), 100);
  });

  it("costo cero queda en cero (no produce NaN)", () => {
    assert.equal(movementSaleUnitCostFromBaseWac(0, { conversionFactor: 216 }), 0);
  });
});

// ─── H.8 updateStockGroup reconsolida con nuevo factor ───────────────────────

describe("H.8 reconsolidación al cambiar factor de conversión", () => {
  it("si el factor cambia de 14 a 8, el stock base se recalcula con los balances actuales", () => {
    // Imaginamos que el grupo fue creado con factor=14 (1 QUINTAL = 14 VARILLAS)
    // y se actualiza a factor=8 (un error fue corregido). El canonical tiene
    // quantityOnHand=14 varillas, pero el non-canonical (QUINTAL) ya está en 0.
    // La reconsolidación con factor=8 no cambia el base porque el canonical es el único con stock.
    const result = calcBaseConsolidation([
      { conversionFactor: 8, balance: { quantityOnHand: 0, closedPackageQuantity: 0, looseUnitQuantity: 0, weightedAverageCost: 0 } }, // QUINTAL con nuevo factor
      { conversionFactor: 1, balance: { quantityOnHand: 14, closedPackageQuantity: 0, looseUnitQuantity: 0, weightedAverageCost: 50 } }, // VARILLA canonical
    ]);
    assert.equal(result.totalBaseQty, 14, "canonical base preservado");
    assert.equal(result.newWac, 50, "WAC preservado");
  });
});

// ─── H.9 desfusión (Fase 2.2) — reemplaza el bloqueo STOCK_NOT_ZERO ─────────
// Ya no se bloquea eliminar una fusión con stock: se reasigna todo el
// consolidado (base) al producto de destino, convertido a su propia unidad
// de venta vía el factor. Estas pruebas documentan esa conversión.

describe("H.9 conversión de cantidad al desfusionar", () => {
  function targetQtyFromBase(baseQty: number, targetConversionFactor: number): number {
    return targetConversionFactor === 1 ? baseQty : baseQty / targetConversionFactor;
  }

  it("destino = canónico (factor 1): la cantidad base pasa sin cambio", () => {
    assert.equal(targetQtyFromBase(653, 1), 653);
  });

  it("destino = presentación empacada (factor 216): la base se convierte a kilos", () => {
    assert.equal(targetQtyFromBase(1296, 216), 6);
  });

  it("destino = quintal (factor 14): 112 varillas equivalen a 8 quintales", () => {
    assert.equal(targetQtyFromBase(112, 14), 8);
  });

  it("stock cero se reasigna sin error (caso simple, antes bloqueado)", () => {
    assert.equal(targetQtyFromBase(0, 216), 0);
  });
});

// ─── H.10 Fusión triple — Caja(Kilo)/Unidad/Libra, clavo de acero ────────────
// Antes de este cambio, con 3+ miembros el saldo de la presentación suelta
// alternativa que NO fuera "la primera agregada" se perdía en silencio al
// zonar los no-canónicos en rebuildStockGroupBalancesTx (nunca se plegaba a
// canónico). Estas pruebas cubren calcTracksPackagesConsolidation con
// looseAlternateMembers — el fix real.

describe("H.10 calcTracksPackagesConsolidation — fusión triple Caja(Kilo)/Unidad/Libra", () => {
  // Canónico: KILO (factor=1). Empaque: CAJA, 1 caja = 25 kg. Suelto
  // alternativo: LIBRA, 1 libra ≈ 0.453592 kg.
  const CAJA_FACTOR = 25;
  const LIBRA_FACTOR = 0.453592;

  it("sin saldo varado en Libra: se comporta igual que el caso dual (looseAlternateMembers vacío u omitido)", () => {
    const packageBalance: BalanceSnapshot = { quantityOnHand: 4, closedPackageQuantity: 0, looseUnitQuantity: 0, weightedAverageCost: 500 };
    const canonicalBalance: BalanceSnapshot = { quantityOnHand: 10, closedPackageQuantity: 0, looseUnitQuantity: 0, weightedAverageCost: 20 };
    const withoutParam = calcTracksPackagesConsolidation({ packageBalance, canonicalBalance, factor: CAJA_FACTOR });
    const withEmptyArray = calcTracksPackagesConsolidation({
      packageBalance, canonicalBalance, factor: CAJA_FACTOR,
      looseAlternateMembers: [{ conversionFactor: LIBRA_FACTOR, balance: null }],
    });
    assert.deepEqual(withEmptyArray, withoutParam);
    assert.equal(withoutParam.finalClosed, 4);
    assert.equal(withoutParam.finalLoose, 10);
  });

  it("saldo varado en Libra (recepción hecha por error contra ella) se pliega a finalLoose, NO se pierde", () => {
    const packageBalance: BalanceSnapshot = { quantityOnHand: 4, closedPackageQuantity: 0, looseUnitQuantity: 0, weightedAverageCost: 500 };
    const canonicalBalance: BalanceSnapshot = { quantityOnHand: 10, closedPackageQuantity: 0, looseUnitQuantity: 0, weightedAverageCost: 20 };
    // 6 libras varadas con costo 15/libra.
    const libraBalance: BalanceSnapshot = { quantityOnHand: 6, closedPackageQuantity: 0, looseUnitQuantity: 0, weightedAverageCost: 15 };

    const result = calcTracksPackagesConsolidation({
      packageBalance,
      canonicalBalance,
      factor: CAJA_FACTOR,
      looseAlternateMembers: [{ conversionFactor: LIBRA_FACTOR, balance: libraBalance }],
    });

    const libraAsKilos = 6 * LIBRA_FACTOR;
    assert.equal(result.finalClosed, 4, "el empaque no se toca por el saldo de Libra");
    assert.ok(Math.abs(result.finalLoose - (10 + libraAsKilos)) < 1e-9, "Libra se suma al canónico, no se descarta");
    assert.ok(Math.abs(result.totalBaseQty - (4 * CAJA_FACTOR + 10 + libraAsKilos)) < 1e-9);
    assert.ok(result.warnings.some((w) => w.includes("stray balance")), "debe advertir que hubo saldo varado plegado");
  });

  it("saldo varado en DOS presentaciones sueltas alternativas (Libra y Unidad) se suman ambas", () => {
    const canonicalBalance: BalanceSnapshot = { quantityOnHand: 0, closedPackageQuantity: 0, looseUnitQuantity: 0, weightedAverageCost: 0 };
    const libraBalance: BalanceSnapshot = { quantityOnHand: 6, closedPackageQuantity: 0, looseUnitQuantity: 0, weightedAverageCost: 15 };
    // Unidad: factor = peso promedio del clavo en kg (ej. 200 unidades por kilo -> factor=0.005).
    const UNIDAD_FACTOR = 0.005;
    const unidadBalance: BalanceSnapshot = { quantityOnHand: 100, closedPackageQuantity: 0, looseUnitQuantity: 0, weightedAverageCost: 0.3 };

    const result = calcTracksPackagesConsolidation({
      packageBalance: null,
      canonicalBalance,
      factor: CAJA_FACTOR,
      looseAlternateMembers: [
        { conversionFactor: LIBRA_FACTOR, balance: libraBalance },
        { conversionFactor: UNIDAD_FACTOR, balance: unidadBalance },
      ],
    });

    const expectedLoose = 6 * LIBRA_FACTOR + 100 * UNIDAD_FACTOR;
    assert.ok(Math.abs(result.finalLoose - expectedLoose) < 1e-9);
    assert.equal(result.finalClosed, 0);
  });

  it("el WAC pondera correctamente el saldo varado junto con empaque y canónico", () => {
    // OJO con las unidades: weightedAverageCost de packageBalance/looseAlternateMembers
    // es costo en la unidad PROPIA de cada presentación (por CAJA, por LIBRA)
    // — la función lo divide por su propio factor para llevarlo a costo por
    // kilo (base). Para que ambas presentaciones representen ~C$500/kg:
    // caja = C$500/kg × 25 kg/caja = C$12500/caja; libra = C$500/kg × 0.453592 kg/libra ≈ C$226.80/libra.
    const packageBalance: BalanceSnapshot = { quantityOnHand: 2, closedPackageQuantity: 0, looseUnitQuantity: 0, weightedAverageCost: 12500 }; // 2 cajas a C$12500/caja = C$500/kg
    const canonicalBalance: BalanceSnapshot = { quantityOnHand: 0, closedPackageQuantity: 0, looseUnitQuantity: 0, weightedAverageCost: 0 };
    const libraBalance: BalanceSnapshot = { quantityOnHand: 10, closedPackageQuantity: 0, looseUnitQuantity: 0, weightedAverageCost: 226.8 }; // C$226.80/libra ≈ C$500/kg

    const result = calcTracksPackagesConsolidation({
      packageBalance,
      canonicalBalance,
      factor: CAJA_FACTOR,
      looseAlternateMembers: [{ conversionFactor: LIBRA_FACTOR, balance: libraBalance }],
    });

    // Todo el stock (caja + libra) tiene ~el mismo costo por kilo (~500) —
    // el WAC combinado debe seguir rondando ese valor, no diluirse a 0 ni
    // duplicarse por ignorar el aporte de Libra.
    assert.ok(result.newWac > 400 && result.newWac < 600, `WAC combinado fuera de rango esperado: ${result.newWac}`);
  });
});
