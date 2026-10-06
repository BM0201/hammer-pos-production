import assert from "node:assert/strict";
import test from "node:test";
import { Prisma } from "@prisma/client";
import { voidRetainedCashExpenseTx, declareCashDestinationTx } from "@/modules/treasury/service";

/**
 * prompt-seguridad-basica.md (seguimiento) — voidRetainedCashExpense leía
 * isActive fuera de cualquier lock y escribía el asiento de reversión ANTES
 * de desactivar el gasto: una doble anulación concurrente podía crear DOS
 * asientos de reversión para el mismo gasto. Ahora bloquea la fila
 * (FOR UPDATE), relee isActive bajo el lock, y el asiento de reversión solo
 * se escribe DESPUÉS de que el updateMany condicional devolvió count===1.
 */

const EXPENSE_ID = "expense-1";
const ACCOUNT_ID = "account-1";

function createVoidExpenseFakeStore(opts: { isActive?: boolean } = {}) {
  const expense = {
    id: EXPENSE_ID,
    branchId: "branch-1",
    isActive: opts.isActive ?? true,
  };

  const originalEntry = {
    id: "entry-original",
    accountId: ACCOUNT_ID,
    amount: new Prisma.Decimal(500),
    reference: "REF-1",
    expensePaymentId: EXPENSE_ID,
  };

  const account = { id: ACCOUNT_ID, currencyCode: "NIO" };

  const treasuryEntries: Array<Record<string, unknown> & { id: string }> = [];
  const auditLogs: Array<Record<string, unknown>> = [];
  let entrySeq = 0;

  const tx = {
    $queryRaw: async () => [],
    operatingExpense: {
      findUniqueOrThrow: async () => ({ ...expense }),
      updateMany: async ({ where, data }: { where: { id: string; isActive: boolean }; data: Record<string, unknown> }) => {
        if (where.id !== expense.id || where.isActive !== expense.isActive) return { count: 0 };
        Object.assign(expense, data);
        return { count: 1 };
      },
    },
    treasuryEntry: {
      findUnique: async () => ({ ...originalEntry }),
      create: async ({ data }: { data: Record<string, unknown> }) => {
        entrySeq += 1;
        const row = { id: `rev-${entrySeq}`, ...data };
        treasuryEntries.push(row);
        return row;
      },
    },
    treasuryAccount: {
      findUniqueOrThrow: async () => ({ ...account }),
    },
    auditLog: {
      create: async ({ data }: { data: Record<string, unknown> }) => {
        auditLogs.push(data);
        return data;
      },
    },
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
  } as any;

  return { tx: tx as Prisma.TransactionClient, expense, treasuryEntries, auditLogs };
}

test("LA QUE IMPORTA — doble anulación concurrente del mismo gasto retenido: un solo asiento de reversión", async () => {
  const { tx, expense, treasuryEntries } = createVoidExpenseFakeStore();

  const first = await voidRetainedCashExpenseTx(tx, { expenseId: EXPENSE_ID, actorUserId: "user-1", reason: "Error de captura" });
  assert.ok(first.reversalTreasuryEntryId);
  assert.equal(expense.isActive, false);
  assert.equal(treasuryEntries.length, 1, "un solo asiento de reversión tras la primera anulación");

  await assert.rejects(
    () => voidRetainedCashExpenseTx(tx, { expenseId: EXPENSE_ID, actorUserId: "user-1", reason: "Segundo intento" }),
    /ALREADY_PROCESSED/,
  );
  assert.equal(treasuryEntries.length, 1, "el segundo intento no debe crear un segundo asiento de reversión");
});

test("gasto ya anulado de entrada: ALREADY_PROCESSED inmediato, sin asiento", async () => {
  const { tx, treasuryEntries } = createVoidExpenseFakeStore({ isActive: false });
  await assert.rejects(
    () => voidRetainedCashExpenseTx(tx, { expenseId: EXPENSE_ID, actorUserId: "user-1", reason: "Cualquiera" }),
    /ALREADY_PROCESSED/,
  );
  assert.equal(treasuryEntries.length, 0);
});

/**
 * prompt-seguridad-basica.md (seguimiento) — declareCashDestination leía
 * `existing` fuera de cualquier lock: dos declaraciones concurrentes de la
 * MISMA sesión (p.ej. reemplazando una auto-defaulted) podían pasar el
 * chequeo "¿ya existe?" dos veces y cada una escribir su propio juego de
 * asientos de libro mayor — ninguna de las dos formas de la carrera viola
 * necesariamente el unique de cashSessionId (upsert/ON CONFLICT no siempre
 * lanza P2002), así que el lock sobre CashSession es la defensa real. Caso
 * simple: todo el efectivo se declara como "entregado" (handOver), sin
 * depósito ni retención, para no arrastrar assertCashDepositTargetTx/
 * findSafeAccountForBranch — eso ya lo cubren otros tests de este módulo.
 */

const CASH_SESSION_ID = "session-1";
const BRANCH_ID = "branch-1";
const HANDOVER_USER_ID = "user-handover";
const DECLARED_BY_USER_ID = "user-declare";

function createDeclareCashDestinationFakeStore(opts: { existingDeclaration?: { isAutoDefaulted: boolean } | null } = {}) {
  const session = {
    id: CASH_SESSION_ID,
    status: "CLOSED",
    countedCashAmount: new Prisma.Decimal(300),
  };

  type DeclarationRow = Record<string, unknown> & { id: string; cashSessionId: string; isAutoDefaulted: boolean };
  let declaration: DeclarationRow | null =
    opts.existingDeclaration
      ? ({
          id: "decl-existing",
          cashSessionId: CASH_SESSION_ID,
          branchId: BRANCH_ID,
          handOverAmount: new Prisma.Decimal(0),
          handOverUserId: null,
          depositAmount: new Prisma.Decimal(0),
          depositCarrierUserId: null,
          depositBankAccountId: null,
          retainAmount: new Prisma.Decimal(0),
          retainAwaitingDepositPortion: new Prisma.Decimal(0),
          isAutoDefaulted: opts.existingDeclaration.isAutoDefaulted,
        } satisfies DeclarationRow)
      : null;

  const branch = { cashFundAmount: null as Prisma.Decimal | null };
  const custodyAccounts = new Map<string, { id: string; code: string; currencyCode: string }>();
  const treasuryEntries: Array<Record<string, unknown> & { id: string }> = [];
  const auditLogs: Array<Record<string, unknown>> = [];
  let entrySeq = 0;
  let accountSeq = 0;

  const tx = {
    $queryRaw: async () => [],
    cashSession: {
      findUniqueOrThrow: async () => ({ ...session }),
    },
    cashDestinationDeclaration: {
      findUnique: async () => (declaration ? { ...declaration } : null),
      upsert: async ({ where, create, update }: { where: { cashSessionId: string }; create: Record<string, unknown>; update: Record<string, unknown> }) => {
        if (where.cashSessionId !== CASH_SESSION_ID) throw new Error("unexpected cashSessionId");
        if (declaration) {
          declaration = { ...declaration, ...update } as DeclarationRow;
        } else {
          declaration = { id: "decl-1", ...create } as DeclarationRow;
        }
        return { ...declaration };
      },
    },
    branch: {
      findUniqueOrThrow: async () => ({ ...branch }),
    },
    treasuryAccount: {
      findUnique: async ({ where }: { where: { code: string } }) => custodyAccounts.get(where.code) ?? null,
      findUniqueOrThrow: async ({ where }: { where: { id: string } }) => {
        const found = [...custodyAccounts.values()].find((a) => a.id === where.id);
        if (!found) throw new Error("account not found");
        return found;
      },
      create: async ({ data }: { data: { code: string } }) => {
        accountSeq += 1;
        const row = { id: `custody-${accountSeq}`, code: data.code, currencyCode: "NIO" };
        custodyAccounts.set(data.code, row);
        return row;
      },
    },
    user: {
      findUniqueOrThrow: async () => ({ fullName: "Empleado Test" }),
    },
    treasuryEntry: {
      create: async ({ data }: { data: Record<string, unknown> }) => {
        entrySeq += 1;
        const row = { id: `entry-${entrySeq}`, ...data };
        treasuryEntries.push(row);
        return row;
      },
    },
    auditLog: {
      create: async ({ data }: { data: Record<string, unknown> }) => {
        auditLogs.push(data);
        return data;
      },
    },
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
  } as any;

  return { tx: tx as Prisma.TransactionClient, treasuryEntries, auditLogs, getDeclaration: () => declaration };
}

function baseDeclareInput() {
  return {
    cashSessionId: CASH_SESSION_ID,
    branchId: BRANCH_ID,
    declaredByUserId: DECLARED_BY_USER_ID,
    handOverAmount: 300,
    handOverUserId: HANDOVER_USER_ID,
    depositAmount: 0,
    depositCarrierUserId: null,
    depositBankAccountId: null,
    retainAmount: 0,
    awaitingDepositLocation: "DRAWER" as const,
    notes: null,
  };
}

test("LA QUE IMPORTA — doble declaración concurrente de la misma sesión: la segunda es rechazada, un solo juego de asientos", async () => {
  const { tx, treasuryEntries } = createDeclareCashDestinationFakeStore();

  const first = await declareCashDestinationTx(tx, baseDeclareInput());
  assert.ok(first.id);
  assert.equal(treasuryEntries.length, 1, "un solo asiento (HANDOVER) tras la primera declaración");

  await assert.rejects(
    () => declareCashDestinationTx(tx, baseDeclareInput()),
    /DECLARATION_ALREADY_EXISTS/,
  );
  assert.equal(treasuryEntries.length, 1, "el segundo intento no debe crear asientos nuevos");
});

test("reemplazar una declaración auto-defaulted: funciona una vez; el segundo intento concurrente es rechazado", async () => {
  const { tx, treasuryEntries, getDeclaration } = createDeclareCashDestinationFakeStore({ existingDeclaration: { isAutoDefaulted: true } });

  await declareCashDestinationTx(tx, baseDeclareInput());
  assert.equal(getDeclaration()?.isAutoDefaulted, false, "la declaración real reemplaza la auto-defaulted");
  assert.equal(treasuryEntries.length, 1);

  await assert.rejects(
    () => declareCashDestinationTx(tx, baseDeclareInput()),
    /DECLARATION_ALREADY_EXISTS/,
  );
  assert.equal(treasuryEntries.length, 1, "el segundo intento (ya no auto-defaulted) no debe crear un segundo juego de asientos");
});
