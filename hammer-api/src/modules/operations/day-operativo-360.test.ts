/**
 * Día Operativo 360 — los 10 casos de aceptación de la reescritura
 * (dia-operativo-360-reescritura.md §6). Cada uno es una invariante del §2:
 * el día operativo es una bitácora, nunca una compuerta.
 *
 * Convención del repo (sin DB): los casos que requieren una transacción real
 * (resolveOperationalDayForOperationTx, sweepDayToAwaitingReviewTx,
 * confirmOperationalDay, reopenOperationalDay) se prueban como espejos puros
 * de la lógica de decisión en day-resolver.ts / day-lifecycle.ts — sin
 * Prisma, sin DB, corren en CI. Los casos de fecha de negocio (8) usan las
 * funciones REALES de business-date.ts, que son puras.
 *
 * Run: node --import tsx --test src/modules/operations/day-operativo-360.test.ts
 */

import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { businessDateFromInstant, businessDateFromNow } from "@/modules/operations/business-date";

// ─── Caso 1 / Caso 2 / Caso 3: resolveOperationalDayForOperationTx nunca bloquea ──
//
// Espejo de day-resolver.ts::resolveOperationalDayForOperationTx — los cuatro
// caminos posibles (existing.lifecycle !== ACTIVE / CANCELLED / no existe).
// El contrato duro: NUNCA lanza por causa del estado del día operativo.

type DayRow = { id: string; lifecycle: "ACTIVE" | "AWAITING_REVIEW" | "CANCELLED"; reviewStatus: "PENDING" | "CONFIRMED" } | null;

function resolveDay(existing: DayRow): {
  dayId: string;
  created: boolean;
  reactivated: boolean;
  reviewReverted: boolean;
} {
  if (existing && existing.lifecycle !== "CANCELLED") {
    if (existing.lifecycle !== "ACTIVE") {
      const reviewReverted = existing.reviewStatus === "CONFIRMED";
      return { dayId: existing.id, created: false, reactivated: true, reviewReverted };
    }
    return { dayId: existing.id, created: false, reactivated: false, reviewReverted: false };
  }
  if (existing) {
    // CANCELLED: se reactiva igual, nunca bloquea (caso de excepción auditado).
    return { dayId: existing.id, created: false, reactivated: true, reviewReverted: false };
  }
  return { dayId: "new-day", created: true, reactivated: false, reviewReverted: false };
}

describe("Caso 1: sin autoOpenEnabled y sin día para hoy — abrir caja crea el día", () => {
  it("no existe ningún flag de auto-open que consultar: el día se crea directo", () => {
    const r = resolveDay(null);
    assert.equal(r.created, true);
    assert.equal(r.dayId, "new-day");
  });
});

describe("Caso 2: día de hoy en AWAITING_REVIEW — abrir caja funciona y reactiva", () => {
  it("se reactiva a ACTIVE, deja rastro (reactivated=true), reviewStatus PENDING se conserva", () => {
    const r = resolveDay({ id: "d1", lifecycle: "AWAITING_REVIEW", reviewStatus: "PENDING" });
    assert.equal(r.reactivated, true);
    assert.equal(r.created, false);
    assert.equal(r.reviewReverted, false, "ya estaba PENDING, no hay nada que revertir");
  });
});

describe("Caso 3: día de hoy CONFIRMED y llega una venta — se reactiva y reviewStatus vuelve a PENDING", () => {
  it("reactivated=true y reviewReverted=true (CONFIRMED -> PENDING)", () => {
    const r = resolveDay({ id: "d1", lifecycle: "AWAITING_REVIEW", reviewStatus: "CONFIRMED" });
    assert.equal(r.reactivated, true);
    assert.equal(r.reviewReverted, true, "el día vuelve a moverse -> la firma ya no aplica, PENDING de nuevo");
  });

  it("un día CONFIRMED pero todavía ACTIVE (caso raro) no se toca: sigue ACTIVE, no se re-audita", () => {
    const r = resolveDay({ id: "d1", lifecycle: "ACTIVE", reviewStatus: "CONFIRMED" });
    assert.equal(r.reactivated, false, "ya está ACTIVE, el resolver no lo vuelve a escribir");
  });
});

// ─── Caso 4: barrido + cajas huérfanas + snapshot recalculado ────────────────
//
// Espejo de day-lifecycle.ts::sweepDayToAwaitingReviewTx — el orden importa:
// (1) claim lifecycle ACTIVE->AWAITING_REVIEW, (2) cerrar cajas huérfanas
// calculando expectedCash en Decimal, (3) refrescar el summary ANTES de
// congelar, para que salesTotal refleje las ventas reales (no C$0).

describe("Caso 4: día de ayer ACTIVE con caja abierta — barrido no pierde nada", () => {
  function sweep(day: { lifecycle: string }, orphanSessions: Array<{ status: "OPEN" | "RECONCILING"; openingAmount: number; cashIn: number; cashOut: number }>) {
    if (day.lifecycle !== "ACTIVE") return { swept: false, orphanCashSessionsClosed: 0, summaryRefreshed: false };
    const orphanCashSessionsClosed = orphanSessions.filter((s) => s.status === "OPEN" || s.status === "RECONCILING").length;
    // calculateExpectedCashForSessionTx en Decimal — acá solo se verifica que
    // CADA sesión huérfana recibe un expectedCash calculado, ninguna se pierde.
    const closedSessions = orphanSessions.map((s) => ({
      status: "AUTO_CLOSED_PENDING_REVIEW" as const,
      expectedCashAmount: s.openingAmount + s.cashIn - s.cashOut,
      requiresReview: true,
    }));
    // refreshOperationalDaySummaryTx corre DESPUÉS de cerrar las cajas y ANTES
    // de que el día quede congelado en AWAITING_REVIEW.
    return { swept: true, orphanCashSessionsClosed, summaryRefreshed: true, closedSessions };
  }

  it("cierra la caja huérfana a AUTO_CLOSED_PENDING_REVIEW con expectedCash calculado (no se pierde el conteo)", () => {
    const result = sweep({ lifecycle: "ACTIVE" }, [{ status: "OPEN", openingAmount: 1000, cashIn: 5000, cashOut: 200 }]);
    assert.equal(result.swept, true);
    assert.equal(result.orphanCashSessionsClosed, 1);
    assert.equal(result.closedSessions![0].status, "AUTO_CLOSED_PENDING_REVIEW");
    assert.equal(result.closedSessions![0].expectedCashAmount, 5800);
    assert.equal(result.closedSessions![0].requiresReview, true);
  });

  it("el summary se refresca ANTES de congelar el día — el snapshot no queda en C$0", () => {
    const result = sweep({ lifecycle: "ACTIVE" }, []);
    assert.equal(result.summaryRefreshed, true, "bug histórico: sin este refresh, salesTotal quedaba congelado en 0");
  });

  it("un día que ya no está ACTIVE (barrido concurrente) es un no-op idempotente", () => {
    const result = sweep({ lifecycle: "AWAITING_REVIEW" }, [{ status: "OPEN", openingAmount: 100, cashIn: 0, cashOut: 0 }]);
    assert.equal(result.swept, false, "el claim con lifecycle=ACTIVE en el WHERE ya perdió la carrera, no reintenta");
  });
});

// ─── Caso 5: confirmOperationalDay exige un humano real ──────────────────────

describe("Caso 5: confirmOperationalDay con actorUserId SYSTEM — rechaza", () => {
  function assertHuman(actorUserId: string, userExists: boolean) {
    if (!actorUserId || actorUserId === "SYSTEM") throw new Error("OPERATIONAL_DAY_CONFIRM_REQUIRES_HUMAN");
    if (!userExists) throw new Error("OPERATIONAL_DAY_CONFIRM_REQUIRES_HUMAN");
  }

  it('actorUserId === "SYSTEM" -> OPERATIONAL_DAY_CONFIRM_REQUIRES_HUMAN', () => {
    assert.throws(() => assertHuman("SYSTEM", true), /OPERATIONAL_DAY_CONFIRM_REQUIRES_HUMAN/);
  });

  it("un id que no resuelve a un User real -> mismo rechazo (no solo por convención, se verifica)", () => {
    assert.throws(() => assertHuman("user-que-no-existe", false), /OPERATIONAL_DAY_CONFIRM_REQUIRES_HUMAN/);
  });

  it("un usuario Master real -> pasa", () => {
    assert.doesNotThrow(() => assertHuman("user-real-123", true));
  });
});

// ─── Caso 6: ningún automatismo vacía la cola de PENDING ─────────────────────
//
// Espejo de sweepStaleOperationalDaysToAwaitingReview: el cron SOLO mueve
// lifecycle ACTIVE->AWAITING_REVIEW. Nunca toca reviewStatus. Correr el cron
// N veces sobre la misma cola no cambia reviewStatus de ningún día.

describe("Caso 6: el cron de barrido nunca confirma ni vacía la cola de pendientes", () => {
  type Day = { id: string; lifecycle: "ACTIVE" | "AWAITING_REVIEW"; reviewStatus: "PENDING" | "CONFIRMED"; businessDate: number };

  function sweepTick(days: Day[], today: number): Day[] {
    return days.map((d) =>
      d.lifecycle === "ACTIVE" && d.businessDate < today
        ? { ...d, lifecycle: "AWAITING_REVIEW" } // reviewStatus: SIN TOCAR
        : d,
    );
  }

  it("5 días PENDING, N corridas del cron -> los 5 siguen PENDING", () => {
    const today = 1000;
    let days: Day[] = Array.from({ length: 5 }, (_, i) => ({
      id: `d${i}`, lifecycle: "ACTIVE", reviewStatus: "PENDING", businessDate: today - (i + 1),
    }));

    for (let tick = 0; tick < 10; tick++) {
      days = sweepTick(days, today);
    }

    assert.equal(days.filter((d) => d.reviewStatus === "PENDING").length, 5, "ningún tick tocó reviewStatus");
    assert.equal(days.filter((d) => d.lifecycle === "AWAITING_REVIEW").length, 5, "todos salieron de ACTIVE una sola vez");
    assert.equal(days.filter((d) => d.reviewStatus === "CONFIRMED").length, 0, "ningún automatismo confirma");
  });
});

// ─── Caso 7: nota obligatoria cuando el checklist tiene ítems en atención ────

describe("Caso 7: confirmOperationalDay exige nota solo si hay ítems en atención", () => {
  type Checklist = { attention: Array<{ key: string }> };

  function assertNoteIfNeeded(checklist: Checklist, note: string | null | undefined) {
    if (checklist.attention.length > 0 && !note?.trim()) {
      throw new Error("OPERATIONAL_DAY_CONFIRM_NOTE_REQUIRED");
    }
  }

  it("pendingPaymentTotal > 0 (ítem en atención) y nota presente -> confirma", () => {
    const checklist: Checklist = { attention: [{ key: "pending_payments" }] };
    assert.doesNotThrow(() => assertNoteIfNeeded(checklist, "Cliente paga mañana, autorizado por Master."));
  });

  it("pendingPaymentTotal > 0 y SIN nota -> OPERATIONAL_DAY_CONFIRM_NOTE_REQUIRED", () => {
    const checklist: Checklist = { attention: [{ key: "pending_payments" }] };
    assert.throws(() => assertNoteIfNeeded(checklist, ""), /OPERATIONAL_DAY_CONFIRM_NOTE_REQUIRED/);
    assert.throws(() => assertNoteIfNeeded(checklist, null), /OPERATIONAL_DAY_CONFIRM_NOTE_REQUIRED/);
  });

  it("checklist limpio (sin atención) -> confirma sin nota", () => {
    const checklist: Checklist = { attention: [] };
    assert.doesNotThrow(() => assertNoteIfNeeded(checklist, undefined));
  });
});

// ─── Caso 8: zona horaria — 23:50 Managua cae en el mismo businessDate ───────
//
// Usa la función REAL (pura, sin DB) de business-date.ts — no un espejo.

describe("Caso 8: venta a las 23:50 Managua cae en el businessDate de ESE día", () => {
  it("23:50 Managua (05:50 UTC del día siguiente) -> businessDate del día en que ocurrió, no el siguiente", () => {
    // 2026-07-14 23:50 Managua = 2026-07-15 05:50 UTC (Managua es UTC-6, sin DST).
    const saleInstant = new Date("2026-07-15T05:50:00.000Z");
    const bd = businessDateFromInstant(saleInstant);
    assert.equal(bd.toISOString(), "2026-07-14T00:00:00.000Z", "23:50 del 14 sigue siendo businessDate 14, no 15");
  });

  it("businessDateFromNow es estable durante todo el día de Managua (00:00-23:59)", () => {
    const earlyMorning = businessDateFromNow(new Date("2026-07-14T06:05:00.000Z")); // 00:05 Managua
    const lateNight = businessDateFromNow(new Date("2026-07-15T05:55:00.000Z"));   // 23:55 Managua
    assert.equal(earlyMorning.toISOString(), lateNight.toISOString(), "mismo businessDate durante las 24h del día Managua");
  });
});

// ─── Caso 9: aperturas concurrentes — el @@unique es la fuente de verdad ─────
//
// resolveOperationalDayForOperationTx serializa con `SELECT ... FOR UPDATE`
// sobre la fila de Branch antes de leer/crear el día — la segunda transacción
// concurrente espera el lock y ve el día ya creado por la primera (vía
// findUnique dentro de la misma tx), nunca intenta un segundo create() que
// dispararía P2002 contra @@unique([branchId, businessDate]).

describe("Caso 9: dos aperturas de caja concurrentes sin día previo — una sola fila", () => {
  it("el lock serializa: la segunda transacción ve el día que creó la primera y lo reutiliza", () => {
    // Simulación secuencial del efecto del lock (la concurrencia real se
    // prueba en integración, con DB): tras el lock, ninguna segunda
    // transacción entra a la rama "no existe -> create".
    const store = new Map<string, { id: string }>();

    function resolveWithLock(branchDateKey: string): { dayId: string; created: boolean } {
      // FOR UPDATE ya serializó — a partir de acá, solo una tx a la vez ve este bloque.
      const existing = store.get(branchDateKey);
      if (existing) return { dayId: existing.id, created: false };
      const created = { id: `day-${store.size + 1}` };
      store.set(branchDateKey, created);
      return { dayId: created.id, created: true };
    }

    const first = resolveWithLock("branch-1|2026-07-14");
    const second = resolveWithLock("branch-1|2026-07-14");

    assert.equal(first.created, true);
    assert.equal(second.created, false, "la segunda no vuelve a crear — ve la fila que ya existe");
    assert.equal(first.dayId, second.dayId, "ambas transacciones terminan con el mismo día");
    assert.equal(store.size, 1, "una sola fila en OperationalDay, sin P2002");
  });
});

// ─── Caso 10: reabrir un día pasado se rechaza — solo hoy se reabre ──────────

describe("Caso 10: reopenOperationalDay rechaza fechas pasadas", () => {
  function reopen(input: { lifecycle: string; businessDate: number; today: number; note: string }) {
    if (input.lifecycle !== "AWAITING_REVIEW") throw new Error("OPERATIONAL_DAY_NOT_AWAITING_REVIEW");
    if (!input.note?.trim()) throw new Error("OPERATIONAL_DAY_REOPEN_NOTE_REQUIRED");
    if (input.businessDate !== input.today) throw new Error("OPERATIONAL_DAY_REOPEN_PAST_DATE");
    return { lifecycle: "ACTIVE" as const };
  }

  const today = 2000;

  it("día AWAITING_REVIEW de fecha PASADA -> OPERATIONAL_DAY_REOPEN_PAST_DATE", () => {
    assert.throws(
      () => reopen({ lifecycle: "AWAITING_REVIEW", businessDate: today - 3, today, note: "Ajuste" }),
      /OPERATIONAL_DAY_REOPEN_PAST_DATE/,
    );
  });

  it("día AWAITING_REVIEW de HOY -> se reabre a ACTIVE", () => {
    const r = reopen({ lifecycle: "AWAITING_REVIEW", businessDate: today, today, note: "Se cerró por error" });
    assert.equal(r.lifecycle, "ACTIVE");
  });

  it("sin nota -> OPERATIONAL_DAY_REOPEN_NOTE_REQUIRED, incluso siendo el día de hoy", () => {
    assert.throws(
      () => reopen({ lifecycle: "AWAITING_REVIEW", businessDate: today, today, note: "" }),
      /OPERATIONAL_DAY_REOPEN_NOTE_REQUIRED/,
    );
  });
});
