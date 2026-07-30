/**
 * Tests del reparto quincenal del neto (biweekly-split.ts).
 *
 * Importa la función REAL que usa generateDisbursementsForRun — antes este
 * archivo era un espejo del 50/50 y por eso no atrapó el bug de repartir el
 * INSS entre las dos quincenas (el INSS se cobra UNA vez al mes).
 *
 * Run: node --import tsx --test src/modules/payroll/payroll-disbursement.test.ts
 */
import assert from "node:assert/strict";
import { scheduledFirstHalf, scheduledSecondHalf } from "./payroll-disbursement-service";
import { describe, it } from "node:test";
import { splitNetPayBiweekly } from "./biweekly-split";

describe("splitNetPayBiweekly (deducciones mensuales en la 2ª quincena)", () => {
  it("caso Harry: salario 12,000, INSS 456.37 → 1ª = 6,000.00 y 2ª = 5,543.63", () => {
    // El bug reportado: el 50/50 daba 5,771.82/5,771.81 (media deducción
    // escondida en cada quincena). La regla correcta descuenta el INSS
    // completo UNA vez, en la 2ª quincena.
    const net = 12_000 - 456.37; // 11,543.63
    const r = splitNetPayBiweekly(12_000, net);
    assert.equal(r.firstHalf, 6_000);
    assert.equal(r.secondHalf, 5_543.63); // 6,000 − 456.37 ✓ (la resta del usuario)
    assert.equal(Math.round((r.firstHalf + r.secondHalf) * 100) / 100, net);
  });

  it("caso Marvin: salario 9,500, INSS 456.37 → 1ª = 4,750.00 y 2ª = 4,293.63", () => {
    const net = 9_500 - 456.37;
    const r = splitNetPayBiweekly(9_500, net);
    assert.equal(r.firstHalf, 4_750);
    assert.equal(r.secondHalf, 4_293.63);
  });

  it("préstamos y demás deducciones también caen en la 2ª quincena", () => {
    // 12,000 − 456.37 INSS − 500 préstamo = 11,043.63.
    const r = splitNetPayBiweekly(12_000, 11_043.63);
    assert.equal(r.firstHalf, 6_000);
    assert.equal(r.secondHalf, 5_043.63);
  });

  it("si las deducciones superan medio salario, la 1ª se recorta y la 2ª nunca es negativa", () => {
    // Neto 4,000 con salario 12,000 (deducciones enormes): 1ª = 4,000, 2ª = 0.
    const r = splitNetPayBiweekly(12_000, 4_000);
    assert.equal(r.firstHalf, 4_000);
    assert.equal(r.secondHalf, 0);
  });

  it("la suma siempre cuadra al centavo (residuo en la 2ª)", () => {
    const r = splitNetPayBiweekly(10_001, 9_544.64);
    assert.equal(Math.round((r.firstHalf + r.secondHalf) * 100) / 100, 9_544.64);
  });

  it("neto cero (0 días trabajados) → ambas quincenas en 0", () => {
    const r = splitNetPayBiweekly(0, 0);
    assert.equal(r.firstHalf, 0);
    assert.equal(r.secondHalf, 0);
  });
});

/**
 * scheduledFirstHalf/scheduledSecondHalf (generateDisbursementsForRun).
 *
 * Caso reportado: hoy es 30 de julio y la nómina de julio se paga tarde (no
 * se pagó el 15 como correspondía). El pedido explícito: si en agosto TAMBIÉN
 * se paga tarde (el 16, no el 15), la 1ra quincena de agosto debe caer en
 * 15 de agosto — nunca en 15 de julio (el mes de la corrida anterior). Estas
 * funciones son puras en (year, month) — no dependen de "hoy" en absoluto,
 * así que no hay forma de que el mes de una corrida se filtre a otra. Estos
 * tests fijan esa garantía explícitamente.
 */
describe("scheduledFirstHalf / scheduledSecondHalf (fecha programada por corrida, nunca por 'hoy')", () => {
  it("julio 2026 → 1ra = 15/jul, 2da = 31/jul", () => {
    const first = scheduledFirstHalf(2026, 7);
    const second = scheduledSecondHalf(2026, 7);
    assert.equal(first.getFullYear(), 2026);
    assert.equal(first.getMonth(), 6); // 0-indexed: julio
    assert.equal(first.getDate(), 15);
    assert.equal(second.getMonth(), 6);
    assert.equal(second.getDate(), 31);
  });

  it("agosto 2026 → 1ra = 15/ago, 2da = 31/ago — nunca 15/jul aunque se calcule justo despues de procesar julio tarde", () => {
    const first = scheduledFirstHalf(2026, 8);
    const second = scheduledSecondHalf(2026, 8);
    assert.equal(first.getMonth(), 7); // 0-indexed: agosto
    assert.equal(first.getDate(), 15);
    assert.equal(second.getMonth(), 7);
    assert.equal(second.getDate(), 31);
    assert.notEqual(first.getTime(), scheduledFirstHalf(2026, 7).getTime(), "agosto y julio nunca comparten scheduledDate");
  });

  it("el resultado es puro: mismo (year, month) siempre da la misma fecha, sin importar cuándo se llama", () => {
    // No hay parámetro "now" — no hay forma de que el momento de la llamada
    // (pagar julio tarde el 30, pagar agosto tarde el 16) altere el resultado.
    const a = scheduledFirstHalf(2026, 8);
    const b = scheduledFirstHalf(2026, 8);
    assert.equal(a.getTime(), b.getTime());
  });

  it("febrero respeta el último día real del mes (28 o 29), no un '30' fijo", () => {
    assert.equal(scheduledSecondHalf(2025, 2).getDate(), 28); // 2025 no es bisiesto
    assert.equal(scheduledSecondHalf(2024, 2).getDate(), 29); // 2024 sí es bisiesto
  });

  it("es genérico para CUALQUIER par de meses, no solo julio/agosto (el ejemplo del reporte era ilustrativo)", () => {
    // Marzo/abril, año calendario normal.
    assert.equal(scheduledFirstHalf(2026, 3).getMonth(), 2);
    assert.equal(scheduledFirstHalf(2026, 4).getMonth(), 3);
    // Cruce de AÑO: diciembre 2026 y enero 2027 — el caso más propenso a bugs
    // de fecha (mes que "da la vuelta"). PayrollRun es único por
    // (branchId, year, month), así que diciembre 2026 y enero 2027 son
    // corridas distintas sin ambigüedad, igual que julio/agosto.
    const decFirst = scheduledFirstHalf(2026, 12);
    const decSecond = scheduledSecondHalf(2026, 12);
    const janFirst = scheduledFirstHalf(2027, 1);
    assert.equal(decFirst.getFullYear(), 2026);
    assert.equal(decFirst.getMonth(), 11);
    assert.equal(decFirst.getDate(), 15);
    assert.equal(decSecond.getFullYear(), 2026);
    assert.equal(decSecond.getMonth(), 11);
    assert.equal(decSecond.getDate(), 31, "el 'día 0 del mes siguiente' no debe desbordar a otro año");
    assert.equal(janFirst.getFullYear(), 2027);
    assert.equal(janFirst.getMonth(), 0);
    assert.notEqual(decFirst.getTime(), janFirst.getTime());
  });
});

/**
 * Escenario completo del reporte: julio se paga tarde (30/jul) Y agosto
 * también se paga tarde (16/ago) — simulando el agrupamiento real de
 * applyPendingPayrollCashOuts (agrupa por payrollRunId+period, cada grupo
 * con SU PROPIO scheduledDate). Verifica que, aunque ambos catch-ups
 * ocurrieran el mismo día, cada uno mantiene la fecha de SU mes.
 */
describe("no contaminación entre corridas de distintos meses (bug prevenido)", () => {
  it("dos corridas (julio y agosto), ambas pagadas tarde, mantienen cada una su propia scheduledDate al agruparse", () => {
    type Disbursement = { payrollRunId: string; period: "FIRST_HALF"; amount: number; scheduledDate: Date };

    const julyRun: Disbursement = { payrollRunId: "run-2026-07", period: "FIRST_HALF", amount: 18_000, scheduledDate: scheduledFirstHalf(2026, 7) };
    const augustRun: Disbursement = { payrollRunId: "run-2026-08", period: "FIRST_HALF", amount: 19_000, scheduledDate: scheduledFirstHalf(2026, 8) };

    // Agrupamiento real de applyPendingPayrollCashOuts: por payrollRunId+period.
    const groups = new Map<string, Disbursement[]>();
    for (const d of [julyRun, augustRun]) {
      const key = `${d.payrollRunId}:${d.period}`;
      if (!groups.has(key)) groups.set(key, []);
      groups.get(key)!.push(d);
    }

    assert.equal(groups.size, 2, "julio y agosto NUNCA se agrupan juntos, aunque se apliquen el mismo día");
    const julyGroup = groups.get("run-2026-07:FIRST_HALF")!;
    const augustGroup = groups.get("run-2026-08:FIRST_HALF")!;
    assert.equal(julyGroup[0].scheduledDate.getMonth(), 6, "julio conserva su propio mes");
    assert.equal(augustGroup[0].scheduledDate.getMonth(), 7, "agosto conserva su propio mes, no hereda julio");
    assert.notEqual(julyGroup[0].scheduledDate.getTime(), augustGroup[0].scheduledDate.getTime());
  });
});
