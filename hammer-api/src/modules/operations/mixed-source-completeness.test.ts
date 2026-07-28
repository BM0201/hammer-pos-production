import assert from "node:assert/strict";
import test from "node:test";

/**
 * Día Operativo v2 Fase 2 — el bug a matar: en modo MIXED (migración: unos
 * pagos con operationalDayId, otros sin él) el sistema usaba
 * `effectiveTenders = useIdTenders ? dayTendersById : dayTenders` —
 * `useIdTenders` es true apenas hay UN tender con id, así que se usaban SOLO
 * los tenders con id y se descartaban en silencio los de ventana sin migrar.
 * El total quedaba por debajo del real.
 *
 * El fix: dayTendersById (operationalDayId === day.id) y dayTenders ahora
 * exigen operationalDayId === null — mutuamente excluyentes por
 * construcción — así que la unión (concat simple, sin dedup) es completa y
 * sin doble conteo. Espejo puro (sin DB) de la lógica de
 * calculateOperationalSummaryTx.
 */

type Tender = { id: string; method: string; amount: number };

function effectiveTenders(dayTendersById: Tender[], legacyUnmigratedInWindow: Tender[]): Tender[] {
  return [...dayTendersById, ...legacyUnmigratedInWindow];
}

test("Test MIXTO: la mitad con operationalDayId y la mitad sin él — el total incluye a TODOS", () => {
  const dayTendersById: Tender[] = [
    { id: "t1", method: "CASH", amount: 1000 },
    { id: "t2", method: "CASH", amount: 500 },
  ];
  const legacyUnmigratedInWindow: Tender[] = [
    { id: "t3", method: "CASH", amount: 800 },
    { id: "t4", method: "CARD", amount: 300 },
  ];

  const effective = effectiveTenders(dayTendersById, legacyUnmigratedInWindow);
  assert.equal(effective.length, 4, "los 4 tenders deben estar presentes, ninguno descartado");
  const total = effective.reduce((sum, t) => sum + t.amount, 0);
  assert.equal(total, 2600, "el total debe sumar los 4 tenders (antes se perdían los 2 sin id)");

  // El bug real: la lógica VIEJA descartaba legacyUnmigratedInWindow en cuanto
  // dayTendersById tenía al menos un elemento.
  const oldBuggyUseIdTenders = dayTendersById.length > 0;
  const oldBuggyEffective = oldBuggyUseIdTenders ? dayTendersById : legacyUnmigratedInWindow;
  const oldBuggyTotal = oldBuggyEffective.reduce((sum, t) => sum + t.amount, 0);
  assert.equal(oldBuggyTotal, 1500, "documenta el bug: la lógica vieja perdía C$1,100 de tenders sin migrar");
  assert.notEqual(oldBuggyTotal, total, "el fix corrige exactamente esta subestimación");
});

test("Test MIXTO: sin tenders sin migrar, el total es igual al de dayTendersById (no regresiona OPERATIONAL_DAY_ID)", () => {
  const dayTendersById: Tender[] = [{ id: "t1", method: "CASH", amount: 1000 }];
  const effective = effectiveTenders(dayTendersById, []);
  assert.equal(effective.length, 1);
  assert.equal(effective[0].amount, 1000);
});

test("Test MIXTO: sin ningún tender con id (LEGACY_TIME_WINDOW puro), el total es el de la ventana completa", () => {
  const legacyUnmigratedInWindow: Tender[] = [
    { id: "t1", method: "CASH", amount: 400 },
    { id: "t2", method: "TRANSFER", amount: 600 },
  ];
  const effective = effectiveTenders([], legacyUnmigratedInWindow);
  assert.equal(effective.length, 2);
  assert.equal(effective.reduce((s, t) => s + t.amount, 0), 1000);
});

test("Test MIXTO: sourceMode sigue siendo MIXED como traza, pero no determina el monto", () => {
  function sourceMode(paymentsIdCount: number, paymentsWindowCount: number) {
    return paymentsIdCount > 0
      ? paymentsIdCount < paymentsWindowCount
        ? "MIXED"
        : "OPERATIONAL_DAY_ID"
      : "LEGACY_TIME_WINDOW";
  }
  // 2 pagos con id, 4 en la ventana total (2 con id + 2 sin id) → MIXED.
  assert.equal(sourceMode(2, 4), "MIXED");

  // El monto (via effectiveTenders) es completo independientemente de sourceMode.
  const dayTendersById: Tender[] = [{ id: "t1", method: "CASH", amount: 1000 }, { id: "t2", method: "CASH", amount: 500 }];
  const legacyUnmigratedInWindow: Tender[] = [{ id: "t3", method: "CASH", amount: 800 }, { id: "t4", method: "CARD", amount: 300 }];
  const total = effectiveTenders(dayTendersById, legacyUnmigratedInWindow).reduce((s, t) => s + t.amount, 0);
  assert.equal(total, 2600, "el monto no depende de sourceMode, solo la trazabilidad/warnings sí");
});
