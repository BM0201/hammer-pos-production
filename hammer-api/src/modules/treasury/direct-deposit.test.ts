import assert from "node:assert/strict";
import test from "node:test";
import { Prisma } from "@prisma/client";
import { depositBranchCashDirectTx, computeAccountBalance } from "@/modules/treasury/service";

/**
 * depositBranchCashDirect (service.ts) se parte en dos: el wrapper público
 * abre prisma.$transaction, bloquea la sucursal y resuelve
 * getAccumulatedRetainedTx DENTRO de esa transacción — no se puede fakear
 * sin una base de datos real (mismo criterio documentado en
 * cash-monitor.test.ts: "los casos que dependen de datos reales... usan el
 * prisma global, no se fake-tx-testean"). Acá se prueba
 * depositBranchCashDirectTx, que recibe accumulatedAmount ya resuelto — el
 * cuerpo transaccional real, con el mismo patrón de fake tx en memoria que
 * account-payment.test.ts.
 *
 * prompt-tesoreria-sin-transito.md Fase 1.3 (fix) — YA NO despacha el
 * acumulado completo a custodia: con source=DIRECT_FROM_RETAINED,
 * getLastDepositCutoff (cash-monitor.ts) ignora estos depósitos por
 * completo, así que no hace falta "limpiar" el resto del acumulado
 * despachándolo — solo se mueve `amount`. Sin caja fuerte (SAFE) en la
 * sucursal, pasa por la custodia de Master con saldo neto CERO (entra y
 * sale en el mismo instante); con SAFE, sale directo de ahí, sin custodia.
 * remainderInCustody desaparece del resultado — ya no puede existir.
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
  openingBalance: number;
  openingBalanceAt: Date | null;
};

type FakeEntry = {
  id: string;
  accountId: string;
  direction: "IN" | "OUT";
  amount: Prisma.Decimal;
  entryType: string;
  transferId: string | null;
  bankDepositId: string | null;
  occurredAt: Date;
};

type FakeDeposit = { id: string; bankAccountId: string; branchId: string; amount: number; confirmedByUserId: string; source: string };

function createFakeTx(opts: { accounts: FakeAccount[]; users?: Array<{ id: string; fullName: string }>; existingEntries?: Array<{ accountId: string; direction: "IN" | "OUT"; amount: number }> }) {
  const accounts = new Map(opts.accounts.map((a) => [a.id, { ...a }]));
  const users = new Map((opts.users ?? []).map((u) => [u.id, u]));
  const entries: FakeEntry[] = [];
  const deposits: FakeDeposit[] = [];
  let seq = 0;

  for (const seeded of opts.existingEntries ?? []) {
    seq += 1;
    entries.push({ id: `seed-${seq}`, accountId: seeded.accountId, direction: seeded.direction, amount: new Prisma.Decimal(seeded.amount), entryType: "SEED", transferId: null, bankDepositId: null, occurredAt: new Date() });
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
      // findSafeAccountForBranch: type SAFE + branchId + isActive.
      findFirst: async ({ where }: { where: { type: string; branchId: string; isActive: boolean } }) =>
        [...accounts.values()].find((a) => a.type === where.type && a.branchId === where.branchId && a.isActive === where.isActive) ?? null,
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
        const row = { id: `entry-${seq}`, occurredAt: new Date(), ...data } as unknown as FakeEntry;
        entries.push(row);
        return row;
      },
      // getTreasuryAccountBalanceTx (SAFE balance lookup, camino con SAFE).
      aggregate: async ({ where }: { where: { accountId: string; direction: "IN" | "OUT" } }) => {
        const sum = entries
          .filter((e) => e.accountId === where.accountId && e.direction === where.direction)
          .reduce((s, e) => s + Number(e.amount), 0);
        return { _sum: { amount: sum } };
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

const BANK: FakeAccount = { id: "bank-1", type: "BANK", code: null, bankName: "BAC", accountAlias: "Córdobas", accountNumber: "111", currencyCode: "NIO", branchId: null, holderUserId: null, isActive: true, owner: null, openingBalance: 0, openingBalanceAt: null };
const ACTOR = { id: "user-1", fullName: "Ana Operadora" };
const BRANCH = "branch-masaya";

test("LA QUE IMPORTA — depósito PARCIAL sin SAFE: solo se mueve `amount`, la custodia de Master queda en 0 (nunca 'en tránsito')", async () => {
  const { tx, entries } = createFakeTx({ accounts: [BANK], users: [ACTOR] });
  const result = await depositBranchCashDirectTx(
    tx,
    { branchId: BRANCH, bankAccountId: "bank-1", amount: 400, actorUserId: "user-1" },
    /* accumulatedAmount */ 1000, // el resto (600) NO se despacha — 1.2 lo resta directo del acumulado
  );
  const dispatchEntry = entries.find((e) => e.entryType === "DEPOSIT_DISPATCH");
  assert.equal(Number(dispatchEntry?.amount), 400, "ya no se despacha el acumulado completo, solo el monto depositado");
  assert.equal(balanceOf(entries, result.custodyAccountId!), 0, "la custodia siempre queda en 0 — nunca hay remanente sentado");
  assert.equal("remainderInCustody" in result, false, "remainderInCustody ya no existe — no puede haber remanente");
});

test("el despacho del depósito directo lleva bankDepositId, con source DIRECT_FROM_RETAINED", async () => {
  const { tx, entries, deposits } = createFakeTx({ accounts: [BANK], users: [ACTOR] });
  const result = await depositBranchCashDirectTx(tx, { branchId: BRANCH, bankAccountId: "bank-1", amount: 1000, actorUserId: "user-1" }, 1000);
  const dispatchEntry = entries.find((e) => e.entryType === "DEPOSIT_DISPATCH");
  assert.equal(dispatchEntry?.bankDepositId, result.deposit.id, "el DEPOSIT_DISPATCH debe quedar atado al BankDeposit recién creado, no huérfano");
  assert.equal(deposits[0].source, "DIRECT_FROM_RETAINED");
});

test("LA QUE IMPORTA — las dos patas (DEPOSIT_DISPATCH IN y DEPOSIT_CONFIRMED OUT en custodia) comparten el mismo occurredAt: nunca queda sentado ni un instante", async () => {
  const { tx, entries } = createFakeTx({ accounts: [BANK], users: [ACTOR] });
  const result = await depositBranchCashDirectTx(tx, { branchId: BRANCH, bankAccountId: "bank-1", amount: 700, actorUserId: "user-1" }, 700);
  const dispatchIn = entries.find((e) => e.entryType === "DEPOSIT_DISPATCH" && e.accountId === result.custodyAccountId);
  const confirmedOut = entries.find((e) => e.entryType === "DEPOSIT_CONFIRMED" && e.direction === "OUT" && e.accountId === result.custodyAccountId);
  assert.equal(dispatchIn?.occurredAt.getTime(), confirmedOut?.occurredAt.getTime());
});

test("monto mayor al acumulado: rechazado, sin BankDeposit creado", async () => {
  const { tx, deposits } = createFakeTx({ accounts: [BANK], users: [ACTOR] });
  await assert.rejects(
    () => depositBranchCashDirectTx(tx, { branchId: "b", bankAccountId: "bank-1", amount: 500.02, actorUserId: "user-1" }, 500),
    /VALIDATION_ERROR/,
  );
  assert.equal(deposits.length, 0);
});

test("cuenta destino en USD: rechazada", async () => {
  const usdAccount: FakeAccount = { ...BANK, id: "bank-usd", currencyCode: "USD" };
  const { tx } = createFakeTx({ accounts: [usdAccount], users: [ACTOR] });
  await assert.rejects(
    () => depositBranchCashDirectTx(tx, { branchId: "b", bankAccountId: "bank-usd", amount: 100, actorUserId: "user-1" }, 500),
    /VALIDATION_ERROR.*córdobas/,
  );
});

test("cuenta destino inactiva: rechazada", async () => {
  const inactive: FakeAccount = { ...BANK, id: "bank-inactive", isActive: false };
  const { tx } = createFakeTx({ accounts: [inactive], users: [ACTOR] });
  await assert.rejects(
    () => depositBranchCashDirectTx(tx, { branchId: "b", bankAccountId: "bank-inactive", amount: 100, actorUserId: "user-1" }, 500),
    /VALIDATION_ERROR.*inactiva/,
  );
});

for (const badType of ["SAFE", "CUSTODY", "SETTLEMENT"] as const) {
  test(`cuenta destino de tipo ${badType}: rechazada (solo BANK puede recibir depósito directo)`, async () => {
    const notBank: FakeAccount = { ...BANK, id: `acc-${badType}`, type: badType };
    const { tx } = createFakeTx({ accounts: [notBank], users: [ACTOR] });
    await assert.rejects(
      () => depositBranchCashDirectTx(tx, { branchId: "b", bankAccountId: `acc-${badType}`, amount: 100, actorUserId: "user-1" }, 500),
      /VALIDATION_ERROR.*no es bancaria/,
    );
  });
}

test("tras un depósito completo (sin SAFE), el saldo de la cuenta CUSTODY del actor vuelve a 0 (entró y salió en la misma transacción)", async () => {
  const { tx, entries } = createFakeTx({ accounts: [BANK], users: [ACTOR] });
  const result = await depositBranchCashDirectTx(tx, { branchId: BRANCH, bankAccountId: "bank-1", amount: 1000, actorUserId: "user-1" }, 1000);
  assert.equal(balanceOf(entries, result.custodyAccountId!), 0);
});

test("el saldo de la cuenta BANK sube exactamente por el monto depositado", async () => {
  const { tx, entries } = createFakeTx({
    accounts: [BANK],
    users: [ACTOR],
    existingEntries: [{ accountId: "bank-1", direction: "IN", amount: 189_193.28 }],
  });
  const balanceBefore = balanceOf(entries, "bank-1");
  await depositBranchCashDirectTx(tx, { branchId: BRANCH, bankAccountId: "bank-1", amount: 400, actorUserId: "user-1" }, 1000);
  const balanceAfter = balanceOf(entries, "bank-1");
  assert.equal(Math.round((balanceAfter - balanceBefore) * 100) / 100, 400);
});

test("depósito exactamente igual al tope (amount === accumulatedAmount) se acepta", async () => {
  const { tx, deposits } = createFakeTx({ accounts: [BANK], users: [ACTOR] });
  await depositBranchCashDirectTx(tx, { branchId: "b", bankAccountId: "bank-1", amount: 500, actorUserId: "user-1" }, 500);
  assert.equal(deposits.length, 1);
});

test("BUG 1 (el que importa): depositar el acumulado completo y LUEGO intentar depositar otra vez sobre el mismo acumulado (ya consumido) es rechazado", async () => {
  const { tx: tx1 } = createFakeTx({ accounts: [BANK], users: [ACTOR] });
  await depositBranchCashDirectTx(tx1, { branchId: "b", bankAccountId: "bank-1", amount: 1000, actorUserId: "user-1" }, 1000);

  // El wrapper (depositBranchCashDirect, no testeable sin DB real) recalcula
  // accumulatedAmount DENTRO de la transacción después de este depósito —
  // getAccumulatedRetainedTx ya lo resta directo (1.2). Acá se simula ese
  // recálculo: un segundo llamado con accumulatedAmount=0 tiene que
  // rechazar cualquier monto positivo.
  const { tx: tx2, deposits: deposits2 } = createFakeTx({ accounts: [BANK], users: [ACTOR] });
  await assert.rejects(
    () => depositBranchCashDirectTx(tx2, { branchId: "b", bankAccountId: "bank-1", amount: 1000, actorUserId: "user-1" }, /* accumulatedAmount ya recalculado */ 0),
    /VALIDATION_ERROR.*efectivo retenido/,
  );
  assert.equal(deposits2.length, 0);
});

test("BUG 1: con acumulado 1,000 (aunque la gaveta abierta tenga 5,000 — un número que depositBranchCashDirectTx ni siquiera recibe), depositar 1,500 de entrada es rechazado", async () => {
  const { tx, deposits } = createFakeTx({ accounts: [BANK], users: [ACTOR] });
  await assert.rejects(
    () => depositBranchCashDirectTx(tx, { branchId: "b", bankAccountId: "bank-1", amount: 1500, actorUserId: "user-1" }, 1000),
    /VALIDATION_ERROR.*efectivo retenido/,
  );
  assert.equal(deposits.length, 0, "ni la gaveta ni ningún otro número puede colarse: la función solo conoce accumulatedAmount");
});

// ─── prompt-tesoreria-sin-transito.md Fase 1.3 — con caja fuerte (SAFE) ───

const SAFE: FakeAccount = { id: "safe-1", type: "SAFE", code: "SAFE-MASAYA", bankName: "Caja fuerte", accountAlias: "Masaya", accountNumber: "", currencyCode: "NIO", branchId: BRANCH, holderUserId: null, isActive: true, owner: null, openingBalance: 0, openingBalanceAt: null };

test("LA QUE IMPORTA — con SAFE activa en la sucursal: la SAFE baja el monto, sin tocar ninguna custodia", async () => {
  const { tx, entries } = createFakeTx({ accounts: [BANK, SAFE], users: [ACTOR] });
  const result = await depositBranchCashDirectTx(tx, { branchId: BRANCH, bankAccountId: "bank-1", amount: 600, actorUserId: "user-1" }, 1000);

  assert.equal(result.custodyAccountId, null, "no debe existir ninguna custodia en este camino");
  const safeOut = entries.find((e) => e.accountId === "safe-1" && e.direction === "OUT");
  assert.equal(Number(safeOut?.amount), 600);
  assert.equal(safeOut?.entryType, "DEPOSIT_CONFIRMED");
  const custodyEntries = entries.filter((e) => e.entryType === "DEPOSIT_DISPATCH");
  assert.equal(custodyEntries.length, 0, "sin SAFE de por medio no hay ningún DEPOSIT_DISPATCH — no hace falta pasar por custodia");
});

test("con SAFE: el saldo de la cuenta BANK sube exactamente por el monto depositado", async () => {
  const { tx, entries } = createFakeTx({ accounts: [BANK, SAFE], users: [ACTOR] });
  await depositBranchCashDirectTx(tx, { branchId: BRANCH, bankAccountId: "bank-1", amount: 600, actorUserId: "user-1" }, 1000);
  assert.equal(balanceOf(entries, "bank-1"), 600);
});

test("con SAFE: si el saldo de la SAFE es menor que el monto, se permite igual (histórico incompleto conocido) — el resultado trae safeBalanceBefore para auditarlo", async () => {
  const { tx } = createFakeTx({
    accounts: [BANK, SAFE],
    users: [ACTOR],
    // La SAFE nunca recibió el RETAIN_TO_SAFE correspondiente (hallazgo
    // lateral del doc) — su saldo real acá es 0, menor que los 600 a sacar.
    existingEntries: [],
  });
  const result = await depositBranchCashDirectTx(tx, { branchId: BRANCH, bankAccountId: "bank-1", amount: 600, actorUserId: "user-1" }, 1000);
  assert.equal(result.safeBalanceBefore, 0, "queda anotado el saldo ANTES de la transferencia, aunque no alcance");
});

test("SAFE de OTRA sucursal (branchId distinto) no se usa — el depósito sigue el camino de custodia", async () => {
  const otherBranchSafe: FakeAccount = { ...SAFE, id: "safe-other", branchId: "branch-rivas" };
  const { tx } = createFakeTx({ accounts: [BANK, otherBranchSafe], users: [ACTOR] });
  const result = await depositBranchCashDirectTx(tx, { branchId: BRANCH, bankAccountId: "bank-1", amount: 600, actorUserId: "user-1" }, 1000);
  assert.notEqual(result.custodyAccountId, null, "sin SAFE de ESTA sucursal, tiene que pasar por custodia");
});

test("SAFE inactiva no se usa — el depósito sigue el camino de custodia", async () => {
  const inactiveSafe: FakeAccount = { ...SAFE, id: "safe-inactive", isActive: false };
  const { tx } = createFakeTx({ accounts: [BANK, inactiveSafe], users: [ACTOR] });
  const result = await depositBranchCashDirectTx(tx, { branchId: BRANCH, bankAccountId: "bank-1", amount: 600, actorUserId: "user-1" }, 1000);
  assert.notEqual(result.custodyAccountId, null, "una SAFE inactiva no cuenta — sigue el camino de custodia");
});
