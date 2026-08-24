import assert from "node:assert/strict";
import test from "node:test";
import { Prisma } from "@prisma/client";
import { depositBranchCashDirectTx, computeAccountBalance } from "@/modules/treasury/service";

/**
 * depositBranchCashDirect (service.ts) se parte en dos: el wrapper público
 * abre prisma.$transaction y resuelve getBranchCashPosition ANTES de
 * entrar — esa función usa el cliente global de Prisma y no se puede
 * fakear sin una base de datos real (mismo criterio documentado en
 * cash-monitor.test.ts: "los casos que dependen de datos reales... usan el
 * prisma global, no se fake-tx-testean"). Acá se prueba depositBranchCashDirectTx,
 * que recibe pendingDeposit/accumulatedAmount ya resueltos — el cuerpo
 * transaccional real, con el mismo patrón de fake tx en memoria que
 * account-payment.test.ts.
 *
 * EL INVARIANTE QUE PRUEBA EL "TEST QUE IMPORTA" (getBranchCashPosition corta
 * el acumulado por la fecha del último DEPOSIT_DISPATCH/DEPOSIT_CONFIRMED
 * sobre una cuenta CUSTODY de la sucursal, sin importar el monto — ver el
 * comentario de depositBranchCashDirectTx en service.ts): el monto
 * despachado a custodia (dispatchAmount) es SIEMPRE max(amount,
 * accumulatedAmount). Con un depósito completo, dispatchAmount ===
 * accumulatedAmount → nada queda sin cubrir → getBranchCashPosition, en su
 * siguiente llamada, encuentra el corte exactamente en el monto acumulado y
 * reporta accumulatedAmount = 0. Con un depósito parcial, dispatchAmount
 * sigue cubriendo el acumulado COMPLETO (así que igual queda en 0 — el corte
 * es por tiempo, no se puede "cubrir a medias"), pero el remanente no
 * transferido al banco quedan en la custodia del actor, visible como
 * inTransitAmount — no desaparece.
 */

type FakeAccount = {
  id: string;
  type: "BANK" | "SAFE" | "CUSTODY" | "SETTLEMENT";
  code: string | null;
  bankName: string;
  accountAlias: string;
  accountNumber: string;
  currencyCode: "NIO" | "USD";
  branchId: string | null;
  holderUserId: string | null;
  isActive: boolean;
  owner: string | null;
};

type FakeEntry = {
  id: string;
  accountId: string;
  direction: "IN" | "OUT";
  amount: Prisma.Decimal;
  entryType: string;
  transferId: string | null;
  bankDepositId: string | null;
};

type FakeDeposit = { id: string; bankAccountId: string; branchId: string; amount: number; confirmedByUserId: string };

function createFakeTx(opts: { accounts: FakeAccount[]; users?: Array<{ id: string; fullName: string }>; existingEntries?: Array<{ accountId: string; direction: "IN" | "OUT"; amount: number }> }) {
  const accounts = new Map(opts.accounts.map((a) => [a.id, { ...a }]));
  const users = new Map((opts.users ?? []).map((u) => [u.id, u]));
  const entries: FakeEntry[] = [];
  const deposits: FakeDeposit[] = [];
  let seq = 0;

  for (const seeded of opts.existingEntries ?? []) {
    seq += 1;
    entries.push({ id: `seed-${seq}`, accountId: seeded.accountId, direction: seeded.direction, amount: new Prisma.Decimal(seeded.amount), entryType: "SEED", transferId: null, bankDepositId: null });
  }

  const tx = {
    treasuryAccount: {
      findUniqueOrThrow: async ({ where }: { where: { id: string } }) => {
        const acc = accounts.get(where.id);
        if (!acc) throw new Error(`cuenta ${where.id} no encontrada`);
        return acc;
      },
      findUnique: async ({ where }: { where: { code?: string; id?: string } }) => {
        if (where.code !== undefined) return [...accounts.values()].find((a) => a.code === where.code) ?? null;
        if (where.id !== undefined) return accounts.get(where.id) ?? null;
        return null;
      },
      create: async ({ data }: { data: Record<string, unknown> }) => {
        seq += 1;
        const row = { id: `acc-${seq}`, isActive: true, owner: null, ...data } as unknown as FakeAccount;
        accounts.set(row.id, row);
        return row;
      },
    },
    user: {
      findUniqueOrThrow: async ({ where }: { where: { id: string } }) => {
        const u = users.get(where.id);
        if (!u) throw new Error(`usuario ${where.id} no encontrado`);
        return u;
      },
    },
    treasuryEntry: {
      create: async ({ data }: { data: Record<string, unknown> }) => {
        seq += 1;
        const row = { id: `entry-${seq}`, ...data } as unknown as FakeEntry;
        entries.push(row);
        return row;
      },
    },
    bankDeposit: {
      create: async ({ data }: { data: Record<string, unknown> }) => {
        seq += 1;
        const row = { id: `deposit-${seq}`, ...data } as unknown as FakeDeposit;
        deposits.push(row);
        return row;
      },
    },
  };

  return { tx: tx as unknown as Prisma.TransactionClient, accounts, entries, deposits };
}

function balanceOf(entries: FakeEntry[], accountId: string): number {
  const totalIn = entries.filter((e) => e.accountId === accountId && e.direction === "IN").reduce((s, e) => s + Number(e.amount), 0);
  const totalOut = entries.filter((e) => e.accountId === accountId && e.direction === "OUT").reduce((s, e) => s + Number(e.amount), 0);
  return computeAccountBalance(0, totalIn, totalOut);
}

const BANK: FakeAccount = { id: "bank-1", type: "BANK", code: null, bankName: "BAC", accountAlias: "Córdobas", accountNumber: "111", currencyCode: "NIO", branchId: null, holderUserId: null, isActive: true, owner: null };
const ACTOR = { id: "user-1", fullName: "Ana Operadora" };

test("depósito COMPLETO: se despacha exactamente el acumulado, no queda remanente en custodia (el corte de getBranchCashPosition encuentra 0)", async () => {
  const { tx, entries } = createFakeTx({ accounts: [BANK], users: [ACTOR] });
  const result = await depositBranchCashDirectTx(
    tx,
    { branchId: "branch-masaya", bankAccountId: "bank-1", amount: 1000, actorUserId: "user-1" },
    /* pendingDeposit */ 1000,
    /* accumulatedAmount */ 1000,
  );
  assert.equal(result.remainderInCustody, 0);
  const dispatchEntry = entries.find((e) => e.entryType === "DEPOSIT_DISPATCH");
  assert.equal(Number(dispatchEntry?.amount), 1000, "el monto despachado a custodia debe cubrir el acumulado completo");
});

test("depósito PARCIAL: igual se despacha el acumulado completo a custodia (el corte se limpia), pero el remanente no depositado queda registrado ahí — no desaparece", async () => {
  const { tx, entries } = createFakeTx({ accounts: [BANK], users: [ACTOR] });
  const result = await depositBranchCashDirectTx(
    tx,
    { branchId: "branch-masaya", bankAccountId: "bank-1", amount: 400, actorUserId: "user-1" },
    /* pendingDeposit */ 1000,
    /* accumulatedAmount */ 1000,
  );
  assert.equal(result.remainderInCustody, 600, "el remanente (1000 - 400) debe quedar trazado, no perderse");
  const dispatchEntry = entries.find((e) => e.entryType === "DEPOSIT_DISPATCH");
  assert.equal(Number(dispatchEntry?.amount), 1000, "el despacho sigue cubriendo el acumulado completo, aunque el depósito sea parcial");
  const transferOut = entries.find((e) => e.entryType === "DEPOSIT_CONFIRMED" && e.direction === "OUT");
  assert.equal(Number(transferOut?.amount), 400, "solo el monto depositado sale de custodia hacia el banco");
});

test("monto mayor al pendingDeposit: rechazado, sin BankDeposit creado", async () => {
  const { tx, deposits } = createFakeTx({ accounts: [BANK], users: [ACTOR] });
  await assert.rejects(
    () => depositBranchCashDirectTx(tx, { branchId: "b", bankAccountId: "bank-1", amount: 500.02, actorUserId: "user-1" }, 500, 500),
    /VALIDATION_ERROR/,
  );
  assert.equal(deposits.length, 0);
});

test("cuenta destino en USD: rechazada", async () => {
  const usdAccount: FakeAccount = { ...BANK, id: "bank-usd", currencyCode: "USD" };
  const { tx } = createFakeTx({ accounts: [usdAccount], users: [ACTOR] });
  await assert.rejects(
    () => depositBranchCashDirectTx(tx, { branchId: "b", bankAccountId: "bank-usd", amount: 100, actorUserId: "user-1" }, 500, 500),
    /VALIDATION_ERROR.*córdobas/,
  );
});

test("cuenta destino inactiva: rechazada", async () => {
  const inactive: FakeAccount = { ...BANK, id: "bank-inactive", isActive: false };
  const { tx } = createFakeTx({ accounts: [inactive], users: [ACTOR] });
  await assert.rejects(
    () => depositBranchCashDirectTx(tx, { branchId: "b", bankAccountId: "bank-inactive", amount: 100, actorUserId: "user-1" }, 500, 500),
    /VALIDATION_ERROR.*inactiva/,
  );
});

for (const badType of ["SAFE", "CUSTODY", "SETTLEMENT"] as const) {
  test(`cuenta destino de tipo ${badType}: rechazada (solo BANK puede recibir depósito directo)`, async () => {
    const notBank: FakeAccount = { ...BANK, id: `acc-${badType}`, type: badType };
    const { tx } = createFakeTx({ accounts: [notBank], users: [ACTOR] });
    await assert.rejects(
      () => depositBranchCashDirectTx(tx, { branchId: "b", bankAccountId: `acc-${badType}`, amount: 100, actorUserId: "user-1" }, 500, 500),
      /VALIDATION_ERROR.*no es bancaria/,
    );
  });
}

test("tras un depósito completo, el saldo de la cuenta CUSTODY del actor vuelve a 0 (entró y salió en la misma transacción)", async () => {
  const { tx, entries } = createFakeTx({ accounts: [BANK], users: [ACTOR] });
  const result = await depositBranchCashDirectTx(
    tx,
    { branchId: "branch-masaya", bankAccountId: "bank-1", amount: 1000, actorUserId: "user-1" },
    1000,
    1000,
  );
  assert.equal(balanceOf(entries, result.custodyAccountId), 0);
});

test("el saldo de la cuenta BANK sube exactamente por el monto depositado", async () => {
  const { tx, entries } = createFakeTx({
    accounts: [BANK],
    users: [ACTOR],
    existingEntries: [{ accountId: "bank-1", direction: "IN", amount: 189_193.28 }],
  });
  const balanceBefore = balanceOf(entries, "bank-1");
  await depositBranchCashDirectTx(tx, { branchId: "branch-masaya", bankAccountId: "bank-1", amount: 400, actorUserId: "user-1" }, 1000, 1000);
  const balanceAfter = balanceOf(entries, "bank-1");
  assert.equal(Math.round((balanceAfter - balanceBefore) * 100) / 100, 400);
});

test("depósito exactamente igual al tope (amount === pendingDeposit) se acepta", async () => {
  const { tx, deposits } = createFakeTx({ accounts: [BANK], users: [ACTOR] });
  await depositBranchCashDirectTx(tx, { branchId: "b", bankAccountId: "bank-1", amount: 500, actorUserId: "user-1" }, 500, 500);
  assert.equal(deposits.length, 1);
});
