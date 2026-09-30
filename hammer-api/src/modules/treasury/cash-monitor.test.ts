import assert from "node:assert/strict";
import test from "node:test";
import { projectThresholdReach, detectBelowTypicalCash, computeCashIndicatorState, computeAmountToDeposit, computeDirectDepositAvailable, getAccumulatedRetainedTx } from "@/modules/treasury/cash-monitor";

/**
 * prompt-indicador-efectivo-inteligente.md §8 — pruebas sobre las
 * funciones PURAS del indicador (sin DB): la proyección, la detección de
 * lo raro, y los estados. Los casos que dependen de datos reales
 * (getBranchCashPosition, sendCashOutToCustody) usan el prisma global —
 * mismo criterio del resto del módulo treasury, no se fake-tx-testean.
 */

// ── §3 · Estados ────────────────────────────────────────────────────────

test("Prueba 5 (doc): 27,800 acumulados sobre umbral 30,000 → APPROACHING", () => {
  const state = computeCashIndicatorState({
    accumulatedAmount: 27_800, inTransitAmount: 0, thresholdAmount: 30_000, maxDaysHolding: 5, daysSinceOldestRetained: 1,
  });
  assert.equal(state, "APPROACHING");
});

test("Prueba 6 (doc): 31,000 sobre el mismo umbral → READY", () => {
  const state = computeCashIndicatorState({
    accumulatedAmount: 31_000, inTransitAmount: 0, thresholdAmount: 30_000, maxDaysHolding: 5, daysSinceOldestRetained: 1,
  });
  assert.equal(state, "READY");
});

test("Prueba 7 (doc): 8,450 acumulados, umbral 25,000, 1 día → ACCUMULATING, sin ámbar", () => {
  const state = computeCashIndicatorState({
    accumulatedAmount: 8_450, inTransitAmount: 0, thresholdAmount: 25_000, maxDaysHolding: 5, daysSinceOldestRetained: 1,
  });
  assert.equal(state, "ACCUMULATING");
});

test("Prueba 8 (doc): nada más allá del fondo → CLEAR", () => {
  const state = computeCashIndicatorState({
    accumulatedAmount: 0, inTransitAmount: 0, thresholdAmount: 25_000, maxDaysHolding: 5, daysSinceOldestRetained: 0,
  });
  assert.equal(state, "CLEAR");
});

test("estado IN_TRANSIT_ONLY: nada acumulado, pero hay algo en tránsito", () => {
  const state = computeCashIndicatorState({
    accumulatedAmount: 0, inTransitAmount: 15_000, thresholdAmount: 25_000, maxDaysHolding: 5, daysSinceOldestRetained: 0,
  });
  assert.equal(state, "IN_TRANSIT_ONLY");
});

test("sin política configurada (thresholdAmount null) → ACCUMULATING neutro, no inventa un umbral", () => {
  const state = computeCashIndicatorState({
    accumulatedAmount: 500_000, inTransitAmount: 0, thresholdAmount: null, maxDaysHolding: null, daysSinceOldestRetained: 40,
  });
  assert.equal(state, "ACCUMULATING");
});

test("el doble del umbral → CRITICAL, sin importar los días", () => {
  const state = computeCashIndicatorState({
    accumulatedAmount: 60_000, inTransitAmount: 0, thresholdAmount: 30_000, maxDaysHolding: 30, daysSinceOldestRetained: 1,
  });
  assert.equal(state, "CRITICAL");
});

test("supera maxDaysHolding sin llegar al umbral → OVERDUE (escala en el tiempo, no de golpe)", () => {
  const state = computeCashIndicatorState({
    accumulatedAmount: 10_000, inTransitAmount: 0, thresholdAmount: 30_000, maxDaysHolding: 5, daysSinceOldestRetained: 6,
  });
  assert.equal(state, "OVERDUE");
});

// ── §2.2 · Proyección ───────────────────────────────────────────────────

test("Prueba 9 (doc): menos de dos semanas de historia → sin proyección (confidence LOW, fechas null)", () => {
  const projection = projectThresholdReach({
    currentAmount: 10_000, thresholdAmount: 30_000,
    dailyCashByWeekday: { 0: 1000, 1: 2000, 2: 2000, 3: 2000, 4: 2000, 5: 2000, 6: 1500 },
    weeksOfHistory: 1,
  });
  assert.equal(projection.confidence, "LOW");
  assert.equal(projection.earliestDate, null);
  assert.equal(projection.likelyDate, null);
});

test("Prueba 10 (doc): proyección visible → siempre incluye su base", () => {
  const projection = projectThresholdReach({
    currentAmount: 10_000, thresholdAmount: 15_000,
    dailyCashByWeekday: { 0: 1000, 1: 2000, 2: 2000, 3: 2000, 4: 2000, 5: 2000, 6: 1500 },
    weeksOfHistory: 4,
    now: new Date("2026-08-17T12:00:00Z"), // lunes
  });
  assert.match(projection.basis, /promedio de las últimas 4 semanas/);
  assert.notEqual(projection.likelyDate, null);
});

test("Prueba 11 (doc): un sábado no proyecta con el promedio de los martes — camina día por día con la tasa de CADA día", () => {
  // Martes cobra fuerte (5000), el resto de la semana casi nada (10).
  const rates = { 0: 10, 1: 10, 2: 5000, 3: 10, 4: 10, 5: 10, 6: 10 };
  // Arranca un lunes (2026-08-17) — el próximo martes es 2026-08-18, un solo día después.
  const projection = projectThresholdReach({
    currentAmount: 0, thresholdAmount: 4000,
    dailyCashByWeekday: rates,
    weeksOfHistory: 4,
    now: new Date("2026-08-17T12:00:00Z"),
  });
  assert.notEqual(projection.likelyDate, null);
  // Si usara un promedio plano ((10*6+5000)/7 ≈ 724), tres días ya alcanzarían
  // los 4000 — pero caminando día por día, el lunes (10) no alcanza y hace
  // falta llegar al martes (día siguiente) para sumar los 5000 reales.
  assert.equal(projection.likelyDate!.getUTCDay(), 2, "debe caer en martes, el único día que realmente cobra fuerte");
});

test("ya alcanzó el umbral → proyección HIGH, earliest=likely=ahora", () => {
  const now = new Date("2026-08-17T12:00:00Z");
  const projection = projectThresholdReach({
    currentAmount: 35_000, thresholdAmount: 30_000,
    dailyCashByWeekday: { 0: 1000, 1: 2000, 2: 2000, 3: 2000, 4: 2000, 5: 2000, 6: 1500 },
    weeksOfHistory: 4,
    now,
  });
  assert.equal(projection.confidence, "HIGH");
  assert.equal(projection.earliestDate?.getTime(), now.getTime());
  assert.equal(projection.likelyDate?.getTime(), now.getTime());
});

test("sin desvío por día de semana → el rango colapsa a un punto (earliest === likely), no se inventa variabilidad", () => {
  const projection = projectThresholdReach({
    currentAmount: 0, thresholdAmount: 2000,
    dailyCashByWeekday: { 0: 1000, 1: 1000, 2: 1000, 3: 1000, 4: 1000, 5: 1000, 6: 1000 },
    weeksOfHistory: 4,
    now: new Date("2026-08-17T12:00:00Z"),
  });
  assert.equal(projection.earliestDate?.getTime(), projection.likelyDate?.getTime());
});

test("con desvío por día de semana → earliest llega antes o igual que likely, nunca después", () => {
  const projection = projectThresholdReach({
    currentAmount: 0, thresholdAmount: 5000,
    dailyCashByWeekday: { 0: 500, 1: 500, 2: 500, 3: 500, 4: 500, 5: 500, 6: 500 },
    dailyCashStddevByWeekday: { 0: 300, 1: 300, 2: 300, 3: 300, 4: 300, 5: 300, 6: 300 },
    weeksOfHistory: 4,
    now: new Date("2026-08-17T12:00:00Z"),
  });
  assert.notEqual(projection.earliestDate, null);
  assert.notEqual(projection.likelyDate, null);
  assert.ok(projection.earliestDate!.getTime() <= projection.likelyDate!.getTime());
});

// ── §2.3 · Lo raro ──────────────────────────────────────────────────────

test("cobro de hoy muy por debajo de lo típico para ese día (>2 desviaciones) → detecta la anomalía", () => {
  const anomaly = detectBelowTypicalCash({
    todayAmount: 500, weekday: 2, meanForWeekday: 5000, stddevForWeekday: 1000, samplesForWeekday: 8,
  });
  assert.notEqual(anomaly, null);
  assert.match(anomaly!.message, /martes típico/);
});

test("cobro de hoy dentro de dos desviaciones → sin anomalía", () => {
  const anomaly = detectBelowTypicalCash({
    todayAmount: 4200, weekday: 2, meanForWeekday: 5000, stddevForWeekday: 1000, samplesForWeekday: 8,
  });
  assert.equal(anomaly, null);
});

test("con poca historia para ese día de semana (menos de 3 muestras) → no se aventura a decir 'típico'", () => {
  const anomaly = detectBelowTypicalCash({
    todayAmount: 100, weekday: 2, meanForWeekday: 5000, stddevForWeekday: 1000, samplesForWeekday: 2,
  });
  assert.equal(anomaly, null);
});

// ── §2.1 · Para depositar (prompt-correccion-ubicacion-formula-datos-prueba.md) ──

test("Prueba 1 (doc): hoy=0, acumulado=100, sin fondo → amount:100, floorConfigured:false", () => {
  const result = computeAmountToDeposit({ cashInDrawerToday: 0, accumulatedAmount: 100, cashFloor: null });
  assert.equal(result.amount, 100);
  assert.equal(result.floorConfigured, false);
});

// prompt-tesoreria-custodia-sucursal.md Fase 2 (fix) — Prueba 2 y 3 cambian
// de valor esperado: la versión anterior consagraba la resta doble del
// fondo (lo restaba de gaveta+acumulado, no solo de la gaveta). Con
// cashInDrawerToday=0 en ambas, el fondo ya no tiene nada de la gaveta que
// descontar — el acumulado, que YA excluye el fondo desde que se declaró,
// sale completo.
test("Prueba 2 (doc, corregida): fondo mayor que la gaveta (que está en 0) — no come del acumulado, amount:100", () => {
  const result = computeAmountToDeposit({ cashInDrawerToday: 0, accumulatedAmount: 100, cashFloor: 150 });
  assert.equal(result.amount, 100);
  assert.equal(result.floorConfigured, true);
});

test("Prueba 3 (doc, corregida): fondo en 30 pero la gaveta está en 0 — el fondo no toca el acumulado, amount:100", () => {
  const result = computeAmountToDeposit({ cashInDrawerToday: 0, accumulatedAmount: 100, cashFloor: 30 });
  assert.equal(result.amount, 100);
  assert.equal(result.floorConfigured, true);
});

test("computeAmountToDeposit: suma SIEMPRE los dos términos, hoy y acumulado juntos", () => {
  const result = computeAmountToDeposit({ cashInDrawerToday: 5000, accumulatedAmount: 12000, cashFloor: null });
  assert.equal(result.amount, 17000);
});

// prompt-tesoreria-custodia-sucursal.md Fase 2 (fix) — antes esperaba 0
// (resta doble: (10+5)-10000 truncado en 0, comiéndose también el
// acumulado). Ahora el fondo solo puede comerse la gaveta (10 → 0); el
// acumulado (5) nunca se toca, así que el resultado es 5, no 0.
test("computeAmountToDeposit: el fondo nunca hace que el resultado baje del acumulado, aunque supere la gaveta muchas veces", () => {
  const result = computeAmountToDeposit({ cashInDrawerToday: 10, accumulatedAmount: 5, cashFloor: 10000 });
  assert.equal(result.amount, 5);
});

// prompt-tesoreria-custodia-sucursal.md Fase 2 — los tres casos exactos del
// doc, con el monto real que reportó el síntoma en producción (588,435.90).
test("LA QUE IMPORTA (doc) — acumulado 588,435.90, gaveta 0, fondo 400 → 588,435.90 (el mismo síntoma reportado)", () => {
  const result = computeAmountToDeposit({ cashInDrawerToday: 0, accumulatedAmount: 588_435.90, cashFloor: 400 });
  assert.equal(result.amount, 588_435.90);
});

test("(doc) — acumulado 0, gaveta 1,000, fondo 400 → 600", () => {
  const result = computeAmountToDeposit({ cashInDrawerToday: 1000, accumulatedAmount: 0, cashFloor: 400 });
  assert.equal(result.amount, 600);
});

test("(doc) — acumulado 500, gaveta 300, fondo 400 → 500 (la gaveta no alcanza el fondo, aporta 0)", () => {
  const result = computeAmountToDeposit({ cashInDrawerToday: 300, accumulatedAmount: 500, cashFloor: 400 });
  assert.equal(result.amount, 500);
});

// ── prompt-tesoreria-depositos.md Fase 1 (fix Bug 1) ────────────────────

test("computeDirectDepositAvailable: hoy es simplemente el acumulado (identidad, con nombre propio para el futuro)", () => {
  assert.equal(computeDirectDepositAvailable(1000), 1000);
  assert.equal(computeDirectDepositAvailable(0), 0);
});

/**
 * getAccumulatedRetainedTx — con `db` inyectable (mismo patrón que
 * account-payment.test.ts), sin base de datos real. La prueba que importa
 * es la última: la función NUNCA consulta CashSession — no puede incluir la
 * gaveta abierta aunque quisiera, es estructuralmente imposible, no solo
 * "no lo hace hoy".
 */
function buildFakeRetainedDb(opts: {
  cutoffEntry?: { occurredAt: Date } | null;
  declarations: Array<{ retainAwaitingDepositPortion: number; createdAt: Date }>;
  cashExpenseEntries?: Array<{ occurredAt: Date; amount: number; expensePaymentId: string }>;
  activeExpenseIds?: string[];
  // prompt-tesoreria-sin-transito.md Fase 1.2 — los dos términos nuevos de
  // getAccumulatedRetainedTx. Vacíos por default: preserva exactamente el
  // comportamiento de los tests ya existentes, que no los conocían.
  directDeposits?: Array<{ amount: number; depositedAt: Date }>;
  adjustments?: Array<{ amount: number; createdAt: Date }>;
}) {
  const declarations = opts.declarations;
  const cashExpenseEntries = opts.cashExpenseEntries ?? [];
  const activeExpenseIds = new Set(opts.activeExpenseIds ?? cashExpenseEntries.map((e) => e.expensePaymentId));
  const directDeposits = opts.directDeposits ?? [];
  const adjustments = opts.adjustments ?? [];

  const db = {
    treasuryEntry: {
      // getLastDepositCutoff (DEPOSIT_DISPATCH/DEPOSIT_CONFIRMED) y
      // getActiveRetainedCashExpenses (EXPENSE/SAFE) comparten esta misma
      // tabla fake — se distinguen por el shape del where, no hace falta
      // más que devolver lo que cada uno espera.
      findFirst: async () => opts.cutoffEntry ?? null,
      findMany: async ({ where }: { where: { occurredAt?: { gt: Date } } }) =>
        cashExpenseEntries.filter((e) => !where.occurredAt || e.occurredAt > where.occurredAt.gt),
    },
    cashDestinationDeclaration: {
      findMany: async ({ where }: { where: { createdAt?: { gt: Date } } }) =>
        declarations.filter((d) => !where.createdAt || d.createdAt > where.createdAt.gt),
    },
    operatingExpense: {
      findMany: async ({ where }: { where: { id: { in: string[] } } }) =>
        where.id.in.filter((id) => activeExpenseIds.has(id)).map((id) => ({ id })),
    },
    bankDeposit: {
      findMany: async ({ where }: { where: { depositedAt?: { gt: Date } } }) =>
        directDeposits.filter((d) => !where.depositedAt || d.depositedAt > where.depositedAt.gt),
    },
    retainedCashAdjustment: {
      findMany: async ({ where }: { where: { createdAt?: { gt: Date } } }) =>
        adjustments.filter((a) => !where.createdAt || a.createdAt > where.createdAt.gt),
    },
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
  } as any;

  return db;
}

test("getAccumulatedRetainedTx: sin corte previo, suma todas las declaraciones retenidas", async () => {
  const db = buildFakeRetainedDb({
    cutoffEntry: null,
    declarations: [
      { retainAwaitingDepositPortion: 1000, createdAt: new Date("2026-01-01") },
      { retainAwaitingDepositPortion: 2000, createdAt: new Date("2026-01-02") },
    ],
  });
  const result = await getAccumulatedRetainedTx(db, "branch-1");
  assert.equal(result.accumulatedAmount, 3000);
  assert.deepEqual(result.oldestRetainedAt, new Date("2026-01-01"));
});

test("getAccumulatedRetainedTx: con corte, solo cuenta declaraciones POSTERIORES al último despacho/confirmación", async () => {
  const db = buildFakeRetainedDb({
    cutoffEntry: { occurredAt: new Date("2026-01-05") },
    declarations: [
      { retainAwaitingDepositPortion: 1000, createdAt: new Date("2026-01-02") }, // antes del corte, no cuenta
      { retainAwaitingDepositPortion: 500, createdAt: new Date("2026-01-06") },
    ],
  });
  const result = await getAccumulatedRetainedTx(db, "branch-1");
  assert.equal(result.accumulatedAmount, 500);
});

test("getAccumulatedRetainedTx: un gasto pagado con efectivo retenido baja el acumulado", async () => {
  const db = buildFakeRetainedDb({
    cutoffEntry: null,
    declarations: [{ retainAwaitingDepositPortion: 1000, createdAt: new Date("2026-01-01") }],
    cashExpenseEntries: [{ occurredAt: new Date("2026-01-02"), amount: 300, expensePaymentId: "exp-1" }],
  });
  const result = await getAccumulatedRetainedTx(db, "branch-1");
  assert.equal(result.accumulatedAmount, 700);
});

test("getAccumulatedRetainedTx: nunca da negativo aunque los gastos superen lo declarado", async () => {
  const db = buildFakeRetainedDb({
    cutoffEntry: null,
    declarations: [{ retainAwaitingDepositPortion: 200, createdAt: new Date("2026-01-01") }],
    cashExpenseEntries: [{ occurredAt: new Date("2026-01-02"), amount: 500, expensePaymentId: "exp-1" }],
  });
  const result = await getAccumulatedRetainedTx(db, "branch-1");
  assert.equal(result.accumulatedAmount, 0);
});

// prompt-tesoreria-sin-transito.md Fase 1.2 (fix) — los dos términos nuevos
// de getAccumulatedRetainedTx, directo (sin pasar por getLastDepositCutoff).

test("LA QUE IMPORTA — un depósito directo (DIRECT_FROM_RETAINED, no anulado) resta del acumulado", async () => {
  const db = buildFakeRetainedDb({
    cutoffEntry: null,
    declarations: [{ retainAwaitingDepositPortion: 1000, createdAt: new Date("2026-01-01") }],
    directDeposits: [{ amount: 600, depositedAt: new Date("2026-01-02") }],
  });
  const result = await getAccumulatedRetainedTx(db, "branch-1");
  assert.equal(result.accumulatedAmount, 400, "1000 declarado - 600 depositado directo = 400, sin pasar por custodia");
});

test("(doc) — dos depósitos directos (600 y 400) sobre un acumulado de 1000: queda en 0", async () => {
  const db = buildFakeRetainedDb({
    cutoffEntry: null,
    declarations: [{ retainAwaitingDepositPortion: 1000, createdAt: new Date("2026-01-01") }],
    directDeposits: [
      { amount: 600, depositedAt: new Date("2026-01-02") },
      { amount: 400, depositedAt: new Date("2026-01-03") },
    ],
  });
  const result = await getAccumulatedRetainedTx(db, "branch-1");
  assert.equal(result.accumulatedAmount, 0, "1000 - 600 - 400 = 0 — un tercer depósito de cualquier monto positivo ya se rechazaría en depositBranchCashDirectTx");
});

test("un ajuste positivo (RetainedCashAdjustment) suma al acumulado — el caso de devolver un remanente legacy de custodia", async () => {
  const db = buildFakeRetainedDb({
    cutoffEntry: null,
    declarations: [{ retainAwaitingDepositPortion: 1000, createdAt: new Date("2026-01-01") }],
    adjustments: [{ amount: 250, createdAt: new Date("2026-01-03") }],
  });
  const result = await getAccumulatedRetainedTx(db, "branch-1");
  assert.equal(result.accumulatedAmount, 1250);
});

test("un ajuste negativo resta del acumulado, con signo — no hace falta un segundo camino para restar", async () => {
  const db = buildFakeRetainedDb({
    cutoffEntry: null,
    declarations: [{ retainAwaitingDepositPortion: 1000, createdAt: new Date("2026-01-01") }],
    adjustments: [{ amount: -300, createdAt: new Date("2026-01-03") }],
  });
  const result = await getAccumulatedRetainedTx(db, "branch-1");
  assert.equal(result.accumulatedAmount, 700);
});

test("depósito directo Y ajuste juntos, nunca da negativo", async () => {
  const db = buildFakeRetainedDb({
    cutoffEntry: null,
    declarations: [{ retainAwaitingDepositPortion: 500, createdAt: new Date("2026-01-01") }],
    directDeposits: [{ amount: 500, depositedAt: new Date("2026-01-02") }],
    adjustments: [{ amount: -100, createdAt: new Date("2026-01-03") }],
  });
  const result = await getAccumulatedRetainedTx(db, "branch-1");
  assert.equal(result.accumulatedAmount, 0, "500 - 500 - 100 sería -100, pero nunca es negativo");
});

test("getAccumulatedRetainedTx: NUNCA consulta CashSession — la gaveta abierta no puede colarse en el resultado (fix Bug 1)", async () => {
  const db = buildFakeRetainedDb({
    cutoffEntry: null,
    declarations: [{ retainAwaitingDepositPortion: 1000, createdAt: new Date("2026-01-01") }],
  });
  // Si la implementación alguna vez intentara leer la gaveta abierta,
  // db.cashSession ni siquiera existe acá — explotaría en vez de devolver
  // un número inflado en silencio.
  const result = await getAccumulatedRetainedTx(db, "branch-1");
  assert.equal(result.accumulatedAmount, 1000, "el acumulado sale solo de lo retenido, nunca de la gaveta");
});

// ── prompt-tesoreria-custodia-sucursal.md Fase 1.3 (fix) ────────────────
//
// getLastDepositCutoff (privada) solo se puede probar a través de
// getAccumulatedRetainedTx — acá el fake SÍ evalúa el where real (a
// diferencia de buildFakeRetainedDb de arriba, que solo devuelve un
// cutoffEntry fijo): la prueba que importa es que una entrada con
// bankDeposit de OTRA sucursal no mueve el corte de esta.

type CutoffCandidate = {
  entryType: "DEPOSIT_DISPATCH" | "DEPOSIT_CONFIRMED";
  occurredAt: Date;
  accountType: "CUSTODY" | "BANK";
  accountBranchId: string | null;
  bankDepositBranchId?: string; // undefined = sin BankDeposit todavía
  // prompt-tesoreria-sin-transito.md Fase 1.2 — solo importa cuando
  // bankDepositBranchId está definido (si no hay BankDeposit, no hay
  // source que mirar). Default "CUSTODY": los candidatos existentes de
  // antes de esta fase representan depósitos clásicos.
  bankDepositSource?: "CUSTODY" | "DIRECT_FROM_RETAINED";
};

function buildFakeCutoffAttributionDb(opts: { cutoffCandidates: CutoffCandidate[]; declarations: Array<{ retainAwaitingDepositPortion: number; createdAt: Date }> }) {
  const db = {
    treasuryEntry: {
      // Reproduce el where real de getLastDepositCutoff: entryType in [...],
      // account.type = CUSTODY, y el OR de bankDeposit.{branchId,source} /
      // (sin depósito + account.branchId) — no una función fake que ignora
      // el where, para probar la atribución de verdad.
      findFirst: async ({ where }: {
        where: {
          entryType: { in: string[] };
          account: { type: string };
          OR: Array<{ bankDeposit?: { branchId: string; source: string }; bankDepositId?: null; account?: { branchId: string } }>;
        };
      }) => {
        const viaDeposit = where.OR.find((c) => c.bankDeposit !== undefined)?.bankDeposit;
        const branchViaAccount = where.OR.find((c) => c.bankDepositId === null)?.account?.branchId;
        const matches = opts.cutoffCandidates
          .filter((c) => where.entryType.in.includes(c.entryType) && c.accountType === where.account.type)
          .filter((c) =>
            (c.bankDepositBranchId !== undefined && c.bankDepositBranchId === viaDeposit?.branchId && (c.bankDepositSource ?? "CUSTODY") === viaDeposit?.source) ||
            (c.bankDepositBranchId === undefined && c.accountBranchId === branchViaAccount),
          )
          .sort((a, b) => b.occurredAt.getTime() - a.occurredAt.getTime());
        return matches[0] ? { occurredAt: matches[0].occurredAt } : null;
      },
      findMany: async () => [],
    },
    cashDestinationDeclaration: {
      findMany: async ({ where }: { where: { createdAt?: { gt: Date } } }) =>
        opts.declarations.filter((d) => !where.createdAt || d.createdAt > where.createdAt.gt),
    },
    operatingExpense: { findMany: async () => [] },
    bankDeposit: { findMany: async () => [] },
    retainedCashAdjustment: { findMany: async () => [] },
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
  } as any;
  return db;
}

test("LA QUE IMPORTA — una entrada con BankDeposit de OTRA sucursal no mueve el corte de esta sucursal", async () => {
  // Custodia legacy de Master, históricamente branchId=A: un depósito
  // directo para B queda registrado con bankDeposit.branchId=B (gracias a
  // 1.2), aunque la custodia física sea la de A.
  const db = buildFakeCutoffAttributionDb({
    cutoffCandidates: [
      { entryType: "DEPOSIT_DISPATCH", occurredAt: new Date("2026-01-10"), accountType: "CUSTODY", accountBranchId: "branch-A", bankDepositBranchId: "branch-B" },
    ],
    declarations: [
      { retainAwaitingDepositPortion: 5000, createdAt: new Date("2026-01-05") }, // branch-A: antes del despacho para B, pero el corte de A no se mueve
    ],
  });
  const resultA = await getAccumulatedRetainedTx(db, "branch-A");
  assert.equal(resultA.accumulatedAmount, 5000, "el acumulado de A NO baja por un despacho que en realidad era para B");
});

test("LA QUE IMPORTA — el mismo despacho SÍ mueve el corte de la sucursal a la que realmente pertenece (BankDeposit.branchId)", async () => {
  const db = buildFakeCutoffAttributionDb({
    cutoffCandidates: [
      { entryType: "DEPOSIT_DISPATCH", occurredAt: new Date("2026-01-10"), accountType: "CUSTODY", accountBranchId: "branch-A", bankDepositBranchId: "branch-B" },
    ],
    declarations: [
      { retainAwaitingDepositPortion: 5000, createdAt: new Date("2026-01-05") }, // branch-B: antes del despacho, ya no cuenta
    ],
  });
  const resultB = await getAccumulatedRetainedTx(db, "branch-B");
  assert.equal(resultB.accumulatedAmount, 0, "el acumulado de B SÍ baja — el despacho era suyo de verdad, aunque la custodia sea de A");
});

test("un despacho SIN depósito todavía (sendCashOutToCustody) mueve el corte por la sucursal de la CUENTA, no por BankDeposit", async () => {
  const db = buildFakeCutoffAttributionDb({
    cutoffCandidates: [
      { entryType: "DEPOSIT_DISPATCH", occurredAt: new Date("2026-01-10"), accountType: "CUSTODY", accountBranchId: "branch-B" }, // bankDepositBranchId undefined: aún no hay BankDeposit
    ],
    declarations: [
      { retainAwaitingDepositPortion: 3000, createdAt: new Date("2026-01-05") },
    ],
  });
  const resultB = await getAccumulatedRetainedTx(db, "branch-B");
  assert.equal(resultB.accumulatedAmount, 0, "sin BankDeposit, se atribuye por la cuenta — que con la custodia por (persona,sucursal) de 1.1 ya es la correcta");
});

// prompt-tesoreria-sin-transito.md Fase 1.2 (fix) — LOS DOS del test que
// pide el doc: un depósito DIRECT_FROM_RETAINED no mueve el corte; uno
// CUSTODY sí. Ya no basta con la sucursal — el source también importa.

test("LA QUE IMPORTA — un despacho ligado a un BankDeposit DIRECT_FROM_RETAINED NO mueve el corte (ese depósito resta directo del acumulado, no 'limpia' nada)", async () => {
  const db = buildFakeCutoffAttributionDb({
    cutoffCandidates: [
      { entryType: "DEPOSIT_DISPATCH", occurredAt: new Date("2026-01-10"), accountType: "CUSTODY", accountBranchId: "branch-B", bankDepositBranchId: "branch-B", bankDepositSource: "DIRECT_FROM_RETAINED" },
    ],
    declarations: [
      { retainAwaitingDepositPortion: 5000, createdAt: new Date("2026-01-05") },
    ],
  });
  const result = await getAccumulatedRetainedTx(db, "branch-B");
  assert.equal(result.accumulatedAmount, 5000, "un depósito directo no mueve el corte — su resta pasa por otro término (bankDeposit.findMany), no por acá");
});

test("el mismo despacho, pero source CUSTODY (el depósito clásico): SÍ mueve el corte", async () => {
  const db = buildFakeCutoffAttributionDb({
    cutoffCandidates: [
      { entryType: "DEPOSIT_DISPATCH", occurredAt: new Date("2026-01-10"), accountType: "CUSTODY", accountBranchId: "branch-B", bankDepositBranchId: "branch-B", bankDepositSource: "CUSTODY" },
    ],
    declarations: [
      { retainAwaitingDepositPortion: 5000, createdAt: new Date("2026-01-05") },
    ],
  });
  const result = await getAccumulatedRetainedTx(db, "branch-B");
  assert.equal(result.accumulatedAmount, 0, "un depósito CUSTODY sí mueve el corte, igual que siempre");
});
