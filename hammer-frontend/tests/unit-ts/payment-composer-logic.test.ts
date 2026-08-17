/**
 * correccion-destino-y-pantalla-cobro.md §4 — pruebas 1 a 5 de la pantalla
 * de cobro (payment-composer.tsx). Convención del repo: espejo puro de la
 * lógica de decisión de un componente React (mismo patrón que
 * fusion-wizard-logic.test.ts) — sin montar el componente, sin JSDOM. Si
 * cambia la lógica real en payment-composer.tsx, actualizar acá también.
 *
 * La prueba 6 (el efectivo esperado de gaveta sube SOLO por la parte
 * efectivo de un cobro mixto) ya está cubierta en
 * hammer-api/src/modules/cash-session/expected-cash.test.ts — cashTenderTotal
 * sobre un arreglo con CASH+CARD ya confirma exactamente ese comportamiento,
 * y esta pasada no tocó ningún código de backend.
 *
 * La prueba 7 (transferencia con cuenta de destino -> sube el saldo
 * esperado de esa cuenta) es un aggregate de Prisma directo
 * (getBankAccountExpectedBalance en treasury/service.ts) — no hay lógica de
 * decisión que mirar ahí, es SELECT SUM(...) WHERE bankAccountId = X. Se
 * deja sin espejo puro a propósito, siguiendo la convención del repo de no
 * mockear una transacción completa de Prisma para probar una suma.
 *
 * Ejecutar: npm run test:unit:logic
 */
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { quickCashAmounts } from "@/components/payments/payment-composer";

type TenderMethod = "CASH" | "CARD" | "TRANSFER";
type DraftLine = { id: string; method: TenderMethod; amountRaw: string; receivedRaw: string; referenceNumber: string; bankAccountId: string };
type LineValidation = { amount: number; valid: boolean; needsReference: boolean; needsBankAccount: boolean; insufficientCash: boolean };

function round2(value: number) {
  return Math.round(value * 100) / 100;
}

function validateLine(line: DraftLine, accountsAvailable: boolean): LineValidation {
  const amount = Number(line.amountRaw) || 0;
  if (line.method === "CASH") {
    const received = line.receivedRaw.length > 0 ? Number(line.receivedRaw) || 0 : amount;
    const insufficientCash = received < amount;
    return { amount, valid: amount > 0 && !insufficientCash, needsReference: false, needsBankAccount: false, insufficientCash };
  }
  const needsReference = !line.referenceNumber.trim();
  const needsBankAccount = line.method === "TRANSFER" && accountsAvailable && !line.bankAccountId;
  return { amount, valid: amount > 0 && !needsReference && !needsBankAccount, needsReference, needsBankAccount, insufficientCash: false };
}

function summarize(lines: DraftLine[], total: number, accountsAvailable = false) {
  const validations = lines.map((l) => validateLine(l, accountsAvailable));
  const covered = round2(validations.reduce((sum, v) => sum + v.amount, 0));
  const missing = round2(total - covered);
  const exactMatch = Math.abs(missing) < 0.005;
  const allLinesValid = validations.every((v) => v.valid);
  const canConfirm = lines.length > 0 && exactMatch && allLinesValid;
  return { validations, covered, missing, exactMatch, canConfirm };
}

function buildTenders(lines: DraftLine[], accountsAvailable = false) {
  const validations = lines.map((l) => validateLine(l, accountsAvailable));
  return lines.map((line, i) => {
    const v = validations[i];
    if (line.method === "CASH") {
      const received = line.receivedRaw.length > 0 ? Number(line.receivedRaw) || 0 : v.amount;
      return { method: "CASH" as const, amount: v.amount, receivedAmount: round2(received), changeAmount: round2(received - v.amount) };
    }
    return { method: line.method, amount: v.amount, referenceNumber: line.referenceNumber.trim(), bankAccountId: line.bankAccountId || null };
  });
}

function line(partial: Partial<DraftLine> & { method: TenderMethod }): DraftLine {
  return { id: "1", amountRaw: "", receivedRaw: "", referenceNumber: "", bankAccountId: "", ...partial };
}

// ── Test 1: cobro mixto exacto -> MIXED con dos tenders que suman exacto ──

describe("Test 1: C$47,500 con C$17,500 efectivo + C$30,000 transferencia", () => {
  it("cubre exacto, habilita confirmar, y arma dos tenders (method derivado MIXED por el backend al ver 2)", () => {
    const lines = [
      line({ id: "1", method: "CASH", amountRaw: "17500" }),
      line({ id: "2", method: "TRANSFER", amountRaw: "30000", referenceNumber: "88213421" }),
    ];
    const summary = summarize(lines, 47500);
    assert.equal(summary.covered, 47500);
    assert.equal(summary.canConfirm, true);

    const tenders = buildTenders(lines);
    assert.equal(tenders.length, 2);
    // El "method" MIXED lo deriva normalizeTenders en el backend cuando
    // tenders.length > 1 — el frontend no lo calcula, solo manda el arreglo.
    assert.equal(tenders[0].method, "CASH");
    assert.equal(tenders[1].method, "TRANSFER");
    assert.equal(tenders.reduce((s, t) => s + t.amount, 0), 47500);
  });
});

// ── Test 2: un solo medio -> no se fuerza a MIXED ──

describe("Test 2: un solo medio de pago", () => {
  it("un solo tender -> el backend conserva ese method específico, no MIXED", () => {
    const lines = [line({ method: "CARD", amountRaw: "500", referenceNumber: "AUTH123" })];
    const tenders = buildTenders(lines);
    assert.equal(tenders.length, 1);
    assert.equal(tenders[0].method, "CARD");
  });
});

// ── Test 3: falta cubrir -> deshabilitado ──

describe("Test 3: los medios suman menos que el total", () => {
  it("faltante visible, canConfirm = false", () => {
    const lines = [line({ method: "CASH", amountRaw: "40000" })];
    const summary = summarize(lines, 47500);
    assert.equal(summary.missing, 7500);
    assert.equal(summary.canConfirm, false);
  });
});

// ── Test 4: se pasa del total -> también deshabilitado ──

describe("Test 4: los medios suman más que el total", () => {
  it("canConfirm = false aunque 'cubra y sobre' — exige exacto, ni de más ni de menos", () => {
    const lines = [line({ method: "CASH", amountRaw: "50000" })];
    const summary = summarize(lines, 47500);
    assert.equal(summary.missing, -2500);
    assert.equal(summary.canConfirm, false);
  });
});

// ── Test 5: vuelto solo aplica al efectivo ──

describe("Test 5: vuelto solo sobre la línea de efectivo", () => {
  it("una línea de transferencia nunca calcula ni ofrece received/change", () => {
    const transferLine = line({ method: "TRANSFER", amountRaw: "30000", referenceNumber: "REF1" });
    const tenders = buildTenders([transferLine]);
    assert.equal("receivedAmount" in tenders[0], false);
    assert.equal("changeAmount" in tenders[0], false);
  });

  it("una línea de efectivo sí calcula vuelto = recibido - monto", () => {
    const cashLine = line({ method: "CASH", amountRaw: "17500", receivedRaw: "20000" });
    const tenders = buildTenders([cashLine]);
    assert.equal(tenders[0].method, "CASH");
    assert.equal((tenders[0] as { changeAmount: number }).changeAmount, 2500);
  });
});

// ── Validaciones por línea ──

describe("validateLine", () => {
  it("CASH con recibido menor al monto -> inválido (insufficientCash)", () => {
    const v = validateLine(line({ method: "CASH", amountRaw: "100", receivedRaw: "50" }), false);
    assert.equal(v.valid, false);
    assert.equal(v.insufficientCash, true);
  });

  it("CARD/TRANSFER sin referencia -> inválido (needsReference)", () => {
    const v = validateLine(line({ method: "CARD", amountRaw: "100" }), false);
    assert.equal(v.valid, false);
    assert.equal(v.needsReference, true);
  });

  it("monto en cero -> inválido sin importar el método", () => {
    assert.equal(validateLine(line({ method: "CASH", amountRaw: "0" }), false).valid, false);
  });
});

// ── Cuenta de destino para transferencias (§2.2/§3) ─────────────────────────

describe("validateLine: cuenta de destino en transferencias", () => {
  it("sin cuentas cargadas en la sucursal -> no se exige (no se puede pedir un dato que no existe)", () => {
    const v = validateLine(line({ method: "TRANSFER", amountRaw: "100", referenceNumber: "REF1" }), false);
    assert.equal(v.needsBankAccount, false);
    assert.equal(v.valid, true);
  });

  it("con cuentas disponibles y sin elegir -> inválido (needsBankAccount)", () => {
    const v = validateLine(line({ method: "TRANSFER", amountRaw: "100", referenceNumber: "REF1" }), true);
    assert.equal(v.needsBankAccount, true);
    assert.equal(v.valid, false);
  });

  it("con cuentas disponibles y una elegida -> válido", () => {
    const v = validateLine(line({ method: "TRANSFER", amountRaw: "100", referenceNumber: "REF1", bankAccountId: "acc-1" }), true);
    assert.equal(v.needsBankAccount, false);
    assert.equal(v.valid, true);
  });

  it("CASH nunca exige cuenta de destino, aunque haya cuentas disponibles", () => {
    const v = validateLine(line({ method: "CASH", amountRaw: "100" }), true);
    assert.equal(v.needsBankAccount, false);
  });

  it("buildTenders incluye bankAccountId cuando se eligió una cuenta", () => {
    const lines = [line({ method: "TRANSFER", amountRaw: "100", referenceNumber: "REF1", bankAccountId: "acc-1" })];
    const tenders = buildTenders(lines, true);
    assert.equal((tenders[0] as { bankAccountId: string | null }).bankAccountId, "acc-1");
  });
});

/**
 * prompt-pantallas-recorrido-dinero.md §1.2/§5 — Prueba 9: "Total C$890 →
 * los montos rápidos son Exacto, 1,000, 2,000. Ninguno menor al total."
 * quickCashAmounts es real (importada de payment-composer.tsx, no
 * reimplementada) — reemplazó la tabla fija [100, 200, 500] que era el bug
 * reportado: ninguno de esos tres alcanzaba a cubrir un total de C$890.
 */
describe("Prueba 9 (doc): quickCashAmounts para un total de C$890", () => {
  it("Exacto (890), 1000, 2000 — ninguno menor al total", () => {
    const amounts = quickCashAmounts(890);
    assert.deepEqual(amounts, [890, 1000, 2000]);
    assert.ok(amounts.every((a) => a >= 890), "ningún monto rápido debe ser menor al total");
  });
});

describe("quickCashAmounts: casos base", () => {
  it("total ya redondo (1000) -> no repite el mismo redondeo dos veces", () => {
    const amounts = quickCashAmounts(1000);
    assert.deepEqual(amounts, [1000, 2000]);
  });

  it("total <= 0 -> sin montos rápidos que ofrecer", () => {
    assert.deepEqual(quickCashAmounts(0), []);
    assert.deepEqual(quickCashAmounts(-5), []);
  });

  it("total pequeño (45) -> Exacto y los tres redondeos, máximo 4 valores", () => {
    const amounts = quickCashAmounts(45);
    assert.equal(amounts.length, 4);
    assert.equal(amounts[0], 45);
    assert.ok(amounts.every((a) => a >= 45));
  });
});
