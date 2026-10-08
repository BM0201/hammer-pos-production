import assert from "node:assert/strict";
import test from "node:test";
import { healthLineStatus, formatTimeAgo, actionsForDecision, buildInboxUrl } from "@/lib/brain-ui";

/** prompt-brain-centro-decisiones.md Fase 3 — funciones puras de la pantalla. */

test("healthLineStatus — nunca escaneó: never", () => {
  const result = healthLineStatus({ lastRunFinishedAt: null, lastRunStatus: null, now: new Date("2026-03-10T14:00:00Z") });
  assert.equal(result.level, "never");
});

test("LA QUE IMPORTA — healthLineStatus — más de 2h sin escanear, EN horario de operación: stale (rojo)", () => {
  const result = healthLineStatus({
    lastRunFinishedAt: new Date("2026-03-10T10:00:00Z"), // 4h antes
    lastRunStatus: "OK",
    now: new Date("2026-03-10T14:00:00Z"), // 14 UTC = 8am Managua — horario de operación
  });
  assert.equal(result.level, "stale");
});

test("más de 2h sin escanear pero FUERA de horario de operación: no es stale (nadie espera un scan de madrugada)", () => {
  const result = healthLineStatus({
    lastRunFinishedAt: new Date("2026-03-10T02:00:00Z"),
    lastRunStatus: "OK",
    now: new Date("2026-03-10T08:00:00Z"), // 08 UTC = 2am Managua — fuera de horario
  });
  assert.notEqual(result.level, "stale");
});

test("healthLineStatus — último escaneo PARTIAL nombra el detector que falló", () => {
  const result = healthLineStatus({
    lastRunFinishedAt: new Date("2026-03-10T13:50:00Z"),
    lastRunStatus: "PARTIAL",
    failedDetectorKey: "pricing-detector",
    now: new Date("2026-03-10T14:00:00Z"),
  });
  assert.equal(result.level, "partial");
  assert.match(result.message, /pricing-detector/);
});

test("healthLineStatus — escaneo reciente y OK: verde", () => {
  const result = healthLineStatus({
    lastRunFinishedAt: new Date("2026-03-10T13:50:00Z"),
    lastRunStatus: "OK",
    now: new Date("2026-03-10T14:00:00Z"),
  });
  assert.equal(result.level, "ok");
});

test("formatTimeAgo — minutos, horas, días y meses", () => {
  const now = new Date("2026-03-10T12:00:00Z");
  assert.equal(formatTimeAgo(new Date("2026-03-10T11:59:30Z"), now), "hace un momento");
  assert.equal(formatTimeAgo(new Date("2026-03-10T11:50:00Z"), now), "hace 10 min");
  assert.equal(formatTimeAgo(new Date("2026-03-10T09:00:00Z"), now), "hace 3 h");
  assert.equal(formatTimeAgo(new Date("2026-03-07T12:00:00Z"), now), "hace 3 días");
  assert.equal(formatTimeAgo(new Date("2026-03-09T12:00:00Z"), now), "hace 1 día");
});

test("LA QUE IMPORTA — actionsForDecision: IN_MODULE activo ofrece Ir a resolver + Ya lo resolví + Posponer + No aplica", () => {
  const actions = actionsForDecision({ resolution: "IN_MODULE", status: "OPEN" });
  assert.deepEqual(actions, ["GO_RESOLVE", "RESOLVE", "SNOOZE", "DISMISS"]);
});

test("actionsForDecision: EXECUTABLE activo ofrece Ejecutar, no 'Ir a resolver'", () => {
  const actions = actionsForDecision({ resolution: "EXECUTABLE", status: "OPEN" });
  assert.deepEqual(actions, ["RUN", "SNOOZE", "DISMISS"]);
});

test("actionsForDecision: ACKNOWLEDGE activo ofrece Ya lo revisé", () => {
  const actions = actionsForDecision({ resolution: "ACKNOWLEDGE", status: "MANUAL_REVIEW" });
  assert.deepEqual(actions, ["ACKNOWLEDGE", "SNOOZE", "DISMISS"]);
});

test("LA QUE IMPORTA — un estado cerrado (RESOLVED/DISMISSED/EXPIRED/SNOOZED) solo ofrece Reabrir, sin importar resolution", () => {
  for (const status of ["RESOLVED", "DISMISSED", "EXPIRED", "SNOOZED"]) {
    assert.deepEqual(actionsForDecision({ resolution: "IN_MODULE", status }), ["REOPEN"]);
  }
});

test("EXECUTED/EXECUTING no ofrecen ninguna acción", () => {
  assert.deepEqual(actionsForDecision({ resolution: "EXECUTABLE", status: "EXECUTED" }), []);
  assert.deepEqual(actionsForDecision({ resolution: "EXECUTABLE", status: "EXECUTING" }), []);
});

test("buildInboxUrl — sin filtros, la URL queda limpia (PENDING es el default, no se escribe)", () => {
  assert.equal(buildInboxUrl("/app/master/brain", { status: "PENDING" }), "/app/master/brain");
});

test("buildInboxUrl — arma branchId, area, status (no default) y q juntos", () => {
  const url = buildInboxUrl("/app/master/brain", { branchId: "b1", area: "PRICING", status: "SNOOZED", q: "cemento" });
  assert.equal(url, "/app/master/brain?branchId=b1&area=PRICING&status=SNOOZED&q=cemento");
});
