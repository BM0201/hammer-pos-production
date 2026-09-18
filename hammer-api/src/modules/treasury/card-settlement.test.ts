import assert from "node:assert/strict";
import test from "node:test";
import { confirmCardSettlementTx } from "@/modules/treasury/service";

/**
 * prompt-tesoreria-cerrar-circuito.md H-1/Fase 2 — recordSaleTenderEntriesTx
 * manda cada tender CARD a SETTLEMENT-CENTRAL como IN SALE_CARD; ese saldo
 * crecía para siempre porque nada lo sacaba. confirmCardSettlementTx es la
 * pieza que faltaba: SETTLEMENT baja por el BRUTO, el banco sube por el
 * NETO (bruto − comisión), y la comisión sale como una tercera fila
 * CARD_FEE sin transferId (no se transfiere a ningún lado).
 *
 * Mismo patrón que confirm-bank-deposit.test.ts: `tx` inyectable con un fake
 * en memoria, sin base de datos real. logAuditEvent usa el singleton prisma
 * con su propio try/catch — no hace falta mockearlo.
 */

const SETTLEMENT_ACCOUNT_ID = "acc-settlement-1";
const BANK_ACCOUNT_ID = "acc-bank-1";
const SAFE_ACCOUNT_ID = "acc-safe-1";
const CONFIRMED_BY_USER_ID = "user-1";

type FakeAccount = { id: string; type: string; openingBalance: number; openingBalanceAt: Date | null; currencyCode: string };

function buildFakeTx(opts: { settlementOpeningBalance: number }) {
  const accounts = new Map<string, FakeAccount>([
    [SETTLEMENT_ACCOUNT_ID, { id: SETTLEMENT_ACCOUNT_ID, type: "SETTLEMENT", openingBalance: opts.settlementOpeningBalance, openingBalanceAt: new Date("2026-01-01"), currencyCode: "NIO" }],
    [BANK_ACCOUNT_ID, { id: BANK_ACCOUNT_ID, type: "BANK", openingBalance: 0, openingBalanceAt: new Date("2026-01-01"), currencyCode: "NIO" }],
    [SAFE_ACCOUNT_ID, { id: SAFE_ACCOUNT_ID, type: "SAFE", openingBalance: 0, openingBalanceAt: new Date("2026-01-01"), currencyCode: "NIO" }],
  ]);
  const treasuryEntries: Array<Record<string, unknown>> = [];
  let entryCounter = 0;

  const tx = {
    $queryRaw: async () => [],
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
      create: async ({ data }: { data: Record<string, unknown> }) => {
        entryCounter += 1;
        const row = { id: `entry-${entryCounter}`, ...data };
        treasuryEntries.push(row);
        return row;
      },
    },
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
  } as any;

  return { tx, treasuryEntries };
}

test("LA QUE IMPORTA — liquidación con comisión: SETTLEMENT baja el bruto, banco sube el neto, comisión es una tercera fila sin transferId", async () => {
  const { tx, treasuryEntries } = buildFakeTx({ settlementOpeningBalance: 10000 });

  const result = await confirmCardSettlementTx(tx, {
    settlementAccountId: SETTLEMENT_ACCOUNT_ID,
    bankAccountId: BANK_ACCOUNT_ID,
    grossAmount: 5000,
    feeAmount: 150,
    confirmedByUserId: CONFIRMED_BY_USER_ID,
    referenceNumber: "LIQ-001",
  });

  assert.equal(result.netAmount, 4850);
  assert.equal(treasuryEntries.length, 3, "OUT settlement + IN banco + OUT fee");

  const settlementOut = treasuryEntries.find((e) => e.entryType === "CARD_SETTLEMENT" && e.direction === "OUT")!;
  assert.equal(settlementOut.accountId, SETTLEMENT_ACCOUNT_ID);
  assert.equal(settlementOut.amount, 5000);
  assert.equal(settlementOut.counterpartyType, "ACQUIRER");

  const bankIn = treasuryEntries.find((e) => e.entryType === "CARD_SETTLEMENT" && e.direction === "IN")!;
  assert.equal(bankIn.accountId, BANK_ACCOUNT_ID);
  assert.equal(bankIn.amount, 4850);
  assert.equal(bankIn.transferId, settlementOut.transferId, "las dos patas comparten transferId");

  const feeEntry = treasuryEntries.find((e) => e.entryType === "CARD_FEE")!;
  assert.equal(feeEntry.accountId, SETTLEMENT_ACCOUNT_ID);
  assert.equal(feeEntry.direction, "OUT");
  assert.equal(feeEntry.amount, 150);
  assert.equal(feeEntry.counterpartyType, "ACQUIRER");
  assert.equal(feeEntry.transferId, null, "la comisión sale del sistema, no se transfiere a ningún lado");
});

test("sin comisión (feeAmount=0 o ausente): solo dos filas, neto = bruto", async () => {
  const { tx, treasuryEntries } = buildFakeTx({ settlementOpeningBalance: 5000 });

  const result = await confirmCardSettlementTx(tx, {
    settlementAccountId: SETTLEMENT_ACCOUNT_ID,
    bankAccountId: BANK_ACCOUNT_ID,
    grossAmount: 3000,
    confirmedByUserId: CONFIRMED_BY_USER_ID,
  });

  assert.equal(result.feeAmount, 0);
  assert.equal(result.netAmount, 3000);
  assert.equal(treasuryEntries.length, 2, "sin CARD_FEE cuando la comisión es 0");
  assert.equal(treasuryEntries.some((e) => e.entryType === "CARD_FEE"), false);
});

test("liquidar más de lo que hay por liquidar se rechaza", async () => {
  const { tx } = buildFakeTx({ settlementOpeningBalance: 1000 });

  await assert.rejects(
    confirmCardSettlementTx(tx, {
      settlementAccountId: SETTLEMENT_ACCOUNT_ID,
      bankAccountId: BANK_ACCOUNT_ID,
      grossAmount: 1500,
      confirmedByUserId: CONFIRMED_BY_USER_ID,
    }),
    /VALIDATION_ERROR/,
  );
});

test("comisión mayor o igual al bruto se rechaza (el neto tiene que ser positivo)", async () => {
  const { tx } = buildFakeTx({ settlementOpeningBalance: 10000 });

  await assert.rejects(
    confirmCardSettlementTx(tx, {
      settlementAccountId: SETTLEMENT_ACCOUNT_ID,
      bankAccountId: BANK_ACCOUNT_ID,
      grossAmount: 500,
      feeAmount: 500,
      confirmedByUserId: CONFIRMED_BY_USER_ID,
    }),
    /VALIDATION_ERROR/,
  );
});

test("la cuenta de origen debe ser SETTLEMENT — una cuenta SAFE se rechaza", async () => {
  const { tx } = buildFakeTx({ settlementOpeningBalance: 10000 });

  await assert.rejects(
    confirmCardSettlementTx(tx, {
      settlementAccountId: SAFE_ACCOUNT_ID,
      bankAccountId: BANK_ACCOUNT_ID,
      grossAmount: 500,
      confirmedByUserId: CONFIRMED_BY_USER_ID,
    }),
    /VALIDATION_ERROR/,
  );
});

test("la cuenta destino debe ser BANK — liquidar hacia una cuenta SAFE se rechaza", async () => {
  const { tx } = buildFakeTx({ settlementOpeningBalance: 10000 });

  await assert.rejects(
    confirmCardSettlementTx(tx, {
      settlementAccountId: SETTLEMENT_ACCOUNT_ID,
      bankAccountId: SAFE_ACCOUNT_ID,
      grossAmount: 500,
      confirmedByUserId: CONFIRMED_BY_USER_ID,
    }),
    /VALIDATION_ERROR/,
  );
});

test("liquidar exactamente lo que hay disponible (sin comisión) no se rechaza", async () => {
  const { tx, treasuryEntries } = buildFakeTx({ settlementOpeningBalance: 2000 });

  await confirmCardSettlementTx(tx, {
    settlementAccountId: SETTLEMENT_ACCOUNT_ID,
    bankAccountId: BANK_ACCOUNT_ID,
    grossAmount: 2000,
    confirmedByUserId: CONFIRMED_BY_USER_ID,
  });

  assert.equal(treasuryEntries.length, 2);
});
