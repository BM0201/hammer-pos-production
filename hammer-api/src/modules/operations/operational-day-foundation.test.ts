/**
 * Tests de la Fase 1 del rediseño Día Operativo (fuente de verdad = operationalDayId).
 *
 * Convención del repo (sin DB): se inlinean espejos de la lógica de producción de
 * operations/service.ts y sales/offline-sync.service.ts. Si cambia la lógica,
 * actualice ambos. Los casos que requieren DB real (persistencia de operationalDayId,
 * cierre OPEN→CLOSING→CLOSED, concurrencia) se cubren en tests de integración aparte.
 *
 * Run: node --import tsx --test src/modules/operations/operational-day-foundation.test.ts
 */

import assert from "node:assert/strict";
import { describe, it } from "node:test";

const TIMEZONE = "America/Managua";

// ─── Espejo de businessDateFromInstant (operations/service.ts) ───────────────

function localWallClockParts(date: Date, timezone: string) {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: timezone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hourCycle: "h23",
  }).formatToParts(date);
  const get = (type: string) => Number(parts.find((p) => p.type === type)?.value ?? 0);
  return { year: get("year"), month: get("month"), day: get("day"), hour: get("hour") };
}

function businessDateFromInstant(instant: Date, timezone = TIMEZONE, businessDayEndsAt = 0): Date {
  const { year, month, day, hour } = localWallClockParts(instant, timezone);
  let utcMidnight = Date.UTC(year, month - 1, day, 0, 0, 0, 0);
  if (businessDayEndsAt > 0 && hour < businessDayEndsAt) {
    utcMidnight -= 24 * 60 * 60 * 1000;
  }
  return new Date(utcMidnight);
}

const ymd = (d: Date) => d.toISOString().slice(0, 10);

// ─── O.17 Día con corte a 03:00 asigna venta 02:30 AM al día anterior ────────

describe("O.17 businessDateFromInstant con corte de día de negocio", () => {
  // Managua = UTC-6 (sin DST). 02:30 Managua = 08:30 UTC.
  const sale0230Managua = new Date("2026-06-15T08:30:00Z");
  const sale0330Managua = new Date("2026-06-15T09:30:00Z");

  it("sin corte (default 0): 02:30 pertenece al mismo día calendario (15)", () => {
    assert.equal(ymd(businessDateFromInstant(sale0230Managua, TIMEZONE, 0)), "2026-06-15");
  });

  it("corte 03:00: una venta 02:30 AM pertenece al día ANTERIOR (14)", () => {
    assert.equal(ymd(businessDateFromInstant(sale0230Managua, TIMEZONE, 3)), "2026-06-14");
  });

  it("corte 03:00: una venta 03:30 AM pertenece al MISMO día (15)", () => {
    assert.equal(ymd(businessDateFromInstant(sale0330Managua, TIMEZONE, 3)), "2026-06-15");
  });

  it("una venta de mediodía Managua siempre pertenece a ese día calendario", () => {
    const noon = new Date("2026-06-15T18:00:00Z"); // 12:00 Managua
    assert.equal(ymd(businessDateFromInstant(noon, TIMEZONE, 0)), "2026-06-15");
    assert.equal(ymd(businessDateFromInstant(noon, TIMEZONE, 3)), "2026-06-15");
  });
});

// ─── O.10 getCurrentOperationalDayState devuelve STALE_OPEN_DAY ──────────────

describe("O.10 estado del día operativo (lógica de decisión)", () => {
  type State = "NO_DAY" | "OPEN_TODAY" | "STALE_OPEN_DAY" | "CLOSED_TODAY" | "CLOSING";

  // Espejo de la decisión de getCurrentOperationalDayState
  function deriveState(input: {
    today: number;
    anyOpenDay: { businessDate: number } | null;
    todayDay: { status: string } | null;
  }): State {
    if (input.anyOpenDay && input.anyOpenDay.businessDate !== input.today) return "STALE_OPEN_DAY";
    if (!input.todayDay) return "NO_DAY";
    if (input.todayDay.status === "OPEN") return "OPEN_TODAY";
    if (input.todayDay.status === "CLOSING") return "CLOSING";
    return "CLOSED_TODAY";
  }

  const today = 1000;

  it("día OPEN de fecha anterior → STALE_OPEN_DAY (no null)", () => {
    assert.equal(deriveState({ today, anyOpenDay: { businessDate: 999 }, todayDay: null }), "STALE_OPEN_DAY");
  });

  it("sin día hoy y sin día abierto → NO_DAY", () => {
    assert.equal(deriveState({ today, anyOpenDay: null, todayDay: null }), "NO_DAY");
  });

  it("día de hoy OPEN → OPEN_TODAY", () => {
    assert.equal(deriveState({ today, anyOpenDay: { businessDate: today }, todayDay: { status: "OPEN" } }), "OPEN_TODAY");
  });

  it("día de hoy CLOSING → CLOSING", () => {
    assert.equal(deriveState({ today, anyOpenDay: null, todayDay: { status: "CLOSING" } }), "CLOSING");
  });
});

// ─── O.1 / O.11 resolveOpenOperationalDayForOperation (auto-open + stale) ─────

describe("O.1/O.11 resolución de día para operación nueva", () => {
  type OpenDay = { id: string; businessDate: number } | null;

  // Espejo de resolveOpenOperationalDayForOperationTx (decisión: auto-open + warn)
  function resolve(input: {
    open: OpenDay;
    today: number;
    allowStaleOverride?: boolean;
  }): { operationalDayId: string; autoOpened: boolean; warnings: string[] } {
    if (input.open) {
      const isStale = input.open.businessDate !== input.today;
      if (isStale && !input.allowStaleOverride) throw new Error("STALE_OPERATIONAL_DAY_OPEN");
      return { operationalDayId: input.open.id, autoOpened: false, warnings: isStale ? ["STALE_OVERRIDE"] : [] };
    }
    return { operationalDayId: "auto", autoOpened: true, warnings: ["OPERATIONAL_DAY_AUTO_OPENED"] };
  }

  const today = 2000;

  it("día OPEN de hoy → lo usa, sin auto-open", () => {
    const r = resolve({ open: { id: "d1", businessDate: today }, today });
    assert.equal(r.operationalDayId, "d1");
    assert.equal(r.autoOpened, false);
  });

  it("sin día OPEN → auto-apertura + warn (no bloquea el POS)", () => {
    const r = resolve({ open: null, today });
    assert.equal(r.autoOpened, true);
    assert.ok(r.warnings.includes("OPERATIONAL_DAY_AUTO_OPENED"));
  });

  it("día OPEN viejo (stale) sin override → bloquea", () => {
    assert.throws(() => resolve({ open: { id: "old", businessDate: 1999 }, today }), /STALE_OPERATIONAL_DAY_OPEN/);
  });

  it("día OPEN viejo con override Master → lo usa con warn", () => {
    const r = resolve({ open: { id: "old", businessDate: 1999 }, today, allowStaleOverride: true });
    assert.equal(r.operationalDayId, "old");
    assert.ok(r.warnings.includes("STALE_OVERRIDE"));
  });
});

// ─── O.4 sourceMode del summary (operationalDayId vs ventana legacy) ──────────

describe("O.4 sourceMode del summary", () => {
  function sourceMode(paymentsIdCount: number, paymentsWindowCount: number) {
    return paymentsIdCount > 0
      ? paymentsIdCount < paymentsWindowCount
        ? "MIXED"
        : "OPERATIONAL_DAY_ID"
      : "LEGACY_TIME_WINDOW";
  }

  it("todos los pagos con operationalDayId → OPERATIONAL_DAY_ID", () => {
    assert.equal(sourceMode(10, 10), "OPERATIONAL_DAY_ID");
  });

  it("algunos con id, otros solo por ventana → MIXED", () => {
    assert.equal(sourceMode(6, 10), "MIXED");
  });

  it("ninguno con id pero hay por ventana → LEGACY_TIME_WINDOW", () => {
    assert.equal(sourceMode(0, 10), "LEGACY_TIME_WINDOW");
  });
});

// ─── O.16 offline: offlineClientId evita duplicados (idempotencia) ────────────

describe("O.16 offline sync idempotente por offlineClientId", () => {
  // Espejo de la guarda de syncOfflineSale: si ya existe el offlineClientId, devuelve alreadySynced.
  function sync(existing: Set<string>, offlineId: string): { alreadySynced: boolean } {
    if (existing.has(offlineId)) return { alreadySynced: true };
    existing.add(offlineId);
    return { alreadySynced: false };
  }

  it("primer sync crea; reintento con el mismo offlineClientId no duplica", () => {
    const store = new Set<string>();
    assert.equal(sync(store, "OFF-1").alreadySynced, false);
    assert.equal(sync(store, "OFF-1").alreadySynced, true);
    assert.equal(store.size, 1);
  });
});

// ─── O.14/O.15 offline: día original y no mutar día aprobado ─────────────────

describe("O.14/O.15 offline usa día original y protege días finalizados", () => {
  // Espejo de la decisión de día en syncOfflineSale
  function decide(session: { operationalDay: { status: string; approvedAt: Date | null } | null }) {
    const od = session.operationalDay;
    if (od?.approvedAt) throw new Error("OFFLINE_SALE_DAY_APPROVED");
    return { operationalDayId: od ? "original" : null, lateSyncIntoClosedDay: od?.status === "CLOSED" };
  }

  it("usa el operationalDayId ORIGINAL de la sesión (no el de hoy)", () => {
    const r = decide({ operationalDay: { status: "OPEN", approvedAt: null } });
    assert.equal(r.operationalDayId, "original");
    assert.equal(r.lateSyncIntoClosedDay, false);
  });

  it("día CLOSED no aprobado → marca lateSyncIntoClosedDay (no muta silenciosamente)", () => {
    const r = decide({ operationalDay: { status: "CLOSED", approvedAt: null } });
    assert.equal(r.lateSyncIntoClosedDay, true);
  });

  it("día APPROVED → rechaza (no altera snapshot cerrado)", () => {
    assert.throws(
      () => decide({ operationalDay: { status: "CLOSED", approvedAt: new Date() } }),
      /OFFLINE_SALE_DAY_APPROVED/,
    );
  });
});
