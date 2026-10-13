import assert from "node:assert/strict";
import test from "node:test";
import {
  computeGainBreakdown,
  formatGainThreeWays,
  priceColorState,
  shouldWarnRealizedGap,
  shouldConfirmBigChange,
  buildBatchSummary,
  priceForMethod,
  parsePriceInput,
} from "@/lib/pricing-tray-logic";

const money = (n: number) => `C$ ${n.toFixed(2)}`;

test("LA QUE IMPORTA — formato de la ganancia en las tres formas, orden por defecto sobre costo", () => {
  const gain = computeGainBreakdown(100, 70);
  assert.equal(gain.gainAmount, 30);
  assert.equal(gain.markupOnCost, Math.round((30 / 70) * 10000) / 100);
  assert.equal(gain.marginOnPrice, 30);
  const text = formatGainThreeWays(gain, "cost", money);
  assert.equal(text, "C$ 30.00 · 42.9% s/costo · 30.0% s/precio");
});

test("formato de la ganancia con preferencia 'sobre precio' invierte el orden", () => {
  const gain = computeGainBreakdown(100, 70);
  const text = formatGainThreeWays(gain, "price", money);
  assert.equal(text, "C$ 30.00 · 30.0% s/precio · 42.9% s/costo");
});

test("sin costo o sin precio, la ganancia es '—'", () => {
  assert.equal(formatGainThreeWays(computeGainBreakdown(null, 70), "cost", money), "—");
  assert.equal(formatGainThreeWays(computeGainBreakdown(100, null), "cost", money), "—");
});

test("LA QUE IMPORTA — estado de color: bajo el costo es rojo (BELOW_COST)", () => {
  assert.equal(priceColorState(60, 70, 15), "BELOW_COST");
  assert.equal(priceColorState(70, 70, 15), "BELOW_COST", "precio = costo también cuenta como bajo el costo (margen 0)");
});

test("LA QUE IMPORTA — estado de color: dentro del costo pero bajo el mínimo es ámbar (BELOW_MIN)", () => {
  // margen (100-90)/100 = 10%, mínimo 15% -> bajo el mínimo
  assert.equal(priceColorState(100, 90, 15), "BELOW_MIN");
});

test("estado de color: sobre el mínimo es verde (OK)", () => {
  // margen (100-70)/100 = 30%, mínimo 15% -> OK
  assert.equal(priceColorState(100, 70, 15), "OK");
});

test("estado de color: sin costo o sin precio es UNKNOWN, no OK ni rojo por default", () => {
  assert.equal(priceColorState(null, 70, 15), "UNKNOWN");
  assert.equal(priceColorState(100, null, 15), "UNKNOWN");
});

test("LA QUE IMPORTA — el aviso '→' aparece cuando el precio nuevo se aleja más de 5 puntos del margen realizado", () => {
  assert.equal(shouldWarnRealizedGap(22, 9), true, "vendés a 9%, este precio da 22% — 13 puntos de diferencia");
  assert.equal(shouldWarnRealizedGap(12, 9), false, "solo 3 puntos — dentro del margen de tolerancia visual");
  assert.equal(shouldWarnRealizedGap(null, 9), false);
});

test("LA QUE IMPORTA — confirmación si el cambio pasa de ±30%", () => {
  assert.equal(shouldConfirmBigChange(100, 131), true, "+31% requiere confirmar");
  assert.equal(shouldConfirmBigChange(100, 129), false, "+29% no requiere confirmar");
  assert.equal(shouldConfirmBigChange(100, 69), true, "-31% (baja) también requiere confirmar");
  assert.equal(shouldConfirmBigChange(null, 150), false, "sin precio anterior no hay cambio que medir");
});

test("LA QUE IMPORTA — el resumen del lote cuenta cuántos suben, bajan y el promedio antes/después", () => {
  const summary = buildBatchSummary([
    { previousPrice: 100, newPrice: 120 }, // sube
    { previousPrice: 50, newPrice: 40 }, // baja
    { previousPrice: 80, newPrice: 80 }, // igual
    { previousPrice: null, newPrice: 90 }, // sin precio anterior — no cuenta para el promedio
  ]);
  assert.equal(summary.count, 4, "cuenta TODOS los items, incluso los que no entran al promedio");
  assert.equal(summary.upCount, 1);
  assert.equal(summary.downCount, 1);
  assert.equal(summary.sameCount, 1);
  assert.equal(summary.avgBefore, (100 + 50 + 80) / 3);
  assert.equal(summary.avgAfter, (120 + 40 + 80) / 3);
});

test("LA QUE IMPORTA — 'Usar método en seleccionadas': el precio de ESE método, solo donde está disponible", () => {
  const refs = [
    { method: "SUGGESTED" as const, price: 150, available: true },
    { method: "REALIZED_MARGIN" as const, price: null, available: false },
  ];
  assert.equal(priceForMethod(refs, "SUGGESTED"), 150);
  assert.equal(priceForMethod(refs, "REALIZED_MARGIN"), null, "no disponible — no se toca el input de esa fila");
  assert.equal(priceForMethod(refs, "POLICY_MIN"), null, "método ni siquiera presente en las referencias de esta fila");
});

test("parsePriceInput acepta '12' y '=12', rechaza negativos y texto", () => {
  assert.equal(parsePriceInput("150"), 150);
  assert.equal(parsePriceInput("=150"), 150);
  assert.equal(parsePriceInput(" =99.5 "), 99.5);
  assert.equal(parsePriceInput("-5"), null);
  assert.equal(parsePriceInput("abc"), null);
  assert.equal(parsePriceInput(""), null);
});
