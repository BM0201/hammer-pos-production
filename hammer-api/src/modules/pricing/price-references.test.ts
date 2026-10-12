import assert from "node:assert/strict";
import test from "node:test";
import { buildPriceReferences, type PriceReferenceInput, type SuggestedBreakdown } from "@/modules/pricing/price-references";

/**
 * Parte C.2 (prompt-completo-pendientes-2026-10.md) — "los otros métodos":
 * buildPriceReferences es pura, así que se prueba con números a mano, sin
 * base de datos.
 */

function baseInput(overrides: Partial<PriceReferenceInput> = {}): PriceReferenceInput {
  return {
    currentPrice: 100,
    effectiveCost: 70,
    roundingRule: "NEAREST_1",
    policyMinMarginPercent: 15,
    suggested: null,
    realizedMargin: null,
    priorCost: null,
    otherBranches: [],
    ...overrides,
  };
}

function breakdown(overrides: Partial<SuggestedBreakdown> = {}): SuggestedBreakdown {
  return {
    targetMarginPercent: 30,
    abcXyzClass: "baja rotación (CZ)",
    marginDelta: 20,
    marginAfterAdjustment: 50,
    flooredByPolicy: false,
    operatingExpensePerUnit: 0,
    minProfitAmount: 0,
    roundingRule: "NEAREST_1",
    rawPrice: 140,
    finalPrice: 140,
    ...overrides,
  };
}

function findRef(refs: ReturnType<typeof buildPriceReferences>, method: string) {
  const found = refs.find((r) => r.method === method);
  assert.ok(found, `no se encontró la referencia ${method}`);
  return found!;
}

test("LA QUE IMPORTA — KEEP_CURRENT siempre está disponible, con el precio de hoy tal cual", () => {
  const refs = buildPriceReferences(baseInput());
  const ref = findRef(refs, "KEEP_CURRENT");
  assert.equal(ref.available, true);
  assert.equal(ref.price, 100);
  assert.equal(ref.marginOnPrice, 30, "(100-70)/100 = 30%");
});

test("SUGGESTED sin costo no está disponible, con motivo", () => {
  const refs = buildPriceReferences(baseInput({ effectiveCost: null, suggested: null }));
  const ref = findRef(refs, "SUGGESTED");
  assert.equal(ref.available, false);
  assert.equal(ref.reason, "sin costo");
});

test("LA QUE IMPORTA — el desglose del sugerido suma lo que da el motor: '30% meta + 20% por baja rotación (CZ) = 50%'", () => {
  const refs = buildPriceReferences(baseInput({ suggested: breakdown() }));
  const ref = findRef(refs, "SUGGESTED");
  assert.equal(ref.available, true);
  assert.equal(ref.price, 140);
  assert.ok(ref.basis?.includes("30% meta"), ref.basis ?? "");
  assert.ok(ref.basis?.includes("+20% por baja rotación (CZ)"), ref.basis ?? "");
  assert.ok(ref.basis?.includes("= 50%"), ref.basis ?? "");
});

test("el desglose avisa cuando el piso de la política cambió el número (flooredByPolicy)", () => {
  const refs = buildPriceReferences(baseInput({ suggested: breakdown({ flooredByPolicy: true }) }));
  const ref = findRef(refs, "SUGGESTED");
  assert.ok(ref.basis?.includes("mínimo de la política aplicado"));
});

test("el desglose muestra el redondeo cuando el precio final difiere del crudo", () => {
  const refs = buildPriceReferences(baseInput({ suggested: breakdown({ rawPrice: 139.4, finalPrice: 140 }) }));
  const ref = findRef(refs, "SUGGESTED");
  assert.ok(ref.basis?.includes("redondeo"));
  assert.ok(ref.basis?.includes("139.40"));
  assert.ok(ref.basis?.includes("140.00"));
});

test("LA QUE IMPORTA — REALIZED_MARGIN usa el margen realmente vendido, no disponible sin ventas suficientes", () => {
  const sinDatos = buildPriceReferences(baseInput({ realizedMargin: null }));
  const refSinDatos = findRef(sinDatos, "REALIZED_MARGIN");
  assert.equal(refSinDatos.available, false);
  assert.equal(refSinDatos.reason, "sin ventas suficientes");

  const conDatos = buildPriceReferences(baseInput({ realizedMargin: { marginPct: 20, lineCount: 10, distinctSaleDays: 5 } }));
  const refConDatos = findRef(conDatos, "REALIZED_MARGIN");
  assert.equal(refConDatos.available, true);
  // costo 70 / (1 - 0.20) = 87.5 -> redondeo NEAREST_1 = 88
  assert.equal(refConDatos.price, 88);
});

test("LA QUE IMPORTA — KEEP_GAIN_AMOUNT cuando sube el costo: precioActual + (costoActual - costoAnterior)", () => {
  const refs = buildPriceReferences(baseInput({ currentPrice: 100, effectiveCost: 90, priorCost: 70 })); // el costo subió de 70 a 90
  const ref = findRef(refs, "KEEP_GAIN_AMOUNT");
  assert.equal(ref.available, true);
  assert.equal(ref.price, 120, "100 + (90 - 70) = 120, la misma ganancia de C$30 que tenía antes");
  assert.equal(ref.gainAmount, 30);
});

test("KEEP_GAIN_AMOUNT sin costo anterior confiable no está disponible", () => {
  const refs = buildPriceReferences(baseInput({ priorCost: null }));
  const ref = findRef(refs, "KEEP_GAIN_AMOUNT");
  assert.equal(ref.available, false);
  assert.equal(ref.reason, "sin costo anterior confiable");
});

test("KEEP_MARGIN_PCT — mismo % que tenía, calculado con costo y precio ANTERIORES", () => {
  // margen anterior: (100 - 70)/100 = 30%. Costo subió a 90: 90/(1-0.30) = 128.57 -> redondeo 129
  const refs = buildPriceReferences(baseInput({ currentPrice: 100, effectiveCost: 90, priorCost: 70 }));
  const ref = findRef(refs, "KEEP_MARGIN_PCT");
  assert.equal(ref.available, true);
  assert.equal(ref.price, 129);
});

test("POLICY_MIN — costo / (1 - min/100)", () => {
  const refs = buildPriceReferences(baseInput({ effectiveCost: 70, policyMinMarginPercent: 15 }));
  const ref = findRef(refs, "POLICY_MIN");
  assert.equal(ref.available, true);
  // 70 / (1 - 0.15) = 82.35 -> redondeo 82
  assert.equal(ref.price, 82);
});

test("POLICY_MIN sin costo no está disponible", () => {
  const refs = buildPriceReferences(baseInput({ effectiveCost: null }));
  const ref = findRef(refs, "POLICY_MIN");
  assert.equal(ref.available, false);
  assert.equal(ref.reason, "sin costo");
});

test("LA QUE IMPORTA — OTHER_BRANCH: una referencia POR CADA sucursal, con el margen que daría ACÁ (con el costo de ESTA sucursal)", () => {
  const refs = buildPriceReferences(baseInput({
    effectiveCost: 70,
    otherBranches: [{ branchId: "b2", branchName: "MSY", price: 120 }, { branchId: "b3", branchName: "RVS", price: 90 }],
  }));
  const otherRefs = refs.filter((r) => r.method === "OTHER_BRANCH");
  assert.equal(otherRefs.length, 2);
  const msy = otherRefs.find((r) => r.label === "Igual que MSY")!;
  assert.equal(msy.price, 120);
  assert.equal(msy.marginOnPrice, Math.round(((120 - 70) / 120) * 10000) / 100, "margen calculado con el costo de ACÁ, no el de MSY");
});

test("sin otras sucursales con precio, no hay referencias OTHER_BRANCH (ni una placeholder)", () => {
  const refs = buildPriceReferences(baseInput({ otherBranches: [] }));
  assert.equal(refs.filter((r) => r.method === "OTHER_BRANCH").length, 0);
});

test("redondeo — NEAREST_5 redondea el precio calculado, no solo el sugerido", () => {
  const refs = buildPriceReferences(baseInput({ effectiveCost: 70, policyMinMarginPercent: 15, roundingRule: "NEAREST_5" }));
  const ref = findRef(refs, "POLICY_MIN");
  // 70 / 0.85 = 82.35 -> redondeo a múltiplo de 5 = 80
  assert.equal(ref.price, 80);
});
