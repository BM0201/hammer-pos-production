import assert from "node:assert/strict";
import test from "node:test";
import { buildCloseDiscrepancySignal } from "@/modules/cash-session/service";
import { raiseCashDiscrepancy } from "@/modules/treasury/discrepancy-signals";

/**
 * PASO 3 (prompt-vigilancia-tesoreria-generalizacion.md) — el descuadre al
 * cerrar caja (CASH_SESSION_DISCREPANCY_DETECTED) ya se auditaba, pero solo
 * en un AuditLog. A diferencia de los pasos anteriores, es informativo A
 * PROPÓSITO: no bloquea nada (closeCashSession sigue cerrando exactamente
 * igual, sin ningún gate nuevo — "ya se decidió que no aplica") y usa
 * severity INFO, el piso real de BrainDecisionSeverity.
 *
 * closeCashSession en sí NO se refactorizó a una *Tx testeable (a
 * diferencia de confirmBankDeposit) — el pedido fue explícito: "No tocar
 * closeCashSession". buildCloseDiscrepancySignal es la única pieza nueva
 * que se extrajo, PURA (sin DB), para poder probar el armado de la señal
 * sin tocar el control de flujo/transacción de closeCashSession.
 */

test("buildCloseDiscrepancySignal: arma la señal con severity INFO y los datos correctos", () => {
  const signal = buildCloseDiscrepancySignal({
    physicalCashBoxCode: "CAJA-1",
    physicalCashBoxId: "box-1",
    branchId: "branch-1",
    cashSessionId: "session-1",
    expectedCash: 5000,
    countedCash: 4950,
    difference: -50,
    threshold: 5,
  });

  assert.equal(signal.category, "CASH");
  assert.equal(signal.severity, "INFO");
  assert.equal(signal.proposedActionType, "CASH_SESSION_CLOSE_DISCREPANCY");
  assert.equal(signal.branchId, "branch-1");
  assert.equal(signal.impactAmount, 50, "Math.abs(difference), no el valor con signo");
  assert.match(signal.title, /CAJA-1/);
  assert.match(signal.description, /C\$4950\.00/);
  assert.match(signal.description, /C\$5000\.00/);
  assert.match(signal.description, /C\$-50\.00/);
  assert.match(signal.description, /informativo/i);

  const evidence = signal.evidenceJson as Record<string, unknown>;
  assert.equal(evidence.cashSessionId, "session-1");
  assert.equal(evidence.physicalCashBoxId, "box-1");
  assert.equal(evidence.expectedCash, 5000);
  assert.equal(evidence.countedCash, 4950);
  assert.equal(evidence.difference, -50);
  assert.equal(evidence.threshold, 5);

  assert.deepEqual(signal.fingerprintParts, ["cash-session", "close-discrepancy", "session-1"]);
});

test("buildCloseDiscrepancySignal: impactAmount siempre positivo, aunque el conteo haya sido de MÁS (difference positiva)", () => {
  const signal = buildCloseDiscrepancySignal({
    physicalCashBoxCode: "CAJA-1",
    physicalCashBoxId: "box-1",
    branchId: "branch-1",
    cashSessionId: "session-2",
    expectedCash: 5000,
    countedCash: 5075,
    difference: 75,
    threshold: 5,
  });
  assert.equal(signal.impactAmount, 75);
});

test("raiseCashDiscrepancy(fakeTx, buildCloseDiscrepancySignal(...)) crea la decisión con los campos correctos (integración de las dos piezas nuevas)", async () => {
  const brainDecisions: Array<Record<string, unknown>> = [];
  const fakeTx = {
    brainDecision: {
      upsert: async ({ where, create, update }: { where: { fingerprint: string }; create: Record<string, unknown>; update: Record<string, unknown> }) => {
        const existing = brainDecisions.find((d) => d.fingerprint === where.fingerprint);
        if (existing) { Object.assign(existing, update); return existing; }
        const row = { id: `decision-${brainDecisions.length + 1}`, ...create };
        brainDecisions.push(row);
        return row;
      },
    },
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
  } as any;

  const signal = buildCloseDiscrepancySignal({
    physicalCashBoxCode: "CAJA-2",
    physicalCashBoxId: "box-2",
    branchId: "branch-2",
    cashSessionId: "session-3",
    expectedCash: 1000,
    countedCash: 900,
    difference: -100,
    threshold: 5,
  });
  await raiseCashDiscrepancy(fakeTx, signal);

  assert.equal(brainDecisions.length, 1);
  assert.equal(brainDecisions[0].severity, "INFO");
  assert.equal(brainDecisions[0].proposedActionType, "CASH_SESSION_CLOSE_DISCREPANCY");
  assert.ok(typeof brainDecisions[0].riskScore !== "undefined", "raiseCashDiscrepancy calcula riskScore aunque la severidad sea INFO");
});

test("llamar dos veces con la MISMA sesión (mismo fingerprint) → upsert actualiza, no duplica", async () => {
  const brainDecisions: Array<Record<string, unknown>> = [];
  const fakeTx = {
    brainDecision: {
      upsert: async ({ where, create, update }: { where: { fingerprint: string }; create: Record<string, unknown>; update: Record<string, unknown> }) => {
        const existing = brainDecisions.find((d) => d.fingerprint === where.fingerprint);
        if (existing) { Object.assign(existing, update); return existing; }
        const row = { id: `decision-${brainDecisions.length + 1}`, ...create };
        brainDecisions.push(row);
        return row;
      },
    },
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
  } as any;

  const signal = buildCloseDiscrepancySignal({
    physicalCashBoxCode: "CAJA-3",
    physicalCashBoxId: "box-3",
    branchId: "branch-3",
    cashSessionId: "session-4",
    expectedCash: 1000,
    countedCash: 900,
    difference: -100,
    threshold: 5,
  });
  await raiseCashDiscrepancy(fakeTx, signal);
  await raiseCashDiscrepancy(fakeTx, signal); // closeCashSession no puede recerrar una sesión ya CLOSED, pero el upsert es seguro igual

  assert.equal(brainDecisions.length, 1);
});
