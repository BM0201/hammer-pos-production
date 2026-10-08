import assert from "node:assert/strict";
import test from "node:test";
import { Prisma } from "@prisma/client";
import {
  reopenDecisionOnRedetect,
  shouldAutoCloseAfterScan,
  persistBrainDecisions,
  autoResolveNotRedetected,
  acquireScanRunLockTx,
  resolveBrainDecisionTx,
  dismissBrainDecisionTx,
  reopenBrainDecisionTx,
  runBrainDecisionTx,
} from "@/modules/brain/service";
import { makeDecisionFingerprint } from "@/modules/brain/scoring";
import type { BrainDecisionDraft } from "@/modules/brain/types";

/** persistBrainDecisions busca por el fingerprint REAL (sha256 de fingerprintParts) — un literal "fp-1" a mano en el fixture nunca matchearía contra lo que el draft produce. */
const FP1 = makeDecisionFingerprint(["fp-1"]);

/**
 * prompt-brain-centro-decisiones.md Fase 1 — tests requeridos por el doc:
 * cierre automático, reglas de reapertura, persistencia sin ruido,
 * acciones atómicas y el candado del escaneo. Fake-db en memoria (mismo
 * patrón que current-prices.test.ts/price-update-batch-apply-service.test.ts
 * esta sesión) — nada de esto toca Prisma real.
 */

const ACTOR = "user-1";

/* ── reopenDecisionOnRedetect — pura, sin DB ── */

test("reopenDecisionOnRedetect — RESOLVED siempre reabre, sin importar la fuente ni el tiempo transcurrido", () => {
  const result = reopenDecisionOnRedetect({ status: "RESOLVED", resolvedAt: new Date(), dismissedSeverity: null }, "HIGH", new Date());
  assert.deepEqual(result, { skip: false, reopen: true });
});

test("LA QUE IMPORTA — DISMISSED no reabre si la severidad nueva NO es mayor que la que tenía al descartarse", () => {
  const now = new Date();
  const sameOrLower = reopenDecisionOnRedetect({ status: "DISMISSED", resolvedAt: now, dismissedSeverity: "HIGH" }, "MEDIUM", now);
  assert.deepEqual(sameOrLower, { skip: true, reopen: false });
  const same = reopenDecisionOnRedetect({ status: "DISMISSED", resolvedAt: now, dismissedSeverity: "HIGH" }, "HIGH", now);
  assert.deepEqual(same, { skip: true, reopen: false });
});

test("LA QUE IMPORTA — DISMISSED SÍ reabre si la severidad nueva es mayor que dismissedSeverity", () => {
  const now = new Date();
  const result = reopenDecisionOnRedetect({ status: "DISMISSED", resolvedAt: now, dismissedSeverity: "MEDIUM" }, "CRITICAL", now);
  assert.deepEqual(result, { skip: false, reopen: true });
});

test("LA QUE IMPORTA — EXECUTED dentro de las 24h de gracia NO reabre", () => {
  const now = new Date("2026-01-02T10:00:00Z");
  const resolvedAt = new Date("2026-01-02T00:00:00Z"); // 10h antes
  const result = reopenDecisionOnRedetect({ status: "EXECUTED", resolvedAt, dismissedSeverity: null }, "HIGH", now);
  assert.deepEqual(result, { skip: true, reopen: false });
});

test("LA QUE IMPORTA — EXECUTED pasadas las 24h SÍ reabre", () => {
  const now = new Date("2026-01-03T01:00:00Z");
  const resolvedAt = new Date("2026-01-02T00:00:00Z"); // 25h antes
  const result = reopenDecisionOnRedetect({ status: "EXECUTED", resolvedAt, dismissedSeverity: null }, "HIGH", now);
  assert.deepEqual(result, { skip: false, reopen: true });
});

test("SNOOZED/FAILED/EXPIRED reabren igual que antes (sin cambios de comportamiento)", () => {
  const now = new Date();
  for (const status of ["SNOOZED", "FAILED", "EXPIRED"] as const) {
    assert.deepEqual(reopenDecisionOnRedetect({ status, resolvedAt: null, dismissedSeverity: null }, "LOW", now), { skip: false, reopen: true });
  }
});

/* ── shouldAutoCloseAfterScan — pura ── */

test("LA QUE IMPORTA — shouldAutoCloseAfterScan: solo SCHEDULED_SCAN, con el detector ok y sin tope", () => {
  assert.equal(shouldAutoCloseAfterScan("SCHEDULED_SCAN", { ok: true, capped: false }), true);
  assert.equal(shouldAutoCloseAfterScan("SCHEDULED_SCAN", { ok: false, capped: false }), false, "detector con error no cierra nada");
  assert.equal(shouldAutoCloseAfterScan("SCHEDULED_SCAN", { ok: true, capped: true }), false, "detector que llegó al tope no cierra nada — no vio todo");
  assert.equal(shouldAutoCloseAfterScan("QUICK_SCAN", { ok: true, capped: false }), false, "un escaneo parcial (QUICK) nunca cierra nada");
});

/* ── Fake DB compartido para el resto de los tests ── */

type FakeDecision = {
  id: string;
  fingerprint: string;
  status: string;
  severity: string;
  detectorKey: string | null;
  branchId: string | null;
  category: string;
  lastDetectedAt: Date;
  resolvedAt: Date | null;
  resolvedByUserId: string | null;
  resolutionSource: string | null;
  resolutionNote: string | null;
  dismissedSeverity: string | null;
  expiresAt: Date | null;
  proposedActionType: string | null;
  idempotencyKey: string | null;
  [key: string]: unknown;
};

function baseDecision(overrides: Partial<FakeDecision> & { id: string; fingerprint: string }): FakeDecision {
  return {
    status: "OPEN",
    severity: "MEDIUM",
    detectorKey: "pricing-detector",
    branchId: null,
    category: "PRICING",
    lastDetectedAt: new Date("2026-01-01T00:00:00Z"),
    resolvedAt: null,
    resolvedByUserId: null,
    resolutionSource: null,
    resolutionNote: null,
    dismissedSeverity: null,
    expiresAt: null,
    proposedActionType: null,
    idempotencyKey: null,
    ...overrides,
  };
}

function clone<T>(value: T | undefined): T | null {
  return value === undefined ? null : { ...value };
}

function createFakeDb(opts: { decisions?: FakeDecision[]; scanRuns?: Array<Record<string, unknown>> } = {}) {
  const decisions: FakeDecision[] = opts.decisions ?? [];
  const actionLogs: Array<Record<string, unknown>> = [];
  const auditLogs: Array<Record<string, unknown>> = [];
  const scanRuns: Array<Record<string, unknown>> = opts.scanRuns ?? [];

  const db = {
    brainDecision: {
      // Clonar en CADA lectura — Prisma real devuelve objetos nuevos por
      // consulta; un `update()` posterior nunca muta lo que una lectura
      // anterior ya tenía en la mano. Devolver la referencia directa del
      // array (como antes) hacía que `existing.severity` leído DESPUÉS de
      // actualizar la fila ya reflejara el valor NUEVO (mismo objeto),
      // disparando falsos "sin cambios" en persistBrainDecisions.
      findUnique: async ({ where }: { where: { id?: string; fingerprint?: string } }) => {
        if (where.id) return clone(decisions.find((d) => d.id === where.id));
        if (where.fingerprint) return clone(decisions.find((d) => d.fingerprint === where.fingerprint));
        return null;
      },
      findMany: async ({ where }: { where?: { fingerprint?: { in: string[] }; status?: { in: string[] }; detectorKey?: string; branchId?: string; lastDetectedAt?: { lt: Date } } }) => {
        return decisions.filter((d) => {
          if (where?.fingerprint?.in && !where.fingerprint.in.includes(d.fingerprint)) return false;
          if (where?.status?.in && !where.status.in.includes(d.status)) return false;
          if (where?.detectorKey !== undefined && d.detectorKey !== where.detectorKey) return false;
          if (where?.branchId !== undefined && d.branchId !== where.branchId) return false;
          if (where?.lastDetectedAt?.lt && !(d.lastDetectedAt < where.lastDetectedAt.lt)) return false;
          return true;
        }).map((d) => ({ ...d }));
      },
      create: async ({ data }: { data: Record<string, unknown> }) => {
        const created = baseDecision({ id: `d${decisions.length + 1}`, fingerprint: String(data.fingerprint), ...data } as Partial<FakeDecision> & { id: string; fingerprint: string });
        decisions.push(created);
        return created;
      },
      update: async ({ where, data }: { where: { id: string }; data: Record<string, unknown> }) => {
        const found = decisions.find((d) => d.id === where.id);
        if (!found) throw new Error("NOT_FOUND");
        Object.assign(found, resolveRelationalData(data));
        return found;
      },
      updateMany: async ({ where, data }: { where: { id?: string | { in: string[] }; status?: string | { in: string[] }; expiresAt?: { lt: Date } }; data: Record<string, unknown> }) => {
        const matching = decisions.filter((d) => {
          if (where.id) {
            if (typeof where.id === "string") { if (d.id !== where.id) return false; }
            else if (!where.id.in.includes(d.id)) return false;
          }
          if (where.status !== undefined) {
            if (typeof where.status === "string") { if (d.status !== where.status) return false; }
            else if (!where.status.in.includes(d.status)) return false;
          }
          if (where.expiresAt?.lt && !(d.expiresAt && d.expiresAt < where.expiresAt.lt)) return false;
          return true;
        });
        for (const d of matching) Object.assign(d, resolveRelationalData(data));
        return { count: matching.length };
      },
    },
    brainDecisionActionLog: {
      create: async ({ data }: { data: Record<string, unknown> }) => { actionLogs.push(data); return data; },
      createMany: async ({ data }: { data: Array<Record<string, unknown>> }) => { actionLogs.push(...data); return { count: data.length }; },
    },
    auditLog: {
      create: async ({ data }: { data: Record<string, unknown> }) => { auditLogs.push(data); return data; },
    },
    brainScanRun: {
      create: async ({ data }: { data: Record<string, unknown> }) => {
        if (data.runningLock != null && scanRuns.some((r) => r.runningLock === data.runningLock)) {
          throw new Prisma.PrismaClientKnownRequestError("Unique constraint failed", { code: "P2002", clientVersion: "test" });
        }
        const created = { id: `run${scanRuns.length + 1}`, startedAt: new Date(), status: "RUNNING", ...data };
        scanRuns.push(created);
        return created;
      },
      findUnique: async ({ where }: { where: { runningLock?: string } }) => scanRuns.find((r) => r.runningLock === where.runningLock) ?? null,
      update: async ({ where, data }: { where: { id: string }; data: Record<string, unknown> }) => {
        const found = scanRuns.find((r) => r.id === where.id);
        if (!found) throw new Error("NOT_FOUND");
        Object.assign(found, data);
        return found;
      },
    },
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
  } as any;

  return { db, decisions, actionLogs, auditLogs, scanRuns };
}

/** Las acciones usan `resolvedBy: {disconnect:true}` (sintaxis de relación) en vez de resolvedByUserId:null directo — el fake solo entiende columnas planas. */
function resolveRelationalData(data: Record<string, unknown>): Record<string, unknown> {
  const resolved = { ...data };
  if (resolved.resolvedBy && typeof resolved.resolvedBy === "object") {
    const rel = resolved.resolvedBy as { disconnect?: boolean; connect?: { id: string } };
    resolved.resolvedByUserId = rel.connect ? rel.connect.id : null;
    delete resolved.resolvedBy;
  }
  return resolved;
}

function draft(overrides: Partial<BrainDecisionDraft> & { fingerprintParts: Array<string | number> }): BrainDecisionDraft {
  return {
    category: "PRICING",
    severity: "MEDIUM",
    title: "t",
    description: "d",
    recommendation: "r",
    detectorKey: "pricing-detector",
    ...overrides,
  } as BrainDecisionDraft;
}

/* ── persistBrainDecisions — sin ruido en re-detección sin cambios ── */

test("LA QUE IMPORTA — re-detectada SIN cambios (mismo estado, misma severidad): actualiza pero no escribe bitácora ni auditoría", async () => {
  const { db, actionLogs } = createFakeDb({
    decisions: [baseDecision({ id: "d1", fingerprint: FP1, status: "OPEN", severity: "MEDIUM" })],
  });

  const result = await persistBrainDecisions(
    [draft({ severity: "MEDIUM", fingerprintParts: ["fp-1"] })],
    ACTOR,
    {},
    db,
  );

  assert.equal(result.updated, 1);
  assert.equal(result.created, 0);
  assert.equal(result.reopened, 0);
  assert.equal(actionLogs.length, 0, "sin cambio de estado ni severidad no debe haber ninguna entrada de bitácora");
});

test("re-detectada con la severidad CAMBIADA sí escribe una entrada de bitácora", async () => {
  const { db, actionLogs } = createFakeDb({
    decisions: [baseDecision({ id: "d1", fingerprint: FP1, status: "OPEN", severity: "MEDIUM" })],
  });

  await persistBrainDecisions([draft({ severity: "CRITICAL", fingerprintParts: ["fp-1"] })], ACTOR, {}, db);
  assert.equal(actionLogs.length, 1);
  assert.equal(actionLogs[0].action, "UPDATED");
});

test("un fingerprint nuevo crea una decisión y registra CREATED", async () => {
  const { db, decisions, actionLogs } = createFakeDb();
  const result = await persistBrainDecisions([draft({ fingerprintParts: ["fp-nuevo"] })], ACTOR, {}, db);
  assert.equal(result.created, 1);
  assert.equal(decisions.length, 1);
  assert.equal(actionLogs.length, 1);
  assert.equal(actionLogs[0].action, "CREATED");
});

/* ── autoResolveNotRedetected ── */

test("LA QUE IMPORTA — autoResolveNotRedetected cierra lo que ese detector no re-detectó en esta corrida, respetando la sucursal", async () => {
  const scanStartedAt = new Date("2026-02-01T00:00:00Z");
  const { db, decisions } = createFakeDb({
    decisions: [
      baseDecision({ id: "d1", fingerprint: "fp-1", detectorKey: "pricing-detector", branchId: "branch-A", status: "OPEN", lastDetectedAt: new Date("2026-01-01T00:00:00Z") }),
      baseDecision({ id: "d2", fingerprint: "fp-2", detectorKey: "pricing-detector", branchId: "branch-B", status: "OPEN", lastDetectedAt: new Date("2026-01-01T00:00:00Z") }),
      baseDecision({ id: "d3", fingerprint: "fp-3", detectorKey: "pricing-detector", branchId: "branch-A", status: "OPEN", lastDetectedAt: new Date("2026-03-01T00:00:00Z") }), // SÍ se re-detectó en este run
    ],
  });

  const closed = await autoResolveNotRedetected({ detectorKey: "pricing-detector", branchId: "branch-A", scanStartedAt }, db);

  assert.equal(closed, 1, "solo d1 — no re-detectada, de la sucursal del run");
  assert.equal(decisions.find((d) => d.id === "d1")?.status, "RESOLVED");
  assert.equal(decisions.find((d) => d.id === "d1")?.resolutionSource, "AUTO");
  assert.equal(decisions.find((d) => d.id === "d2")?.status, "OPEN", "otra sucursal — el run por sucursal no la toca");
  assert.equal(decisions.find((d) => d.id === "d3")?.status, "OPEN", "SÍ se re-detectó en este run — no se cierra");
});

test("autoResolveNotRedetected nunca toca una decisión SNOOZED", async () => {
  const scanStartedAt = new Date("2026-02-01T00:00:00Z");
  const { db, decisions } = createFakeDb({
    decisions: [baseDecision({ id: "d1", fingerprint: "fp-1", status: "SNOOZED", lastDetectedAt: new Date("2026-01-01T00:00:00Z") })],
  });
  const closed = await autoResolveNotRedetected({ detectorKey: "pricing-detector", scanStartedAt }, db);
  assert.equal(closed, 0);
  assert.equal(decisions[0].status, "SNOOZED");
});

/* ── Acciones atómicas — doble llamada ── */

test("LA QUE IMPORTA — doble resolve: la segunda da ALREADY_PROCESSED", async () => {
  const { db, decisions } = createFakeDb({ decisions: [baseDecision({ id: "d1", fingerprint: "fp-1", status: "OPEN" })] });
  await resolveBrainDecisionTx(db, "d1", ACTOR);
  assert.equal(decisions[0].status, "RESOLVED");
  await assert.rejects(() => resolveBrainDecisionTx(db, "d1", ACTOR), /ALREADY_PROCESSED/);
});

test("LA QUE IMPORTA — reopen desde EXECUTED está prohibido (409), solo desde RESOLVED/DISMISSED/EXPIRED/SNOOZED", async () => {
  const { db } = createFakeDb({ decisions: [baseDecision({ id: "d1", fingerprint: "fp-1", status: "EXECUTED" })] });
  await assert.rejects(() => reopenBrainDecisionTx(db, "d1", ACTOR), /ALREADY_PROCESSED/);
});

test("reopen SÍ funciona desde DISMISSED y limpia los campos de resolución", async () => {
  const { db, decisions } = createFakeDb({
    decisions: [baseDecision({ id: "d1", fingerprint: "fp-1", status: "DISMISSED", dismissedSeverity: "HIGH", resolutionNote: "no aplica" })],
  });
  await reopenBrainDecisionTx(db, "d1", ACTOR);
  assert.equal(decisions[0].status, "OPEN");
  assert.equal(decisions[0].dismissedSeverity, null);
  assert.equal(decisions[0].resolutionNote, null);
});

test("dismiss exige un motivo de al menos 3 caracteres", async () => {
  const { db } = createFakeDb({ decisions: [baseDecision({ id: "d1", fingerprint: "fp-1", status: "OPEN" })] });
  await assert.rejects(() => dismissBrainDecisionTx(db, "d1", ACTOR, "no"), /VALIDATION_ERROR/);
});

test("dismiss guarda la severidad al momento de descartar (dismissedSeverity)", async () => {
  const { db, decisions } = createFakeDb({ decisions: [baseDecision({ id: "d1", fingerprint: "fp-1", status: "OPEN", severity: "HIGH" })] });
  await dismissBrainDecisionTx(db, "d1", ACTOR, "no aplica en esta sucursal");
  assert.equal(decisions[0].status, "DISMISSED");
  assert.equal(decisions[0].dismissedSeverity, "HIGH");
});

test("LA QUE IMPORTA — run doble: la segunda llamada no vuelve a ejecutar (ALREADY_PROCESSED), el motor real se invoca una sola vez", async () => {
  const { db, decisions } = createFakeDb({
    decisions: [baseDecision({ id: "d1", fingerprint: "fp-1", status: "OPEN", proposedActionType: "RECALCULATE_CASH_SESSION" })],
  });
  let executeCalls = 0;
  const fakeExecute = async () => {
    executeCalls += 1;
    return { executed: true, action: "RECALCULATE_CASH_SESSION", executedEntityType: "CashSession", executedEntityId: "cs-1" };
  };

  await runBrainDecisionTx(db, "d1", ACTOR, undefined, fakeExecute);
  assert.equal(decisions[0].status, "EXECUTED");
  assert.equal(executeCalls, 1);

  await assert.rejects(() => runBrainDecisionTx(db, "d1", ACTOR, undefined, fakeExecute), /ALREADY_PROCESSED/);
  assert.equal(executeCalls, 1, "el motor real NUNCA se vuelve a invocar en el segundo intento");
});

test("run rechaza un tipo que no es EXECUTABLE según el catálogo, sin tocar su estado", async () => {
  const { db, decisions } = createFakeDb({
    decisions: [baseDecision({ id: "d1", fingerprint: "fp-1", status: "OPEN", proposedActionType: "REVIEW_ONLY" })],
  });
  await assert.rejects(() => runBrainDecisionTx(db, "d1", ACTOR), /VALIDATION_ERROR/);
  assert.equal(decisions[0].status, "OPEN", "no debe quedar EXECUTING si nunca se reclamó el CAS");
});

test("run: si executeDecisionAction devuelve executed:false, la decisión vuelve a OPEN (no a MANUAL_REVIEW)", async () => {
  const { db, decisions } = createFakeDb({
    decisions: [baseDecision({ id: "d1", fingerprint: "fp-1", status: "OPEN", proposedActionType: "RECALCULATE_CASH_SESSION" })],
  });
  const fakeExecute = async () => ({ executed: false, action: "RECALCULATE_CASH_SESSION", message: "Falta cashSessionId." });
  await runBrainDecisionTx(db, "d1", ACTOR, undefined, fakeExecute);
  assert.equal(decisions[0].status, "OPEN");
});

/* ── Candado de escaneo ── */

test("LA QUE IMPORTA — un segundo escaneo concurrente da BRAIN_SCAN_RUNNING", async () => {
  const { db } = createFakeDb();
  await acquireScanRunLockTx(db, { mode: "SCHEDULED_SCAN", trigger: "SCHEDULED" });
  await assert.rejects(() => acquireScanRunLockTx(db, { mode: "SCHEDULED_SCAN", trigger: "MANUAL" }), /BRAIN_SCAN_RUNNING/);
});

test("LA QUE IMPORTA — un candado colgado de más de 10 minutos se libera y se toma", async () => {
  const staleStartedAt = new Date(Date.now() - 15 * 60 * 1000);
  const { db, scanRuns } = createFakeDb({ scanRuns: [{ id: "run-old", runningLock: "brain", startedAt: staleStartedAt, status: "RUNNING" }] });

  const newRunId = await acquireScanRunLockTx(db, { mode: "SCHEDULED_SCAN", trigger: "SCHEDULED" });

  assert.notEqual(newRunId, "run-old");
  assert.equal(scanRuns.find((r) => r.id === "run-old")?.status, "FAILED");
  assert.equal(scanRuns.find((r) => r.id === "run-old")?.runningLock, null);
});
