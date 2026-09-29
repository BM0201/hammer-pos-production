import assert from "node:assert/strict";
import test from "node:test";
import {
  DEFAULT_LEGAL_RATES,
  IR_TABLE_ANNUAL,
  computePayrollLineBreakdown,
  validateLegalRates,
  type LegalRatesInput,
} from "@/modules/payroll/payroll-nicaragua";
import { resolveLegalRates, hasPostedRunFromEffectiveFrom } from "@/modules/payroll/payroll-rate-config";

/**
 * prompt-nomina-config.md Fase 2 — tasas legales versionadas por vigencia.
 * resolveLegalRates y hasPostedRunFromEffectiveFrom llevan un `db`
 * inyectable (mismo patrón que supersedePendingRequestsForOrderTx) para
 * poder testear la resolución por período y el guard de "período ya
 * posteado" sin base de datos real.
 */

// ─── validateLegalRates ──────────────────────────────────────────────────

const CURRENT_LEGAL_INPUT: LegalRatesInput = {
  ...DEFAULT_LEGAL_RATES,
  legalBasis: "Decreto 06-2019",
};

test("validateLegalRates: la tabla legal actual (constantes de hoy) no tiene errores", () => {
  const errors = validateLegalRates(CURRENT_LEGAL_INPUT);
  assert.deepEqual(errors, []);
});

test("validateLegalRates: una base alterada en 1 córdoba falla", () => {
  const table = IR_TABLE_ANNUAL.map((b) => ({ ...b }));
  table[2] = { ...table[2], base: table[2].base + 1 }; // 15,000 -> 15,001
  const errors = validateLegalRates({ ...CURRENT_LEGAL_INPUT, irTableAnnual: table });
  assert.ok(errors.some((e) => e.includes("Tramo 3") && e.includes("consistente")), errors.join(" | "));
});

test("validateLegalRates: un 'from' no estrictamente creciente falla", () => {
  const table = IR_TABLE_ANNUAL.map((b) => ({ ...b }));
  table[2] = { ...table[2], from: table[1].from }; // empata con el tramo anterior
  const errors = validateLegalRates({ ...CURRENT_LEGAL_INPUT, irTableAnnual: table });
  assert.ok(errors.some((e) => e.includes("Tramo 3") && e.includes("desde")), errors.join(" | "));
});

test("validateLegalRates: una tasa de 1.5 (150%) falla", () => {
  const errors = validateLegalRates({ ...CURRENT_LEGAL_INPUT, inssIntegralLaboral: 1.5 });
  assert.ok(errors.some((e) => e.includes("INSS laboral (Integral)")), errors.join(" | "));
});

test("validateLegalRates: umbral de tamaño de empresa 0 falla (debe ser ≥1)", () => {
  const errors = validateLegalRates({ ...CURRENT_LEGAL_INPUT, inssEmployerSizeThreshold: 0 });
  assert.ok(errors.some((e) => e.includes("umbral")), errors.join(" | "));
});

test("validateLegalRates: legalBasis vacía falla", () => {
  const errors = validateLegalRates({ ...CURRENT_LEGAL_INPUT, legalBasis: "" });
  assert.ok(errors.some((e) => e.includes("base legal")), errors.join(" | "));
});

// ─── resolveLegalRates (fake db) ─────────────────────────────────────────

function fakeVersionRow(id: string, effectiveFromIso: string) {
  return {
    id,
    effectiveFrom: new Date(effectiveFromIso),
    inssIntegralLaboral: 0.075, // distinta de la constante, para distinguir "usó la versión" de "usó el default"
    inssIntegralPatronalLt50: 0.215,
    inssIntegralPatronalGte50: 0.225,
    inssIvmRpLaboral: 0.05,
    inssIvmRpPatronalLt50: 0.155,
    inssIvmRpPatronalGte50: 0.165,
    inssEmployerSizeThreshold: 50,
    inatecRate: 0.02,
    irTableAnnual: IR_TABLE_ANNUAL,
  };
}

function createFakeLegalRatesDb(versions: ReturnType<typeof fakeVersionRow>[]) {
  return {
    payrollLegalRateVersion: {
      findFirst: async (args: { where: { effectiveFrom: { lte: Date } } }) => {
        const cutoff = args.where.effectiveFrom.lte.getTime();
        const candidates = versions.filter((v) => v.effectiveFrom.getTime() <= cutoff);
        if (candidates.length === 0) return null;
        candidates.sort((a, b) => b.effectiveFrom.getTime() - a.effectiveFrom.getTime());
        return candidates[0];
      },
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
    } as any,
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
  } as any;
}

test("resolveLegalRates: sin versiones, devuelve DEFAULT_LEGAL_RATES", async () => {
  const db = createFakeLegalRatesDb([]);
  const result = await resolveLegalRates({ year: 2026, month: 6 }, db);
  assert.equal(result.source, "DEFAULT");
  assert.deepEqual(result.legal, DEFAULT_LEGAL_RATES);
});

test("resolveLegalRates: una versión desde junio, pidiendo mayo, devuelve DEFAULT_LEGAL_RATES", async () => {
  const db = createFakeLegalRatesDb([fakeVersionRow("v-june", "2026-06-01T00:00:00.000Z")]);
  const result = await resolveLegalRates({ year: 2026, month: 5 }, db);
  assert.equal(result.source, "DEFAULT");
});

test("resolveLegalRates: pidiendo junio, devuelve la versión vigente desde junio", async () => {
  const db = createFakeLegalRatesDb([fakeVersionRow("v-june", "2026-06-01T00:00:00.000Z")]);
  const result = await resolveLegalRates({ year: 2026, month: 6 }, db);
  assert.equal(result.source, "v-june");
  assert.equal(result.legal.inssIntegralLaboral, 0.075);
});

test("resolveLegalRates: pidiendo julio, sigue devolviendo la versión de junio (la más reciente ≤ julio)", async () => {
  const db = createFakeLegalRatesDb([fakeVersionRow("v-june", "2026-06-01T00:00:00.000Z")]);
  const result = await resolveLegalRates({ year: 2026, month: 7 }, db);
  assert.equal(result.source, "v-june");
});

// ─── hasPostedRunFromEffectiveFrom (fake db) ─────────────────────────────

function createFakeRunsDb(runs: { year: number; month: number; status: string }[]) {
  return {
    payrollRun: {
      count: async (args: { where: { status: string; OR: [{ year: { gt: number } }, { year: number; month: { gte: number } }] } }) => {
        const { status, OR } = args.where;
        const [gtClause, gteClause] = OR;
        return runs.filter(
          (r) => r.status === status && (r.year > gtClause.year.gt || (r.year === gteClause.year && r.month >= gteClause.month.gte)),
        ).length;
      },
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
    } as any,
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
  } as any;
}

test("hasPostedRunFromEffectiveFrom: hay una POSTED en el mismo mes → true (rechaza)", async () => {
  const db = createFakeRunsDb([{ year: 2026, month: 6, status: "POSTED" }]);
  const result = await hasPostedRunFromEffectiveFrom(new Date("2026-06-01T00:00:00.000Z"), db);
  assert.equal(result, true);
});

test("hasPostedRunFromEffectiveFrom: hay una POSTED en un mes posterior → true (rechaza)", async () => {
  const db = createFakeRunsDb([{ year: 2026, month: 8, status: "POSTED" }]);
  const result = await hasPostedRunFromEffectiveFrom(new Date("2026-06-01T00:00:00.000Z"), db);
  assert.equal(result, true);
});

test("hasPostedRunFromEffectiveFrom: la única POSTED es de un mes anterior → false (permite)", async () => {
  const db = createFakeRunsDb([{ year: 2026, month: 3, status: "POSTED" }]);
  const result = await hasPostedRunFromEffectiveFrom(new Date("2026-06-01T00:00:00.000Z"), db);
  assert.equal(result, false);
});

test("hasPostedRunFromEffectiveFrom: una DRAFT en el mismo mes no cuenta → false", async () => {
  const db = createFakeRunsDb([{ year: 2026, month: 6, status: "DRAFT" }]);
  const result = await hasPostedRunFromEffectiveFrom(new Date("2026-06-01T00:00:00.000Z"), db);
  assert.equal(result, false);
});

// ─── computePayrollLineBreakdown con tabla IR distinta ───────────────────

test("computePayrollLineBreakdown: con DEFAULT_LEGAL_RATES da el mismo resultado que sin pasar `legal` explícito", () => {
  const withExplicitDefault = computePayrollLineBreakdown({
    monthlySalary: 30_000,
    grossSalary: 30_000,
    daysWorked: 30,
    totalDays: 30,
    applyIrRetention: true,
    rates: { inssRegime: "INTEGRAL", activeEmployeeCount: 10, inatecRate: DEFAULT_LEGAL_RATES.inatecRate, aguinaldoMode: "ACCRUE_MONTHLY", vacacionesMode: "ACCRUE_MONTHLY", indemnizacionMode: "ACCRUE_MONTHLY", salarioMinimoSectorial: 0, legal: DEFAULT_LEGAL_RATES },
  });
  const withoutRates = computePayrollLineBreakdown({
    monthlySalary: 30_000,
    grossSalary: 30_000,
    daysWorked: 30,
    totalDays: 30,
    applyIrRetention: true,
  });
  assert.equal(withExplicitDefault.ir, withoutRates.ir);
  assert.equal(withExplicitDefault.inssLaboral, withoutRates.inssLaboral);
});

test("computePayrollLineBreakdown: una tabla IR distinta cambia el IR calculado", () => {
  const higherRateTable = IR_TABLE_ANNUAL.map((b) => ({ ...b, rate: b.rate > 0 ? b.rate + 0.1 : b.rate }));
  const customLegal = { ...DEFAULT_LEGAL_RATES, irTableAnnual: higherRateTable };

  const withDefault = computePayrollLineBreakdown({
    monthlySalary: 50_000,
    grossSalary: 50_000,
    daysWorked: 30,
    totalDays: 30,
    applyIrRetention: true,
    rates: { inssRegime: "INTEGRAL", activeEmployeeCount: 10, inatecRate: DEFAULT_LEGAL_RATES.inatecRate, aguinaldoMode: "ACCRUE_MONTHLY", vacacionesMode: "ACCRUE_MONTHLY", indemnizacionMode: "ACCRUE_MONTHLY", salarioMinimoSectorial: 0, legal: DEFAULT_LEGAL_RATES },
  });
  const withCustomTable = computePayrollLineBreakdown({
    monthlySalary: 50_000,
    grossSalary: 50_000,
    daysWorked: 30,
    totalDays: 30,
    applyIrRetention: true,
    rates: { inssRegime: "INTEGRAL", activeEmployeeCount: 10, inatecRate: DEFAULT_LEGAL_RATES.inatecRate, aguinaldoMode: "ACCRUE_MONTHLY", vacacionesMode: "ACCRUE_MONTHLY", indemnizacionMode: "ACCRUE_MONTHLY", salarioMinimoSectorial: 0, legal: customLegal },
  });
  assert.notEqual(withCustomTable.ir, withDefault.ir);
  assert.ok(withCustomTable.ir > withDefault.ir);
});
