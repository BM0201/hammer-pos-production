import assert from "node:assert/strict";
import test from "node:test";
import {
  shouldWarnSuggestedIncrease,
  canConfirmCorrectionItem,
  buildCorrectionSummary,
  buildCorrectionPayloadItem,
  recalculateReferencePrices,
} from "@/lib/cost-correction-logic";

// ── shouldWarnSuggestedIncrease (2.2, modo Automático) ────────────────────

test("LA QUE IMPORTA — sube más del 50% dispara el aviso (la caja: C$28 → C$56 es +100%)", () => {
  assert.equal(shouldWarnSuggestedIncrease(28, 56), true);
});
test("sube 30% no dispara el aviso (umbral es 50%, no 30%)", () => {
  assert.equal(shouldWarnSuggestedIncrease(40, 52), false);
});
test("sin precio anterior, o precio anterior 0, no se puede calcular el % — no dispara", () => {
  assert.equal(shouldWarnSuggestedIncrease(null, 56), false);
  assert.equal(shouldWarnSuggestedIncrease(0, 56), false);
});

// ── canConfirmCorrectionItem (2.2 — "en rojo y sin poder confirmar") ──────

test("LA QUE IMPORTA — modo Manual con precio bajo el costo: bloqueado", () => {
  assert.equal(canConfirmCorrectionItem({ keepPrice: false, mode: "MANUAL", price: 50, cost: 60 }), false);
});
test("modo Manual con precio sobre el costo: permitido", () => {
  assert.equal(canConfirmCorrectionItem({ keepPrice: false, mode: "MANUAL", price: 70, cost: 60 }), true);
});
test("modo Manual sin precio todavía tecleado: bloqueado (nada que aplicar)", () => {
  assert.equal(canConfirmCorrectionItem({ keepPrice: false, mode: "MANUAL", price: null, cost: 60 }), false);
});
test("keepPrice siempre permitido, sin importar costo/precio", () => {
  assert.equal(canConfirmCorrectionItem({ keepPrice: true, mode: "MANUAL", price: null, cost: 60 }), true);
});
test("modo Automático nunca se bloquea acá — el precio lo recalcula el servidor con el costo nuevo", () => {
  assert.equal(canConfirmCorrectionItem({ keepPrice: false, mode: "AUTO", price: null, cost: 60 }), true);
});

// ── buildCorrectionSummary (2.3 — "2 productos · 1 costo corregido · 1 precio sube · 1 sin cambio") ──

test("LA QUE IMPORTA — resumen del pie cuenta costo corregido y precio sube/baja/igual por separado", () => {
  const summary = buildCorrectionSummary([
    { removed: false, costChanged: true, keepPrice: false, previousPrice: 28, newPrice: 56 },
    { removed: false, costChanged: false, keepPrice: true, previousPrice: 40, newPrice: 40 },
  ]);
  assert.deepEqual(summary, { count: 2, costCorrectedCount: 1, priceUpCount: 1, priceDownCount: 0, sameCount: 1 });
});
test("un producto quitado del lote ('Quitar de este lote') no cuenta en el resumen", () => {
  const summary = buildCorrectionSummary([
    { removed: true, costChanged: true, keepPrice: false, previousPrice: 28, newPrice: 56 },
    { removed: false, costChanged: false, keepPrice: false, previousPrice: 40, newPrice: 35 },
  ]);
  assert.equal(summary.count, 1);
  assert.equal(summary.priceDownCount, 1);
});
test("precio exactamente igual al anterior cuenta como sin cambio, no como sube", () => {
  const summary = buildCorrectionSummary([{ removed: false, costChanged: false, keepPrice: false, previousPrice: 40, newPrice: 40 }]);
  assert.equal(summary.sameCount, 1);
  assert.equal(summary.priceUpCount, 0);
});

// ── buildCorrectionPayloadItem — armado del payload por modo ─────────────

test("modo AUTO sin costo: payload solo trae decisionId y mode, sin price (el servidor decide)", () => {
  const item = buildCorrectionPayloadItem({ decisionId: "d1", mode: "AUTO", costAction: null, costValue: null, price: null, keepPrice: false });
  assert.deepEqual(item, { decisionId: "d1", mode: "AUTO" });
});
test("modo MANUAL con precio: payload trae price", () => {
  const item = buildCorrectionPayloadItem({ decisionId: "d1", mode: "MANUAL", costAction: null, costValue: null, price: 130, keepPrice: false });
  assert.deepEqual(item, { decisionId: "d1", mode: "MANUAL", price: 130 });
});
test("con corrección de costo SET_BRANCH_COST: payload trae cost.action y cost.value", () => {
  const item = buildCorrectionPayloadItem({ decisionId: "d1", mode: "MANUAL", costAction: "SET_BRANCH_COST", costValue: 90, price: 130, keepPrice: false });
  assert.deepEqual(item, { decisionId: "d1", mode: "MANUAL", cost: { action: "SET_BRANCH_COST", value: 90 }, price: 130 });
});
test("CLEAR_BRANCH_COST no lleva value (no aplica un número, borra el campo)", () => {
  const item = buildCorrectionPayloadItem({ decisionId: "d1", mode: "MANUAL", costAction: "CLEAR_BRANCH_COST", costValue: 999, price: 130, keepPrice: false });
  assert.deepEqual(item.cost, { action: "CLEAR_BRANCH_COST" });
});
test("keepPrice=true: payload trae keepPrice, nunca price", () => {
  const item = buildCorrectionPayloadItem({ decisionId: "d1", mode: "MANUAL", costAction: "CLEAR_BRANCH_COST", costValue: null, price: 130, keepPrice: true });
  assert.deepEqual(item, { decisionId: "d1", mode: "MANUAL", cost: { action: "CLEAR_BRANCH_COST" }, keepPrice: true });
});
test("alsoBranchIds vacío no se incluye en el payload", () => {
  const item = buildCorrectionPayloadItem({ decisionId: "d1", mode: "MANUAL", costAction: null, costValue: null, price: 130, keepPrice: false, alsoBranchIds: [] });
  assert.equal("alsoBranchIds" in item, false);
});

// ── recalculateReferencePrices — recálculo en vivo al cambiar el costo (2.2) ──

test("LA QUE IMPORTA — el sugerido se recalcula con el costo NUEVO, no el viejo", () => {
  const result = recalculateReferencePrices({ newCost: 90, oldCost: 20, oldPrice: 150, recommendedMarginPercent: 30, minMarginPercent: 15, realizedMarginPct: null });
  // 90 / (1 - 0.30) = 128.57
  assert.equal(result.suggested, 128.57);
});
test("mínimo de la política también se recalcula con el costo nuevo", () => {
  const result = recalculateReferencePrices({ newCost: 90, oldCost: 20, oldPrice: 150, recommendedMarginPercent: 30, minMarginPercent: 15, realizedMarginPct: null });
  // 90 / (1 - 0.15) = 105.88
  assert.equal(result.policyMin, 105.88);
});
test("misma ganancia en C$: conserva la ganancia VIEJA en córdobas sobre el costo NUEVO", () => {
  // costo viejo 20, precio viejo 150 → ganancia vieja = 130. Costo nuevo 90 → 90 + 130 = 220.
  const result = recalculateReferencePrices({ newCost: 90, oldCost: 20, oldPrice: 150, recommendedMarginPercent: 30, minMarginPercent: 15, realizedMarginPct: null });
  assert.equal(result.keepGainAmount, 220);
});
test("mismo % que tenía: conserva el margen VIEJO (sobre el precio viejo), aplicado al costo nuevo", () => {
  // margen viejo = (150-20)/150 = 86.67%. 90 / (1 - 0.8667) = 675.68 (caso extremo, pero la fórmula es correcta)
  const result = recalculateReferencePrices({ newCost: 90, oldCost: 20, oldPrice: 150, recommendedMarginPercent: 30, minMarginPercent: 15, realizedMarginPct: null });
  const oldMarginPct = ((150 - 20) / 150) * 100;
  const expected = Math.round((90 / (1 - oldMarginPct / 100)) * 100) / 100;
  assert.equal(result.keepMarginPct, expected);
});
test("sin costo/precio viejo, misma ganancia y mismo % quedan null — no hay base para conservar nada", () => {
  const result = recalculateReferencePrices({ newCost: 90, oldCost: null, oldPrice: null, recommendedMarginPercent: 30, minMarginPercent: 15, realizedMarginPct: null });
  assert.equal(result.keepGainAmount, null);
  assert.equal(result.keepMarginPct, null);
});
test("margen >= 100% no produce un precio (división por cero o negativa) — queda null en vez de Infinity", () => {
  const result = recalculateReferencePrices({ newCost: 90, oldCost: null, oldPrice: null, recommendedMarginPercent: 100, minMarginPercent: null, realizedMarginPct: null });
  assert.equal(result.suggested, null);
});
