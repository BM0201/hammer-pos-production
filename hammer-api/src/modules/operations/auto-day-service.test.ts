import assert from "node:assert/strict";
import { test } from "node:test";
import { getOperationalDayCloseDeadline, getOperationalDayOpenDeadline } from "@/modules/operations/auto-day-service";
import { flagOperationalDayAutoCloseSkippedTx } from "@/modules/operations/service";
import type { OperationalDayAutoConfig } from "@/modules/operations/auto-day-config";

/**
 * Bug corregido (2026-07-30): el auto-cierre de HOY (`autoCloseEnabled`)
 * fallaba en silencio TODOS los días cuando había un bloqueante duro (lo
 * normal, dado que el auto-cierre de cajas corre antes en el mismo cron y
 * genera justo ese bloqueante) — `result.skipped++` sin ningún rastro. Estos
 * tests cubren las dos piezas puras/aisladas de la solución:
 * 1. El cálculo del deadline (ya era puro, se agrega cobertura de bordes).
 * 2. flagOperationalDayAutoCloseSkippedTx — el registro (Brain + auditoría)
 *    que ahora deja rastro visible en vez de perderse en silencio.
 * (autoCloseTodaysOperationalDaysAtDeadline en sí no es testeable acá sin
 * DATABASE_URL — usa el singleton `prisma` importado directamente.)
 */

const CONFIG: OperationalDayAutoConfig = {
  autoOpenEnabled: true,
  autoCloseEnabled: true,
  timezone: "America/Managua",
  weekdayOpenTime: "07:00",
  saturdayOpenTime: "07:00",
  sundayOpenTime: null,
  weekdayCloseTime: "18:30",
  saturdayCloseTime: "17:00",
  sundayCloseTime: null,
};

// Managua es UTC-6 fijo (sin horario de verano) — 18:30 local = 00:30 UTC del día siguiente.
function managuaTime(isoDateUtcMidnight: string, localHour: number, localMinute: number): Date {
  const base = new Date(isoDateUtcMidnight);
  return new Date(base.getTime() + (localHour + 6) * 3600_000 + localMinute * 60_000);
}

test("getOperationalDayCloseDeadline: disabled cuando autoCloseEnabled es false", () => {
  const result = getOperationalDayCloseDeadline(managuaTime("2026-07-27T00:00:00.000Z", 19, 0), { ...CONFIG, autoCloseEnabled: false });
  assert.equal(result.enabled, false);
  assert.equal(result.passed, false);
});

test("getOperationalDayCloseDeadline: un minuto antes del corte no pasó, un minuto después sí (lunes)", () => {
  // 2026-07-27 es lunes.
  const before = getOperationalDayCloseDeadline(managuaTime("2026-07-27T00:00:00.000Z", 18, 29), CONFIG);
  const after = getOperationalDayCloseDeadline(managuaTime("2026-07-27T00:00:00.000Z", 18, 31), CONFIG);
  assert.equal(before.passed, false);
  assert.equal(after.passed, true);
  assert.equal(after.closeTime, "18:30");
});

test("getOperationalDayCloseDeadline: exacto al minuto de corte ya pasó (inclusive)", () => {
  const exact = getOperationalDayCloseDeadline(managuaTime("2026-07-27T00:00:00.000Z", 18, 30), CONFIG);
  assert.equal(exact.passed, true);
});

test("getOperationalDayCloseDeadline: usa el horario de sábado, distinto al de semana", () => {
  // 2026-08-01 es sábado. Corte sábado = 17:00 (antes que el de semana, 18:30).
  const atWeekdayTimeOnSaturday = getOperationalDayCloseDeadline(managuaTime("2026-08-01T00:00:00.000Z", 18, 0), CONFIG);
  assert.equal(atWeekdayTimeOnSaturday.closeTime, "17:00");
  assert.equal(atWeekdayTimeOnSaturday.passed, true, "18:00 ya pasó el corte de sábado (17:00)");
});

test("getOperationalDayCloseDeadline: domingo sin closeTime configurado -> disabled", () => {
  // 2026-08-02 es domingo.
  const sunday = getOperationalDayCloseDeadline(managuaTime("2026-08-02T00:00:00.000Z", 20, 0), CONFIG);
  assert.equal(sunday.enabled, false);
});

test("getOperationalDayOpenDeadline: simétrico a close (mismo mecanismo, distinto horario)", () => {
  const before = getOperationalDayOpenDeadline(managuaTime("2026-07-27T00:00:00.000Z", 6, 59), CONFIG);
  const after = getOperationalDayOpenDeadline(managuaTime("2026-07-27T00:00:00.000Z", 7, 1), CONFIG);
  assert.equal(before.passed, false);
  assert.equal(after.passed, true);
});

// ── flagOperationalDayAutoCloseSkippedTx: el rastro que antes no existía ──

function createFakeTx() {
  const decisions = new Map<string, Record<string, unknown>>();
  const auditLogs: Array<Record<string, unknown>> = [];
  let nextId = 1;

  const tx = {
    brainDecision: {
      upsert: async (args: { where: { fingerprint: string }; create: Record<string, unknown>; update: Record<string, unknown> }) => {
        const existing = decisions.get(args.where.fingerprint);
        const value = existing ? { ...existing, ...args.update } : { id: `decision-${nextId++}`, ...args.create };
        decisions.set(args.where.fingerprint, value);
        return value;
      },
    },
    auditLog: {
      create: async (args: { data: Record<string, unknown> }) => {
        auditLogs.push(args.data);
        return args.data;
      },
    },
  };

  return { tx: tx as unknown as Parameters<typeof flagOperationalDayAutoCloseSkippedTx>[0], decisions, auditLogs };
}

test("flagOperationalDayAutoCloseSkippedTx: crea una decisión de Brain HIGH + auditoría con los bloqueantes exactos", async () => {
  const { tx, decisions, auditLogs } = createFakeTx();
  const hardBlockers = [
    { key: "auto_closed_pending_review", label: "No hay cierres automaticos pendientes", status: "BLOCKING" as const, count: 1 },
  ];

  await flagOperationalDayAutoCloseSkippedTx(tx, { id: "day-1", branchId: "branch-1" }, hardBlockers);

  const decision = decisions.get("operations:auto-close-skipped:day-1") as Record<string, unknown>;
  assert.ok(decision, "debe crear la decisión con el fingerprint por día");
  assert.equal(decision.category, "SYSTEM");
  assert.equal(decision.severity, "HIGH");
  assert.equal(decision.status, "OPEN");
  assert.equal(decision.proposedActionType, "REVIEW_OPERATIONAL_DAY");
  assert.match(decision.description as string, /No hay cierres automaticos pendientes/);

  assert.ok(auditLogs.some((l) => l.action === "OPERATIONAL_DAY_AUTO_CLOSE_SKIPPED" && l.entityId === "day-1"));
});

test("flagOperationalDayAutoCloseSkippedTx: llamadas repetidas (ticks sucesivos del cron) actualizan, no duplican", async () => {
  const { tx, decisions, auditLogs } = createFakeTx();
  const blockersFirstTick = [{ key: "open_cash_sessions", label: "No hay cajas abiertas o en conciliacion", status: "BLOCKING" as const, count: 2 }];
  const blockersSecondTick = [{ key: "open_cash_sessions", label: "No hay cajas abiertas o en conciliacion", status: "BLOCKING" as const, count: 1 }];

  await flagOperationalDayAutoCloseSkippedTx(tx, { id: "day-2", branchId: "branch-1" }, blockersFirstTick);
  await flagOperationalDayAutoCloseSkippedTx(tx, { id: "day-2", branchId: "branch-1" }, blockersSecondTick);

  assert.equal(decisions.size, 1, "un solo día -> una sola decisión, no una por tick");
  assert.equal(auditLogs.length, 2, "cada tick sí deja su propia línea de auditoría (trazabilidad completa)");
  const decision = decisions.get("operations:auto-close-skipped:day-2") as Record<string, unknown>;
  assert.equal(decision.status, "OPEN");
});
