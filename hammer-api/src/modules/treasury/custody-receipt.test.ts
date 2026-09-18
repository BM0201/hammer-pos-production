import assert from "node:assert/strict";
import test from "node:test";
import { confirmCustodyReceiptTx } from "@/modules/treasury/cash-monitor";

/**
 * prompt-tesoreria-cerrar-circuito.md H-5 — sendCashOutToCustody deja el
 * efectivo en la custodia de quien lo carga; nadie del otro lado confirmaba
 * haberlo recibido de verdad. confirmCustodyReceiptTx cierra ese lado.
 *
 * Mismo patrón que confirm-bank-deposit.test.ts: `tx` inyectable con un fake
 * en memoria. logAuditEvent usa el singleton prisma con su propio
 * try/catch — no hace falta mockearlo.
 */

const CARRIER_CUSTODY_ID = "acc-custody-carrier";
const RECEIVER_CUSTODY_ID = "acc-custody-receiver";
const CARRIER_USER_ID = "user-carrier";
const RECEIVER_USER_ID = "user-receiver";
const OTHER_USER_ID = "user-other";
const BRANCH_ID = "branch-1";

type FakeAccount = { id: string; type: string; branchId: string | null; holderUserId: string | null; openingBalance: number; openingBalanceAt: Date | null; currencyCode: string; code: string; fullName?: string };

function buildFakeTx(opts: { carrierOpeningBalance: number; latestHandoverIntendedRecipientUserId?: string | null }) {
  const accounts = new Map<string, FakeAccount>([
    [CARRIER_CUSTODY_ID, { id: CARRIER_CUSTODY_ID, type: "CUSTODY", branchId: BRANCH_ID, holderUserId: CARRIER_USER_ID, openingBalance: opts.carrierOpeningBalance, openingBalanceAt: new Date("2026-01-01"), currencyCode: "NIO", code: `CUSTODY-${CARRIER_USER_ID}` }],
  ]);
  const accountsByCode = new Map<string, FakeAccount>([[`CUSTODY-${CARRIER_USER_ID}`, accounts.get(CARRIER_CUSTODY_ID)!]]);
  const users = new Map([
    [CARRIER_USER_ID, { id: CARRIER_USER_ID, fullName: "Portador" }],
    [RECEIVER_USER_ID, { id: RECEIVER_USER_ID, fullName: "Receptor" }],
    [OTHER_USER_ID, { id: OTHER_USER_ID, fullName: "Otra Persona" }],
  ]);
  const treasuryEntries: Array<Record<string, unknown>> = [];
  let entryCounter = 0;
  let accountCounter = 0;

  const tx = {
    $queryRaw: async () => [],
    treasuryAccount: {
      findUniqueOrThrow: async ({ where }: { where: { id: string } }) => {
        const account = accounts.get(where.id);
        if (!account) throw new Error(`fake tx: cuenta ${where.id} no existe`);
        return account;
      },
      findUnique: async ({ where }: { where: { code: string } }) => accountsByCode.get(where.code) ?? null,
      create: async ({ data }: { data: Record<string, unknown> }) => {
        accountCounter += 1;
        const id = accountCounter === 1 ? RECEIVER_CUSTODY_ID : `acc-custody-extra-${accountCounter}`;
        const row = { id, ...data } as FakeAccount;
        accounts.set(id, row);
        accountsByCode.set(row.code, row);
        return row;
      },
    },
    treasuryEntry: {
      aggregate: async ({ where }: { where: { accountId: string; direction: string } }) => {
        const sum = treasuryEntries
          .filter((e) => e.accountId === where.accountId && e.direction === where.direction)
          .reduce((acc, e) => acc + (e.amount as number), 0);
        return { _sum: { amount: sum } };
      },
      findFirst: async () =>
        opts.latestHandoverIntendedRecipientUserId === undefined ? null : { intendedRecipientUserId: opts.latestHandoverIntendedRecipientUserId },
      create: async ({ data }: { data: Record<string, unknown> }) => {
        entryCounter += 1;
        const row = { id: `entry-${entryCounter}`, ...data };
        treasuryEntries.push(row);
        return row;
      },
    },
    user: {
      findUniqueOrThrow: async ({ where }: { where: { id: string } }) => {
        const user = users.get(where.id);
        if (!user) throw new Error(`fake tx: usuario ${where.id} no existe`);
        return user;
      },
    },
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
  } as any;

  return { tx, treasuryEntries };
}

test("LA QUE IMPORTA — recepción confirmada: custodia del portador baja, custodia del receptor sube, mismo transferId", async () => {
  const { tx, treasuryEntries } = buildFakeTx({ carrierOpeningBalance: 5000 });

  const result = await confirmCustodyReceiptTx(tx, {
    fromCustodyAccountId: CARRIER_CUSTODY_ID,
    amount: 3000,
    receivedByUserId: RECEIVER_USER_ID,
  });

  assert.equal(result.remainderInCustody, 2000, "el resto se queda en la custodia del portador — no se ajusta solo");
  assert.equal(treasuryEntries.length, 2);

  const out = treasuryEntries.find((e) => e.direction === "OUT")!;
  assert.equal(out.accountId, CARRIER_CUSTODY_ID);
  assert.equal(out.amount, 3000);
  assert.equal(out.entryType, "HANDOVER");
  assert.equal(out.counterpartyType, "INTERNAL");

  const inEntry = treasuryEntries.find((e) => e.direction === "IN")!;
  assert.equal(inEntry.accountId, RECEIVER_CUSTODY_ID);
  assert.equal(inEntry.amount, 3000);
  assert.equal(inEntry.transferId, out.transferId, "las dos patas comparten transferId");
});

test("confirmar más de lo que hay en la custodia origen se rechaza", async () => {
  const { tx } = buildFakeTx({ carrierOpeningBalance: 1000 });

  await assert.rejects(
    confirmCustodyReceiptTx(tx, {
      fromCustodyAccountId: CARRIER_CUSTODY_ID,
      amount: 1500,
      receivedByUserId: RECEIVER_USER_ID,
    }),
    /VALIDATION_ERROR/,
  );
});

test("no se puede confirmar recepción de tu propia custodia (mismo holder)", async () => {
  const { tx } = buildFakeTx({ carrierOpeningBalance: 1000 });

  await assert.rejects(
    confirmCustodyReceiptTx(tx, {
      fromCustodyAccountId: CARRIER_CUSTODY_ID,
      amount: 500,
      receivedByUserId: CARRIER_USER_ID,
    }),
    /VALIDATION_ERROR/,
  );
});

test("destinatario declarado coincide con quien confirma → recipientMismatch false", async () => {
  const { tx } = buildFakeTx({ carrierOpeningBalance: 5000, latestHandoverIntendedRecipientUserId: RECEIVER_USER_ID });

  const result = await confirmCustodyReceiptTx(tx, {
    fromCustodyAccountId: CARRIER_CUSTODY_ID,
    amount: 5000,
    receivedByUserId: RECEIVER_USER_ID,
  });

  assert.equal(result.recipientMismatch, false);
  assert.equal(result.intendedRecipientUserId, RECEIVER_USER_ID);
});

test("LA QUE IMPORTA — destinatario declarado NO coincide con quien confirma → recipientMismatch true, pero NO bloquea la operación", async () => {
  const { tx, treasuryEntries } = buildFakeTx({ carrierOpeningBalance: 5000, latestHandoverIntendedRecipientUserId: RECEIVER_USER_ID });

  const result = await confirmCustodyReceiptTx(tx, {
    fromCustodyAccountId: CARRIER_CUSTODY_ID,
    amount: 5000,
    receivedByUserId: OTHER_USER_ID, // no es el destinatario declarado
  });

  assert.equal(result.recipientMismatch, true, "el dinero físico ya se movió, el sistema anota — no niega");
  assert.equal(result.intendedRecipientUserId, RECEIVER_USER_ID);
  assert.equal(treasuryEntries.length, 2, "la transferencia se ejecuta igual, con o sin mismatch");
});

test("sin HANDOVER previo con destinatario declarado → recipientMismatch false (nada que comparar)", async () => {
  const { tx } = buildFakeTx({ carrierOpeningBalance: 5000 }); // sin latestHandoverIntendedRecipientUserId

  const result = await confirmCustodyReceiptTx(tx, {
    fromCustodyAccountId: CARRIER_CUSTODY_ID,
    amount: 5000,
    receivedByUserId: RECEIVER_USER_ID,
  });

  assert.equal(result.recipientMismatch, false);
  assert.equal(result.intendedRecipientUserId, null);
});

test("recepción parcial exacta (todo lo que hay) no deja remanente", async () => {
  const { tx } = buildFakeTx({ carrierOpeningBalance: 2000 });

  const result = await confirmCustodyReceiptTx(tx, {
    fromCustodyAccountId: CARRIER_CUSTODY_ID,
    amount: 2000,
    receivedByUserId: RECEIVER_USER_ID,
  });

  assert.equal(result.remainderInCustody, 0);
});
