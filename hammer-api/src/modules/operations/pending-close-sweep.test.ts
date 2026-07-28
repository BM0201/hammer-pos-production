import assert from "node:assert/strict";
import test from "node:test";
import { Prisma, PaymentMethod, PaymentStatus, CashSessionStatus, OperationalDayStatus } from "@prisma/client";
import { sweepDayToPendingCloseTx, closeOrphanedCashSessionsForDayTx } from "@/modules/operations/service";

/**
 * Día Operativo v2 Fase 5 (el corazón) — el bug a matar: un día OPEN que
 * pasaba su fecha quedaba atascado para siempre (el auto-cierre solo tocaba
 * el día de HOY) y BLOQUEABA la sucursal (ventas/apertura de caja exigían
 * día OPEN de hoy). sweepDayToPendingCloseTx es la función que lo saca de
 * "abierto" sin bloquear ni perder nada: el día pasa a PENDING_CLOSE, sus
 * cajas huérfanas quedan AUTO_CLOSED_PENDING_REVIEW (con expected calculado,
 * nunca se pierde el conteo físico), y todo se puede cerrar después con
 * closeOperationalDay (que ya acepta PENDING_CLOSE).
 */

const DAY_ID = "day-stale-1";
const BRANCH_ID = "branch-msy";

function createFakeTx(input: {
  dayStatus: string;
  cashSessions: Array<{ id: string; openingAmount: number; status: string; cashTenders: number[]; movements: Array<{ type: string; amount: number }> }>;
}) {
  const dayState = { status: input.dayStatus };
  const sessions = input.cashSessions.map((s) => ({ ...s }));
  const auditLogs: Array<Record<string, unknown>> = [];

  const tx = {
    operationalDay: {
      updateMany: async (args: { where: { id: string; status: string }; data: { status: string } }) => {
        if (args.where.id !== DAY_ID || dayState.status !== args.where.status) return { count: 0 };
        dayState.status = args.data.status;
        return { count: 1 };
      },
    },
    cashSession: {
      findMany: async (args: { where: { operationalDayId: string; status: { in: string[] } } }) => {
        return sessions
          .filter((s) => args.where.status.in.includes(s.status))
          .map((s) => ({ id: s.id, openingAmount: new Prisma.Decimal(s.openingAmount), physicalCashBoxId: `box-${s.id}` }));
      },
      update: async (args: { where: { id: string }; data: Record<string, unknown> }) => {
        const session = sessions.find((s) => s.id === args.where.id)!;
        Object.assign(session, args.data);
        return session;
      },
    },
    paymentTender: {
      findMany: async (args: { where: { payment: { cashSessionId: string } } }) => {
        const session = sessions.find((s) => s.id === args.where.payment.cashSessionId)!;
        return session.cashTenders.map((amount) => ({ amount: new Prisma.Decimal(amount) }));
      },
    },
    cashMovement: {
      findMany: async (args: { where: { cashSessionId: string } }) => {
        const session = sessions.find((s) => s.id === args.where.cashSessionId)!;
        return session.movements.map((m) => ({ type: m.type, amount: new Prisma.Decimal(m.amount) }));
      },
    },
    auditLog: {
      create: async (args: { data: Record<string, unknown> }) => {
        auditLogs.push(args.data);
        return args.data;
      },
    },
  };

  return { tx: tx as unknown as Prisma.TransactionClient, getDayStatus: () => dayState.status, getSessions: () => sessions, auditLogs };
}

test("Test no-pérdida: día viejo OPEN con una caja abierta -> PENDING_CLOSE + caja AUTO_CLOSED_PENDING_REVIEW con expected calculado", async () => {
  const { tx, getDayStatus, getSessions, auditLogs } = createFakeTx({
    dayStatus: OperationalDayStatus.OPEN,
    cashSessions: [
      {
        id: "cash-1",
        openingAmount: 1000,
        status: CashSessionStatus.OPEN,
        cashTenders: [500, 200],
        movements: [{ type: "EXPENSE_OUT", amount: 50 }],
      },
    ],
  });

  await sweepDayToPendingCloseTx(tx, { id: DAY_ID, branchId: BRANCH_ID, businessDate: new Date("2026-07-22") }, "SYSTEM");

  assert.equal(getDayStatus(), "PENDING_CLOSE", "el día sale de OPEN sin finalizarse (nunca CLOSED)");

  const session = getSessions()[0];
  assert.equal(session.status, CashSessionStatus.AUTO_CLOSED_PENDING_REVIEW, "la caja huérfana queda pendiente de revisión, no se pierde");
  assert.equal((session as unknown as { expectedCashAmount: Prisma.Decimal }).expectedCashAmount.toNumber(), 1650, "1000 apertura + 700 cobrado - 50 gasto = 1650, exacto");
  assert.equal((session as unknown as { countedCashAmount: null }).countedCashAmount, null, "el conteo físico queda pendiente, no se inventa");
  assert.equal((session as unknown as { requiresReview: boolean }).requiresReview, true);
  assert.equal((session as unknown as { autoClosedBySystem: boolean }).autoClosedBySystem, true);

  assert.ok(auditLogs.some((l) => l.action === "OPERATIONAL_DAY_SWEPT_TO_PENDING_CLOSE"));
  assert.ok(auditLogs.some((l) => l.action === "OPERATIONAL_DAY_ORPHAN_CASH_SESSION_AUTO_CLOSED"));
});

test("Test no-bloqueo: barrer un día sin cajas abiertas -> PENDING_CLOSE, sin tocar ninguna caja", async () => {
  const { tx, getDayStatus, auditLogs } = createFakeTx({ dayStatus: OperationalDayStatus.OPEN, cashSessions: [] });

  await sweepDayToPendingCloseTx(tx, { id: DAY_ID, branchId: BRANCH_ID, businessDate: new Date("2026-07-22") }, "SYSTEM");

  assert.equal(getDayStatus(), "PENDING_CLOSE");
  assert.equal(auditLogs.filter((l) => l.action === "OPERATIONAL_DAY_ORPHAN_CASH_SESSION_AUTO_CLOSED").length, 0);
});

test("Idempotencia: si el día ya no está OPEN cuando se reclama, no hace nada (no pisa un estado válido)", async () => {
  const { tx, getDayStatus, auditLogs } = createFakeTx({ dayStatus: OperationalDayStatus.PENDING_CLOSE, cashSessions: [] });

  await sweepDayToPendingCloseTx(tx, { id: DAY_ID, branchId: BRANCH_ID, businessDate: new Date("2026-07-22") }, "SYSTEM");

  assert.equal(getDayStatus(), "PENDING_CLOSE", "no cambia, ya estaba en otro estado");
  assert.equal(auditLogs.length, 0, "no audita una transición que no ocurrió");
});

test("closeOrphanedCashSessionsForDayTx: varias cajas huérfanas se cierran todas, cada una con SU expected", async () => {
  const { tx, getSessions } = createFakeTx({
    dayStatus: OperationalDayStatus.OPEN,
    cashSessions: [
      { id: "cash-1", openingAmount: 500, status: CashSessionStatus.OPEN, cashTenders: [100], movements: [] },
      { id: "cash-2", openingAmount: 300, status: CashSessionStatus.RECONCILING, cashTenders: [], movements: [{ type: "CASH_IN", amount: 50 }] },
    ],
  });

  const closedCount = await closeOrphanedCashSessionsForDayTx(tx, DAY_ID);

  assert.equal(closedCount, 2);
  const [s1, s2] = getSessions();
  assert.equal((s1 as unknown as { expectedCashAmount: Prisma.Decimal }).expectedCashAmount.toNumber(), 600);
  assert.equal((s2 as unknown as { expectedCashAmount: Prisma.Decimal }).expectedCashAmount.toNumber(), 350);
  assert.equal(s1.status, CashSessionStatus.AUTO_CLOSED_PENDING_REVIEW);
  assert.equal(s2.status, CashSessionStatus.AUTO_CLOSED_PENDING_REVIEW);
});
