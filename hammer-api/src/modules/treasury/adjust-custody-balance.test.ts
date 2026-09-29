import assert from "node:assert/strict";
import test from "node:test";
import { adjustCustodyBalanceTx } from "@/modules/treasury/service";

/**
 * prompt-tesoreria-depositos.md Fase 3 — da de baja efectivo que nunca
 * existió de verdad en una custodia (el caso fantasma del Bug 1: un
 * depósito directo repetido que dispatchó el mismo acumulado más de una
 * vez). Una sola entrada OUT RECONCILIATION/ADJUSTMENT, sin transferId.
 */

const CUSTODY_ACCOUNT_ID = "acc-custody-1";
const SAFE_ACCOUNT_ID = "acc-safe-1";
const ACTOR_USER_ID = "user-1";

type FakeAccount = { id: string; type: string; branchId: string | null; openingBalance: number; openingBalanceAt: Date | null; currencyCode: string };

function buildFakeTx(opts: { custodyOpeningBalance: number }) {
  const accounts = new Map<string, FakeAccount>([
    [CUSTODY_ACCOUNT_ID, { id: CUSTODY_ACCOUNT_ID, type: "CUSTODY", branchId: "branch-1", openingBalance: opts.custodyOpeningBalance, openingBalanceAt: new Date("2026-01-01"), currencyCode: "NIO" }],
    [SAFE_ACCOUNT_ID, { id: SAFE_ACCOUNT_ID, type: "SAFE", branchId: "branch-1", openingBalance: 0, openingBalanceAt: new Date("2026-01-01"), currencyCode: "NIO" }],
  ]);
  const treasuryEntries: Array<Record<string, unknown>> = [];
  let entryCounter = 0;

  const tx = {
    $queryRaw: async () => [],
    treasuryAccount: {
      findUniqueOrThrow: async ({ where }: { where: { id: string } }) => {
        const a = accounts.get(where.id);
        if (!a) throw new Error(`fake tx: cuenta ${where.id} no existe`);
        return a;
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

test("LA QUE IMPORTA — ajuste dentro del saldo: una sola entrada OUT, sin transferId", async () => {
  const { tx, treasuryEntries } = buildFakeTx({ custodyOpeningBalance: 1000 });

  const result = await adjustCustodyBalanceTx(tx, { custodyAccountId: CUSTODY_ACCOUNT_ID, amount: 400, reason: "Plata que nunca existió, del Bug 1", actorUserId: ACTOR_USER_ID });

  assert.equal(treasuryEntries.length, 1);
  const entry = treasuryEntries[0];
  assert.equal(entry.accountId, CUSTODY_ACCOUNT_ID);
  assert.equal(entry.direction, "OUT");
  assert.equal(entry.amount, 400);
  assert.equal(entry.entryType, "RECONCILIATION");
  assert.equal(entry.counterpartyType, "ADJUSTMENT");
  assert.equal(entry.transferId, null, "no es una transferencia — no hay a dónde va la plata");
  assert.equal(result.balanceBefore, 1000);
});

test("LA QUE IMPORTA — ajuste que supera el saldo: rechazado, sin ninguna entrada creada", async () => {
  const { tx, treasuryEntries } = buildFakeTx({ custodyOpeningBalance: 500 });

  await assert.rejects(
    adjustCustodyBalanceTx(tx, { custodyAccountId: CUSTODY_ACCOUNT_ID, amount: 500.02, reason: "Motivo con más de diez caracteres", actorUserId: ACTOR_USER_ID }),
    /VALIDATION_ERROR/,
  );
  assert.equal(treasuryEntries.length, 0);
});

test("ajuste exactamente igual al saldo: se acepta", async () => {
  const { tx, treasuryEntries } = buildFakeTx({ custodyOpeningBalance: 500 });

  await adjustCustodyBalanceTx(tx, { custodyAccountId: CUSTODY_ACCOUNT_ID, amount: 500, reason: "Ajuste exacto al saldo disponible", actorUserId: ACTOR_USER_ID });
  assert.equal(treasuryEntries.length, 1);
});

test("motivo con menos de 10 caracteres: rechazado con 400, sin escribir nada", async () => {
  const { tx, treasuryEntries } = buildFakeTx({ custodyOpeningBalance: 1000 });

  await assert.rejects(
    adjustCustodyBalanceTx(tx, { custodyAccountId: CUSTODY_ACCOUNT_ID, amount: 100, reason: "corto", actorUserId: ACTOR_USER_ID }),
    /VALIDATION_ERROR.*10 caracteres/,
  );
  assert.equal(treasuryEntries.length, 0);
});

test("monto negativo o cero: rechazado", async () => {
  const { tx } = buildFakeTx({ custodyOpeningBalance: 1000 });
  await assert.rejects(
    adjustCustodyBalanceTx(tx, { custodyAccountId: CUSTODY_ACCOUNT_ID, amount: 0, reason: "Motivo con más de diez caracteres", actorUserId: ACTOR_USER_ID }),
    /VALIDATION_ERROR/,
  );
});

test("cuenta que no es de custodia (SAFE): rechazada", async () => {
  const { tx, treasuryEntries } = buildFakeTx({ custodyOpeningBalance: 1000 });
  await assert.rejects(
    adjustCustodyBalanceTx(tx, { custodyAccountId: SAFE_ACCOUNT_ID, amount: 100, reason: "Motivo con más de diez caracteres", actorUserId: ACTOR_USER_ID }),
    /VALIDATION_ERROR.*custodia/,
  );
  assert.equal(treasuryEntries.length, 0);
});
