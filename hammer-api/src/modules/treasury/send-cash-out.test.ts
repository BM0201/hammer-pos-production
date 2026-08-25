import assert from "node:assert/strict";
import test from "node:test";
import { Prisma, PaymentMethod, CashMovementType, TreasuryAccountType } from "@prisma/client";
import { sendCashOutSchema } from "@/modules/treasury/validators";
import { sendCashOutToCustodyTx } from "@/modules/treasury/cash-monitor";

/**
 * El selector roto: el sheet de "Enviar a depositar" pedía una cuenta
 * destino y la descartaba (sendCashOutSchema nunca aceptó bankAccountId),
 * y listaba TODAS las cuentas activas — incluidas CUSTODY de otras
 * personas y SETTLEMENT — como si fueran opciones válidas de depósito.
 * Estas pruebas cubren las DOS mitades del fix: el schema (pruebas 1-2) y
 * la validación server-side dentro de sendCashOutToCustodyTx (pruebas 3-7)
 * — la Prueba 3 es la que importa: es exactamente lo que el selector roto
 * permitía.
 */

test("Prueba 1 — DEPOSIT_DISPATCH sin bankAccountId es rechazado por el schema", () => {
  const result = sendCashOutSchema.safeParse({
    cashSessionId: "clx0000000000000000000000",
    amount: 500,
    carrierUserId: "clx0000000000000000000001",
    reason: "DEPOSIT_DISPATCH",
  });
  assert.equal(result.success, false);
  if (!result.success) {
    assert.deepEqual(result.error.flatten().fieldErrors.bankAccountId, ["Elegí la cuenta a la que va el depósito."]);
  }
});

test("Prueba 2 — HANDOVER sin bankAccountId es aceptado", () => {
  const result = sendCashOutSchema.safeParse({
    cashSessionId: "clx0000000000000000000000",
    amount: 500,
    carrierUserId: "clx0000000000000000000001",
    reason: "HANDOVER",
  });
  assert.equal(result.success, true);
});

// ─── Pruebas 3-7: validación server-side dentro de sendCashOutToCustodyTx ──

type FakeSession = {
  id: string;
  status: string;
  openingAmount: number;
  expectedCashAmount: number | null;
  countedCashAmount: number | null;
  operationalDayId: string | null;
  physicalCashBox: { branchId: string };
};
type FakeUser = { id: string; globalRole: string | null; isActive: boolean; fullName?: string };
type FakeOperator = { cashSessionId: string; userId: string; isActive: boolean; revokedAt: Date | null };
type FakeAccount = {
  id: string;
  type: TreasuryAccountType;
  isActive: boolean;
  branchId: string | null;
  currencyCode: "NIO" | "USD";
  code?: string | null;
  holderUserId?: string | null;
  bankName: string;
  accountAlias: string;
  accountNumber: string;
  owner?: string | null;
};
type FakeTender = { method: PaymentMethod; amount: number; changeAmount?: number; cashSessionId: string; status: "POSTED" };
type FakeMovement = { id: string; type: CashMovementType; amount: number; cashSessionId: string };

function createFakeTx(opts: {
  sessions: FakeSession[];
  users?: FakeUser[];
  operators?: FakeOperator[];
  accounts?: FakeAccount[];
  tenders?: FakeTender[];
}) {
  const sessions = new Map(opts.sessions.map((s) => [s.id, s]));
  const users = new Map((opts.users ?? []).map((u) => [u.id, u]));
  const operators = opts.operators ?? [];
  const accounts = new Map((opts.accounts ?? []).map((a) => [a.id, a]));
  const tenders = [...(opts.tenders ?? [])];
  const movements: FakeMovement[] = [];
  const treasuryEntries: Array<Record<string, unknown>> = [];
  const auditLogs: Array<Record<string, unknown>> = [];
  let seq = 0;

  const tx = {
    cashSession: {
      findUniqueOrThrow: async ({ where }: { where: { id: string } }) => {
        const s = sessions.get(where.id);
        if (!s) throw new Error(`sesion ${where.id} no encontrada`);
        return s;
      },
      update: async ({ where, data }: { where: { id: string }; data: { expectedCashAmount?: unknown } }) => {
        const s = sessions.get(where.id);
        if (s && data.expectedCashAmount !== undefined) s.expectedCashAmount = Number(data.expectedCashAmount);
        return s;
      },
    },
    user: {
      findUnique: async ({ where }: { where: { id: string } }) => users.get(where.id) ?? null,
      findUniqueOrThrow: async ({ where }: { where: { id: string } }) => {
        const u = users.get(where.id);
        if (!u) throw new Error(`usuario ${where.id} no encontrado`);
        return u;
      },
    },
    cashSessionOperator: {
      findFirst: async ({ where }: { where: { cashSessionId: string; userId: string } }) =>
        operators.find((o) => o.cashSessionId === where.cashSessionId && o.userId === where.userId && o.isActive && o.revokedAt === null) ?? null,
    },
    treasuryAccount: {
      findUniqueOrThrow: async ({ where }: { where: { id: string } }) => {
        const a = accounts.get(where.id);
        if (!a) throw new Error(`cuenta ${where.id} no encontrada`);
        return a;
      },
      findUnique: async ({ where }: { where: { id?: string; code?: string } }) => {
        if (where.code !== undefined) return [...accounts.values()].find((a) => a.code === where.code) ?? null;
        if (where.id !== undefined) return accounts.get(where.id) ?? null;
        return null;
      },
      create: async ({ data }: { data: Omit<FakeAccount, "id"> }) => {
        seq += 1;
        const row: FakeAccount = { id: `custody-${seq}`, ...data };
        accounts.set(row.id, row);
        return row;
      },
    },
    cashMovement: {
      create: async ({ data }: { data: Omit<FakeMovement, "id"> }) => {
        seq += 1;
        const row: FakeMovement = { id: `movement-${seq}`, ...data };
        movements.push(row);
        return row;
      },
      findMany: async ({ where }: { where: { cashSessionId: string } }) =>
        movements.filter((m) => m.cashSessionId === where.cashSessionId).map((m) => ({ type: m.type, amount: m.amount })),
    },
    paymentTender: {
      aggregate: async ({ where, _sum }: {
        where: { method: PaymentMethod; payment: { cashSessionId: string; status: string } };
        _sum: Record<string, boolean>;
      }) => {
        const matches = tenders.filter((t) => t.method === where.method && t.cashSessionId === where.payment.cashSessionId && t.status === where.payment.status);
        if ("amount" in _sum) return { _sum: { amount: matches.reduce((s, t) => s + t.amount, 0) } };
        return { _sum: { changeAmount: matches.reduce((s, t) => s + (t.changeAmount ?? 0), 0) } };
      },
    },
    treasuryEntry: {
      create: async ({ data }: { data: Record<string, unknown> }) => {
        seq += 1;
        const row = { id: `entry-${seq}`, ...data };
        treasuryEntries.push(row);
        return row;
      },
    },
    cashDepositPostponement: {
      findMany: async () => [] as Array<{ id: string; amount: number }>,
      deleteMany: async () => ({ count: 0 }),
    },
    auditLog: {
      create: async ({ data }: { data: Record<string, unknown> }) => {
        auditLogs.push(data);
        return { id: `audit-${++seq}`, ...data };
      },
    },
  };

  return { tx: tx as unknown as Prisma.TransactionClient, treasuryEntries, movements, auditLogs, accounts };
}

const BRANCH = "branch-1";
const OTHER_BRANCH = "branch-2";
const SESSION: FakeSession = { id: "session-1", status: "OPEN", openingAmount: 0, expectedCashAmount: 890, countedCashAmount: null, operationalDayId: null, physicalCashBox: { branchId: BRANCH } };
const ACTOR: FakeUser = { id: "user-1", globalRole: null, isActive: true };
const OPERATOR: FakeOperator = { cashSessionId: "session-1", userId: "user-1", isActive: true, revokedAt: null };
const CARRIER: FakeUser = { id: "user-carrier", globalRole: null, isActive: true, fullName: "Juan Portador" };
const TENDERS: FakeTender[] = [{ method: PaymentMethod.CASH, amount: 890, cashSessionId: "session-1", status: "POSTED" }];

test("Prueba 3 (LA QUE IMPORTA) — DEPOSIT_DISPATCH con cuenta tipo CUSTODY es rechazado", async () => {
  const custodyAsTarget: FakeAccount = { id: "acct-custody-otra-persona", type: "CUSTODY", isActive: true, branchId: BRANCH, currencyCode: "NIO", bankName: "Custodia", accountAlias: "Otra persona", accountNumber: "" };
  const { tx } = createFakeTx({ sessions: [SESSION], users: [ACTOR, CARRIER], operators: [OPERATOR], accounts: [custodyAsTarget], tenders: TENDERS });
  await assert.rejects(
    () => sendCashOutToCustodyTx(tx, { cashSessionId: "session-1", branchId: BRANCH, amount: 500, carrierUserId: "user-carrier", reason: "DEPOSIT_DISPATCH", bankAccountId: "acct-custody-otra-persona", actorUserId: "user-1" }),
    /no es bancaria/,
  );
});

test("Prueba 4 — DEPOSIT_DISPATCH con cuenta de OTRA sucursal es rechazado", async () => {
  const otherBranchBank: FakeAccount = { id: "acct-bank-otra-sucursal", type: "BANK", isActive: true, branchId: OTHER_BRANCH, currencyCode: "NIO", bankName: "LAFISE", accountAlias: "Cuenta corriente", accountNumber: "1234567890" };
  const { tx } = createFakeTx({ sessions: [SESSION], users: [ACTOR, CARRIER], operators: [OPERATOR], accounts: [otherBranchBank], tenders: TENDERS });
  await assert.rejects(
    () => sendCashOutToCustodyTx(tx, { cashSessionId: "session-1", branchId: BRANCH, amount: 500, carrierUserId: "user-carrier", reason: "DEPOSIT_DISPATCH", bankAccountId: "acct-bank-otra-sucursal", actorUserId: "user-1" }),
    /no pertenece a esta sucursal/,
  );
});

test("Prueba 5 — cuenta con branchId null (cuenta global/central) es aceptada", async () => {
  const centralBank: FakeAccount = { id: "acct-bank-central", type: "BANK", isActive: true, branchId: null, currencyCode: "NIO", bankName: "BAC", accountAlias: "Central", accountNumber: "9988776655" };
  const { tx, treasuryEntries } = createFakeTx({ sessions: [SESSION], users: [ACTOR, CARRIER], operators: [OPERATOR], accounts: [centralBank], tenders: TENDERS });
  const result = await sendCashOutToCustodyTx(tx, { cashSessionId: "session-1", branchId: BRANCH, amount: 500, carrierUserId: "user-carrier", reason: "DEPOSIT_DISPATCH", bankAccountId: "acct-bank-central", actorUserId: "user-1" });
  assert.equal(result.intendedBankAccountId, "acct-bank-central");
  assert.equal(treasuryEntries.length, 1);
});

test("Prueba 6 — cuenta inactiva es rechazada", async () => {
  const inactiveBank: FakeAccount = { id: "acct-bank-inactiva", type: "BANK", isActive: false, branchId: BRANCH, currencyCode: "NIO", bankName: "LAFISE", accountAlias: "Cerrada", accountNumber: "1112223334" };
  const { tx } = createFakeTx({ sessions: [SESSION], users: [ACTOR, CARRIER], operators: [OPERATOR], accounts: [inactiveBank], tenders: TENDERS });
  await assert.rejects(
    () => sendCashOutToCustodyTx(tx, { cashSessionId: "session-1", branchId: BRANCH, amount: 500, carrierUserId: "user-carrier", reason: "DEPOSIT_DISPATCH", bankAccountId: "acct-bank-inactiva", actorUserId: "user-1" }),
    /está inactiva/,
  );
});

test("Prueba 7 — DEPOSIT_DISPATCH exitoso: la TreasuryEntry queda con intendedBankAccountId poblado", async () => {
  const bank: FakeAccount = { id: "acct-bank-lafise", type: "BANK", isActive: true, branchId: BRANCH, currencyCode: "NIO", bankName: "LAFISE", accountAlias: "Cuenta corriente", accountNumber: "5556667778" };
  const { tx, treasuryEntries, movements } = createFakeTx({ sessions: [SESSION], users: [ACTOR, CARRIER], operators: [OPERATOR], accounts: [bank], tenders: TENDERS });

  const result = await sendCashOutToCustodyTx(tx, {
    cashSessionId: "session-1",
    branchId: BRANCH,
    amount: 500,
    carrierUserId: "user-carrier",
    reason: "DEPOSIT_DISPATCH",
    bankAccountId: "acct-bank-lafise",
    actorUserId: "user-1",
  });

  assert.equal(result.intendedBankAccountId, "acct-bank-lafise");
  assert.equal(treasuryEntries.length, 1, "una TreasuryEntry (IN a custodia)");
  assert.equal(treasuryEntries[0].intendedBankAccountId, "acct-bank-lafise", "el campo nuevo queda poblado en la fila real");
  assert.equal(treasuryEntries[0].entryType, "DEPOSIT_DISPATCH");
  assert.equal(movements.length, 1, "un CashMovement BANK_DEPOSIT_OUT");

  // El wrapper público (sendCashOutToCustody, no probado acá por abrir su
  // propia transacción) arma el audit log de CASH_SENT_MID_SESSION con
  // exactamente estos mismos campos — ver metadataJson en cash-monitor.ts.
  // Acá se verifica que el dato que ese log necesita (intendedBankAccountId)
  // efectivamente sale de sendCashOutToCustodyTx.
  assert.ok(result.intendedBankAccountId, "el wrapper tiene con qué poblar metadataJson.intendedBankAccountId");
});
