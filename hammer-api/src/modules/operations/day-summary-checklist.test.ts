import assert from "node:assert/strict";
import test from "node:test";
import { buildChecklist } from "@/modules/operations/day-summary";

/**
 * prompt-brain-centro-decisiones.md Fase 4.1 — "critical_brain" ahora
 * cuenta PENDIENTES de verdad (no "creadas hoy") y, si Brain no escaneó en
 * más de 2 horas, el check queda en ATTENTION aunque el conteo sea 0 —
 * antes un conteo en 0 por falta de escaneo se mostraba igual que un
 * conteo en 0 porque todo estaba resuelto.
 */

function baseSummary(overrides: Partial<Parameters<typeof buildChecklist>[0]> = {}) {
  return {
    openCashSessionsCount: 0,
    autoClosedPendingReviewCount: 0,
    pendingPaymentTotal: 0,
    pendingDispatchCount: 0,
    criticalBrainDecisionCount: 0,
    cashDifferenceTotal: 0,
    brainLastScanFinishedAt: null,
    ...overrides,
  };
}

function criticalBrainItem(items: ReturnType<typeof buildChecklist>["items"]) {
  return items.find((i) => i.key === "critical_brain")!;
}

test("LA QUE IMPORTA — sin ningún escaneo registrado (brainLastScanFinishedAt null), ATTENTION aunque el conteo sea 0", () => {
  const checklist = buildChecklist(baseSummary({ criticalBrainDecisionCount: 0, brainLastScanFinishedAt: null }), 50, new Date("2026-03-10T14:00:00Z"));
  const item = criticalBrainItem(checklist.items);
  assert.equal(item.status, "ATTENTION");
  assert.match(item.message ?? "", /no revisó/);
});

test("LA QUE IMPORTA — último escaneo hace más de 2 horas: ATTENTION aunque el conteo sea 0", () => {
  const checklist = buildChecklist(
    baseSummary({ criticalBrainDecisionCount: 0, brainLastScanFinishedAt: new Date("2026-03-10T11:00:00Z") }),
    50,
    new Date("2026-03-10T14:00:00Z"), // 3h después
  );
  const item = criticalBrainItem(checklist.items);
  assert.equal(item.status, "ATTENTION");
});

test("escaneo reciente (menos de 2h) y conteo en 0: OK de verdad, no por falta de mirar", () => {
  const checklist = buildChecklist(
    baseSummary({ criticalBrainDecisionCount: 0, brainLastScanFinishedAt: new Date("2026-03-10T13:30:00Z") }),
    50,
    new Date("2026-03-10T14:00:00Z"), // 30 min después
  );
  const item = criticalBrainItem(checklist.items);
  assert.equal(item.status, "OK");
  assert.equal(item.message, undefined);
});

test("escaneo reciente pero con críticas pendientes: ATTENTION por el conteo, no por el escaneo", () => {
  const checklist = buildChecklist(
    baseSummary({ criticalBrainDecisionCount: 3, brainLastScanFinishedAt: new Date("2026-03-10T13:30:00Z") }),
    50,
    new Date("2026-03-10T14:00:00Z"),
  );
  const item = criticalBrainItem(checklist.items);
  assert.equal(item.status, "ATTENTION");
  assert.equal(item.count, 3);
});
