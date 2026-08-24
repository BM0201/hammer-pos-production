import assert from "node:assert/strict";
import test from "node:test";
import { Prisma } from "@prisma/client";
import { postponeCashDepositTx } from "@/modules/treasury/cash-monitor";

/**
 * postponeCashDeposit (cash-monitor.ts) se parte en dos: postponeCashDepositTx
 * (todo lo que hace falta ya vive en `tx`, nada usa el cliente global de
 * Prisma) y un wrapper delgado que abre la transacción y audita — mismo
 * patrón que recordAccountPaymentTx/depositBranchCashDirectTx. Acá se
 * prueba postponeCashDepositTx con el mismo patrón de fake tx en memoria
 * que account-payment.test.ts/direct-deposit.test.ts.
 *
 * REGLA CRÍTICA que este archivo existe para blindar: posponer NO puede
 * escribir TreasuryEntry ni CashMovement, ni mover el corte que usa
 * getBranchCashPosition para "días sin depositar". El fake tx de abajo NO
 * implementa treasuryEntry.create ni cashMovement.create/cashSession.update
 * a propósito — si postponeCashDepositTx alguna vez intentara llamarlos, la
 * prueba revienta con un TypeError inmediato en vez de pasar en silencio.
 */

type FakeSession = {
  id: string;
  status: "OPEN" | "CLOSED" | "PENDING_PAYMENT";
  expectedCashAmount: number;
  physicalCashBox: { branchId: string };
};
type FakeUser = { id: string; globalRole: string | null; isActive: boolean };
type FakeOperator = { cashSessionId: string; userId: string; isActive: boolean; revokedAt: Date | null };
type FakeTreasuryEntry = { entryType: string; occurredAt: Date; branchId: string; accountType: string };
type FakePostponement = {
  id: string;
  cashSessionId: string;
  branchId: string;
  amount: number;
  reason: string | null;
  postponedUntil: Date;
  declaredByUserId: string;
  createdAt: Date;
};

function createFakeTx(opts: {
  sessions: FakeSession[];
  users?: FakeUser[];
  operators?: FakeOperator[];
  treasuryEntries?: FakeTreasuryEntry[];
  postponements?: FakePostponement[];
  policy?: { branchId: string; maxDaysHolding: number } | null;
}) {
  const sessions = new Map(opts.sessions.map((s) => [s.id, s]));
  const users = new Map((opts.users ?? []).map((u) => [u.id, u]));
  const operators = opts.operators ?? [];
  const treasuryEntries = [...(opts.treasuryEntries ?? [])];
  const postponements: FakePostponement[] = [...(opts.postponements ?? [])];
  let seq = 0;
  let clock = 1_700_000_000_000; // avanza en cada create — createdAt estrictamente creciente, como en la DB real

  const tx = {
    cashSession: {
      findUniqueOrThrow: async ({ where }: { where: { id: string } }) => {
        const s = sessions.get(where.id);
        if (!s) throw new Error(`sesion ${where.id} no encontrada`);
        return s;
      },
    },
    user: {
      findUnique: async ({ where }: { where: { id: string } }) => users.get(where.id) ?? null,
    },
    cashSessionOperator: {
      findFirst: async ({ where }: { where: { cashSessionId: string; userId: string } }) =>
        operators.find((o) => o.cashSessionId === where.cashSessionId && o.userId === where.userId && o.isActive && o.revokedAt === null) ?? null,
    },
    cashDepositPostponement: {
      create: async ({ data }: { data: Omit<FakePostponement, "id" | "createdAt"> }) => {
        seq += 1;
        clock += 1000;
        const row: FakePostponement = { id: `postponement-${seq}`, createdAt: new Date(clock), ...data };
        postponements.push(row);
        return row;
      },
      count: async ({ where }: { where: { branchId: string; createdAt?: { gt: Date } } }) =>
        postponements.filter((p) => p.branchId === where.branchId && (!where.createdAt || p.createdAt.getTime() > where.createdAt.gt.getTime())).length,
    },
    treasuryEntry: {
      findFirst: async ({ where }: { where: { entryType: { in: string[] }; account: { branchId: string; type: string } } }) => {
        const matches = treasuryEntries
          .filter((e) => where.entryType.in.includes(e.entryType) && e.branchId === where.account.branchId && e.accountType === where.account.type)
          .sort((a, b) => b.occurredAt.getTime() - a.occurredAt.getTime());
        return matches[0] ? { occurredAt: matches[0].occurredAt } : null;
      },
    },
    branchDepositPolicy: {
      findUnique: async ({ where }: { where: { branchId: string } }) =>
        opts.policy && opts.policy.branchId === where.branchId ? { maxDaysHolding: opts.policy.maxDaysHolding } : null,
    },
  };

  return { tx: tx as unknown as Prisma.TransactionClient, sessions, postponements, treasuryEntries };
}

const BRANCH = "branch-1";
const SESSION: FakeSession = { id: "session-1", status: "OPEN", expectedCashAmount: 5000, physicalCashBox: { branchId: BRANCH } };
const ACTOR: FakeUser = { id: "user-1", globalRole: null, isActive: true };
const OPERATOR: FakeOperator = { cashSessionId: "session-1", userId: "user-1", isActive: true, revokedAt: null };

test("posponer NO crea ninguna TreasuryEntry — el corte de getBranchCashPosition depende exclusivamente de esas filas, así que si esto pasa, daysSinceOldestRetained/state tampoco cambian", async () => {
  const { tx, treasuryEntries } = createFakeTx({ sessions: [SESSION], users: [ACTOR], operators: [OPERATOR] });
  const before = treasuryEntries.length;
  // Si postponeCashDepositTx alguna vez llamara tx.treasuryEntry.create, este
  // fake no lo implementa — revienta con TypeError, no pasa en silencio.
  await postponeCashDepositTx(tx, { cashSessionId: "session-1", branchId: BRANCH, amount: 1000, actorUserId: "user-1" });
  assert.equal(treasuryEntries.length, before, "ninguna TreasuryEntry nueva");
});

test("posponer no crea ningún CashMovement ni altera expectedCashAmount", async () => {
  const { tx, sessions } = createFakeTx({ sessions: [SESSION], users: [ACTOR], operators: [OPERATOR] });
  // El fake no implementa cashMovement.create ni cashSession.update — si
  // postponeCashDepositTx los llamara, esto reventaría antes de llegar acá.
  await postponeCashDepositTx(tx, { cashSessionId: "session-1", branchId: BRANCH, amount: 1000, actorUserId: "user-1" });
  assert.equal(sessions.get("session-1")?.expectedCashAmount, 5000, "expectedCashAmount intacto");
});

test("monto mayor al efectivo esperado en caja → rechazado", async () => {
  const { tx } = createFakeTx({ sessions: [SESSION], users: [ACTOR], operators: [OPERATOR] });
  await assert.rejects(
    () => postponeCashDepositTx(tx, { cashSessionId: "session-1", branchId: BRANCH, amount: 5000.02, actorUserId: "user-1" }),
    /VALIDATION_ERROR/,
  );
});

test("sesión CLOSED → rechazada", async () => {
  const closed: FakeSession = { ...SESSION, status: "CLOSED" };
  const { tx } = createFakeTx({ sessions: [closed], users: [ACTOR], operators: [OPERATOR] });
  await assert.rejects(
    () => postponeCashDepositTx(tx, { cashSessionId: "session-1", branchId: BRANCH, amount: 1000, actorUserId: "user-1" }),
    /CASH_SESSION_NOT_OPEN/,
  );
});

test("usuario que no es operador de la sesión → rechazado", async () => {
  const { tx } = createFakeTx({ sessions: [SESSION], users: [ACTOR] }); // sin operador registrado
  await assert.rejects(
    () => postponeCashDepositTx(tx, { cashSessionId: "session-1", branchId: BRANCH, amount: 1000, actorUserId: "user-1" }),
    /CASH_SESSION_OPERATOR_REQUIRED/,
  );
});

test("un MASTER puede posponer sin estar en la lista de operadores (mismo criterio que userCanOperateCashSessionTx)", async () => {
  const master: FakeUser = { id: "user-master", globalRole: "MASTER", isActive: true };
  const { tx } = createFakeTx({ sessions: [SESSION], users: [master] });
  const result = await postponeCashDepositTx(tx, { cashSessionId: "session-1", branchId: BRANCH, amount: 1000, actorUserId: "user-master" });
  assert.equal(result.postponement.amount, 1000);
});

test("consecutivePostponements: sin DEPOSIT_DISPATCH entre medio, se acumulan (1, luego 2)", async () => {
  const { tx } = createFakeTx({ sessions: [SESSION], users: [ACTOR], operators: [OPERATOR] });
  const first = await postponeCashDepositTx(tx, { cashSessionId: "session-1", branchId: BRANCH, amount: 500, actorUserId: "user-1" });
  assert.equal(first.consecutiveCount, 1);
  const second = await postponeCashDepositTx(tx, { cashSessionId: "session-1", branchId: BRANCH, amount: 500, actorUserId: "user-1" });
  assert.equal(second.consecutiveCount, 2, "sin depósito real entre medio, sigue acumulando");
});

test("consecutivePostponements: un DEPOSIT_DISPATCH real entre dos posposiciones reinicia el contador a 1, no a 3", async () => {
  const { tx, treasuryEntries } = createFakeTx({ sessions: [SESSION], users: [ACTOR], operators: [OPERATOR] });
  const first = await postponeCashDepositTx(tx, { cashSessionId: "session-1", branchId: BRANCH, amount: 500, actorUserId: "user-1" });
  assert.equal(first.consecutiveCount, 1);

  // Un depósito real sale de la sucursal — occurredAt posterior a la primera posposición.
  treasuryEntries.push({
    entryType: "DEPOSIT_DISPATCH",
    occurredAt: new Date(first.postponement.createdAt.getTime() + 500),
    branchId: BRANCH,
    accountType: "CUSTODY",
  });

  const second = await postponeCashDepositTx(tx, { cashSessionId: "session-1", branchId: BRANCH, amount: 500, actorUserId: "user-1" });
  assert.equal(second.consecutiveCount, 1, "el corte del depósito real excluye la posposición anterior — vuelve a 1, no sigue en 2");
});

test("requiresAttention: true cuando hay política Y consecutiveCount >= maxDaysHolding; nunca bloquea (el resultado se devuelve igual)", async () => {
  const { tx } = createFakeTx({ sessions: [SESSION], users: [ACTOR], operators: [OPERATOR], policy: { branchId: BRANCH, maxDaysHolding: 2 } });
  const first = await postponeCashDepositTx(tx, { cashSessionId: "session-1", branchId: BRANCH, amount: 500, actorUserId: "user-1" });
  assert.equal(first.requiresAttention, false, "1 < 2 todavia");
  const second = await postponeCashDepositTx(tx, { cashSessionId: "session-1", branchId: BRANCH, amount: 500, actorUserId: "user-1" });
  assert.equal(second.consecutiveCount, 2);
  assert.equal(second.requiresAttention, true, "2 >= maxDaysHolding, pero el registro se creó igual — no bloqueó");
});

test("requiresAttention: sin política configurada, siempre false (nunca se inventa un umbral)", async () => {
  const { tx } = createFakeTx({ sessions: [SESSION], users: [ACTOR], operators: [OPERATOR], policy: null });
  const result = await postponeCashDepositTx(tx, { cashSessionId: "session-1", branchId: BRANCH, amount: 500, actorUserId: "user-1" });
  assert.equal(result.requiresAttention, false);
});
