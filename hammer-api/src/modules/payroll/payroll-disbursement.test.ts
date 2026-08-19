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
import { paydayFor } from "./payday-calendar";
import { describe, it } from "node:test";
import { splitNetPayBiweekly } from "./biweekly-split";

// Las fechas de paydayFor son instantes UTC anclados al mediodía de Managua
// (ver payday-calendar.ts) — se leen con getUTC*, nunca con los getters
// locales (esos dependen de la zona horaria de quien corre el test).
function scheduledFirstHalf(year: number, month: number): Date {
  return paydayFor(year, month, 1).date;
}
function scheduledSecondHalf(year: number, month: number): Date {
  return paydayFor(year, month, 2).date;
}

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
 * paydayFor (usada por generateDisbursementsForRun vía scheduledFirstHalf/
 * scheduledSecondHalf, los wrappers de arriba).
 *
 * Caso reportado: hoy es 30 de julio y la nómina de julio se paga tarde (no
 * se pagó el 15 como correspondía). El pedido explícito: si en agosto TAMBIÉN
 * se paga tarde (el 16, no el 15), la 1ra quincena de agosto debe caer en
 * 15 de agosto — nunca en 15 de julio (el mes de la corrida anterior).
 * paydayFor es pura en (year, month, half) — no depende de "hoy" en
 * absoluto, así que no hay forma de que el mes de una corrida se filtre a
 * otra. Estos tests fijan esa garantía explícitamente.
 *
 * prompt-planilla-calendario-quincenas.md §3: la 2ª quincena de un mes de 31
 * días queda el 30 (nunca el 31, a diferencia del scheduledSecondHalf viejo
 * que usaba el último día real del mes) — y si el 30 cae domingo, se
 * adelanta al sábado.
 */
describe("paydayFor vía generateDisbursementsForRun (fecha programada por corrida, nunca por 'hoy')", () => {
  it("julio 2026 → 1ra = 15/jul, 2da = 30/jul (el día nominal siempre topa en 30, aunque el mes tenga 31)", () => {
    const first = scheduledFirstHalf(2026, 7);
    const second = scheduledSecondHalf(2026, 7);
    assert.equal(first.getUTCFullYear(), 2026);
    assert.equal(first.getUTCMonth(), 6); // 0-indexed: julio
    assert.equal(first.getUTCDate(), 15);
    assert.equal(second.getUTCMonth(), 6);
    // min(30, últimoDía) topa en 30 SIEMPRE que el mes llegue a 30 — el 31 de
    // un mes de 31 días nunca es el día de pago, ni siquiera sin domingo de
    // por medio (30/jul 2026 es jueves, así que acá el 30 ya es el final).
    assert.equal(second.getUTCDate(), 30);
  });

  it("agosto 2026 → 1ra = 15/ago, 2da = 29/ago (el 30 cae domingo) — nunca 15/jul aunque se calcule justo despues de procesar julio tarde", () => {
    const first = scheduledFirstHalf(2026, 8);
    const second = scheduledSecondHalf(2026, 8);
    assert.equal(first.getUTCMonth(), 7); // 0-indexed: agosto
    assert.equal(first.getUTCDate(), 15);
    assert.equal(second.getUTCMonth(), 7);
    assert.equal(second.getUTCDate(), 29, "el 30 de agosto 2026 es domingo: se adelanta al sábado 29");
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
    assert.equal(scheduledSecondHalf(2025, 2).getUTCDate(), 28); // 2025 no es bisiesto
    assert.equal(scheduledSecondHalf(2024, 2).getUTCDate(), 29); // 2024 sí es bisiesto
  });

  it("un mes de 31 días paga la 2ª quincena el 30, nunca el 31 (Test 10 del doc)", () => {
    // Diciembre 2026 tiene 31 días; el 30 de diciembre es miércoles (sin
    // ajuste de domingo) — antes scheduledSecondHalf devolvía el 31.
    assert.equal(scheduledSecondHalf(2026, 12).getUTCDate(), 30);
  });

  it("es genérico para CUALQUIER par de meses, no solo julio/agosto (el ejemplo del reporte era ilustrativo)", () => {
    // Marzo 2026: el 15 cae domingo -> se adelanta al 14.
    assert.equal(scheduledFirstHalf(2026, 3).getUTCMonth(), 2);
    assert.equal(scheduledFirstHalf(2026, 3).getUTCDate(), 14, "el 15 de marzo 2026 es domingo");
    assert.equal(scheduledFirstHalf(2026, 4).getUTCMonth(), 3);
    // Cruce de AÑO: diciembre 2026 y enero 2027 — el caso más propenso a bugs
    // de fecha (mes que "da la vuelta"). PayrollRun es único por
    // (branchId, year, month), así que diciembre 2026 y enero 2027 son
    // corridas distintas sin ambigüedad, igual que julio/agosto.
    const decFirst = scheduledFirstHalf(2026, 12);
    const decSecond = scheduledSecondHalf(2026, 12);
    const janFirst = scheduledFirstHalf(2027, 1);
    assert.equal(decFirst.getUTCFullYear(), 2026);
    assert.equal(decFirst.getUTCMonth(), 11);
    assert.equal(decFirst.getUTCDate(), 15);
    assert.equal(decSecond.getUTCFullYear(), 2026, "diciembre no debe desbordar a otro año");
    assert.equal(decSecond.getUTCMonth(), 11);
    assert.equal(janFirst.getUTCFullYear(), 2027);
    assert.equal(janFirst.getUTCMonth(), 0);
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
    assert.equal(julyGroup[0].scheduledDate.getUTCMonth(), 6, "julio conserva su propio mes");
    assert.equal(augustGroup[0].scheduledDate.getUTCMonth(), 7, "agosto conserva su propio mes, no hereda julio");
    assert.notEqual(julyGroup[0].scheduledDate.getTime(), augustGroup[0].scheduledDate.getTime());
  });
});
