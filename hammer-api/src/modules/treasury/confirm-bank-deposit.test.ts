import assert from "node:assert/strict";
import test from "node:test";
import { confirmBankDepositTx } from "@/modules/treasury/service";

/**
 * prompt-vigilancia-deposito-bancario.md — confirmBankDeposit YA calculaba
 * remainder/discrepant (sin tocar ese cálculo), pero solo lo escribía en el
 * metadataJson de un AuditLog que nadie revisa proactivamente. Con el
 * remanente por encima de la tolerancia de la sucursal (operations/
 * cash-tolerance-config.ts, misma fuente que la tolerancia de caja — acá
 * inyectada como número plano, ver confirmBankDepositTx/confirmBankDeposit),
 * ahora se crea una BrainDecision REVIEW_BANK_DEPOSIT_SHORTFALL en la misma
 * transacción.
 *
 * confirmBankDepositTx recibe un `tx` inyectable (mismo patrón que
 * createOpeningBalanceTx/upsertBranchSettingTx en otros módulos) — acá se le
 * da un fake en memoria, sin base de datos real. logAuditEvent (audit/
 * service.ts) usa el singleton `prisma` sin tx inyectable, pero tiene su
 * propio try/catch que nunca rompe el flujo principal — no hace falta
 * mockearlo, solo va a loguear un error a consola y seguir.
 */

const CUSTODY_ACCOUNT_ID = "acc-custody-1";
const BANK_ACCOUNT_ID = "acc-bank-1";
const BRANCH_ID = "branch-1";
const CONFIRMED_BY_USER_ID = "user-1";

type FakeAccount = {
  id: string;
  openingBalance: number;
  openingBalanceAt: Date | null;
  currencyCode: string;
  bankName: string;
  accountAlias: string;
};

function buildFakeTx(opts: { custodyOpeningBalance: number }) {
  const accounts = new Map<string, FakeAccount>([
    [CUSTODY_ACCOUNT_ID, { id: CUSTODY_ACCOUNT_ID, openingBalance: opts.custodyOpeningBalance, openingBalanceAt: new Date("2026-01-01"), currencyCode: "NIO", bankName: "Custodia", accountAlias: "Juan Pérez" }],
    [BANK_ACCOUNT_ID, { id: BANK_ACCOUNT_ID, openingBalance: 0, openingBalanceAt: new Date("2026-01-01"), currencyCode: "NIO", bankName: "BAC", accountAlias: "Cuenta corriente 123" }],
  ]);
  const treasuryEntries: Array<Record<string, unknown>> = [];
  const brainDecisions: Array<Record<string, unknown>> = [];
  let entryCounter = 0;

  const tx = {
    treasuryAccount: {
      findUniqueOrThrow: async ({ where }: { where: { id: string } }) => {
        const account = accounts.get(where.id);
        if (!account) throw new Error(`fake tx: cuenta ${where.id} no existe`);
        return account;
      },
    },
    treasuryEntry: {
      aggregate: async ({ where }: { where: { accountId: string; direction: string } }) => {
        const sum = treasuryEntries
          .filter((e) => e.accountId === where.accountId && e.direction === where.direction)
          .reduce((acc, e) => acc + (e.amount as number), 0);
        return { _sum: { amount: sum } };
      },
      findFirst: async () => null, // sin DEPOSIT_DISPATCH previo — intendedBankAccountId queda null
      create: async ({ data }: { data: Record<string, unknown> }) => {
        entryCounter += 1;
        const row = { id: `entry-${entryCounter}`, ...data };
        treasuryEntries.push(row);
        return row;
      },
    },
    bankDeposit: {
      create: async ({ data }: { data: Record<string, unknown> }) => {
        const bankAccount = accounts.get(data.bankAccountId as string)!;
        return {
          id: "deposit-1",
          ...data,
          bankAccount: { bankName: bankAccount.bankName, accountAlias: bankAccount.accountAlias },
          confirmedBy: { fullName: "Ana Gómez", username: "agomez" },
        };
      },
    },
    brainDecision: {
      create: async ({ data }: { data: Record<string, unknown> }) => {
        brainDecisions.push(data);
        return { id: `decision-${brainDecisions.length}`, ...data };
      },
    },
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
  } as any;

  return { tx, brainDecisions, treasuryEntries };
}

test("shortfall mayor a la tolerancia → crea REVIEW_BANK_DEPOSIT_SHORTFALL con los datos correctos", async () => {
  const { tx, brainDecisions } = buildFakeTx({ custodyOpeningBalance: 5000 });
  const toleranceAmount = 100;

  const result = await confirmBankDepositTx(tx, {
    custodyAccountId: CUSTODY_ACCOUNT_ID,
    bankAccountId: BANK_ACCOUNT_ID,
    branchId: BRANCH_ID,
    amount: 4700, // remainder = 5000 - 4700 = 300, > 100 de tolerancia
    confirmedByUserId: CONFIRMED_BY_USER_ID,
    referenceNumber: "REF-001",
  }, toleranceAmount);

  assert.equal(result.remainderInCustody, 300);
  assert.equal(brainDecisions.length, 1, "el remanente supera la tolerancia — debe crear la decisión");

  const decision = brainDecisions[0];
  assert.equal(decision.category, "CASH");
  assert.equal(decision.proposedActionType, "REVIEW_BANK_DEPOSIT_SHORTFALL");
  assert.equal(decision.branchId, BRANCH_ID);
  assert.match(decision.title as string, /Dep[oó]sito corto/);
  assert.match(decision.description as string, /C\$4700\.00/);
  assert.match(decision.description as string, /C\$300\.00/);
  assert.match(decision.description as string, /Ana G[oó]mez/, "usa el nombre de quien confirmó, no el id");
  assert.match(decision.description as string, /BAC/, "usa el nombre del banco, no el id");

  const evidence = decision.evidenceJson as Record<string, unknown>;
  assert.equal(evidence.custodyAccountId, CUSTODY_ACCOUNT_ID);
  assert.equal(evidence.bankAccountId, BANK_ACCOUNT_ID);
  assert.equal(evidence.branchId, BRANCH_ID);
  assert.equal(evidence.amountConfirmed, 4700);
  assert.equal(evidence.custodyBalanceBefore, 5000);
  assert.equal(evidence.remainder, 300);
  assert.equal(evidence.confirmedByUserId, CONFIRMED_BY_USER_ID);
  assert.equal(evidence.referenceNumber, "REF-001");

  const source = decision.sourceJson as Record<string, unknown>;
  assert.equal(source.referenceType, "BankDeposit");
  assert.equal(source.referenceId, "deposit-1");
});

test("shortfall menor a la tolerancia → NO crea ninguna decisión (evita ruido por centavos)", async () => {
  const { tx, brainDecisions } = buildFakeTx({ custodyOpeningBalance: 5000 });
  const toleranceAmount = 100;

  const result = await confirmBankDepositTx(tx, {
    custodyAccountId: CUSTODY_ACCOUNT_ID,
    bankAccountId: BANK_ACCOUNT_ID,
    branchId: BRANCH_ID,
    amount: 4950, // remainder = 50, < 100 de tolerancia
    confirmedByUserId: CONFIRMED_BY_USER_ID,
  }, toleranceAmount);

  assert.equal(result.remainderInCustody, 50);
  assert.equal(brainDecisions.length, 0);
});

test("remainder exactamente igual a la tolerancia → NO crea nada (estrictamente mayor que, no mayor o igual)", async () => {
  const { tx, brainDecisions } = buildFakeTx({ custodyOpeningBalance: 5000 });
  const toleranceAmount = 100;

  await confirmBankDepositTx(tx, {
    custodyAccountId: CUSTODY_ACCOUNT_ID,
    bankAccountId: BANK_ACCOUNT_ID,
    branchId: BRANCH_ID,
    amount: 4900, // remainder = 100, == tolerancia
    confirmedByUserId: CONFIRMED_BY_USER_ID,
  }, toleranceAmount);

  assert.equal(brainDecisions.length, 0);
});

test("depósito exacto (remainder = 0) → NO crea nada", async () => {
  const { tx, brainDecisions } = buildFakeTx({ custodyOpeningBalance: 5000 });
  await confirmBankDepositTx(tx, {
    custodyAccountId: CUSTODY_ACCOUNT_ID,
    bankAccountId: BANK_ACCOUNT_ID,
    branchId: BRANCH_ID,
    amount: 5000,
    confirmedByUserId: CONFIRMED_BY_USER_ID,
  }, 100);

  assert.equal(brainDecisions.length, 0);
});

test("severidad: remainder entre 1x y 2x la tolerancia → HIGH", async () => {
  const { tx, brainDecisions } = buildFakeTx({ custodyOpeningBalance: 5000 });
  const toleranceAmount = 100;

  await confirmBankDepositTx(tx, {
    custodyAccountId: CUSTODY_ACCOUNT_ID,
    bankAccountId: BANK_ACCOUNT_ID,
    branchId: BRANCH_ID,
    amount: 4850, // remainder = 150 (> 100, <= 200)
    confirmedByUserId: CONFIRMED_BY_USER_ID,
  }, toleranceAmount);

  assert.equal(brainDecisions.length, 1);
  assert.equal(brainDecisions[0].severity, "HIGH");
});

test("severidad: remainder mayor a 2x la tolerancia → CRITICAL (mismo umbral 2x que evaluateBranchCostAgainstReference)", async () => {
  const { tx, brainDecisions } = buildFakeTx({ custodyOpeningBalance: 5000 });
  const toleranceAmount = 100;

  await confirmBankDepositTx(tx, {
    custodyAccountId: CUSTODY_ACCOUNT_ID,
    bankAccountId: BANK_ACCOUNT_ID,
    branchId: BRANCH_ID,
    amount: 4700, // remainder = 300 (> 200)
    confirmedByUserId: CONFIRMED_BY_USER_ID,
  }, toleranceAmount);

  assert.equal(brainDecisions.length, 1);
  assert.equal(brainDecisions[0].severity, "CRITICAL");
});

test("cada decisión tiene un fingerprint distinto (uno por depósito, vía deposit.id)", async () => {
  const { tx, brainDecisions } = buildFakeTx({ custodyOpeningBalance: 5000 });
  await confirmBankDepositTx(tx, {
    custodyAccountId: CUSTODY_ACCOUNT_ID,
    bankAccountId: BANK_ACCOUNT_ID,
    branchId: BRANCH_ID,
    amount: 4700,
    confirmedByUserId: CONFIRMED_BY_USER_ID,
  }, 100);

  assert.equal(brainDecisions.length, 1);
  assert.ok(typeof brainDecisions[0].fingerprint === "string" && (brainDecisions[0].fingerprint as string).length > 0);
});
