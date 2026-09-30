import assert from "node:assert/strict";
import test from "node:test";
import { returnCustodyToRetainedTx } from "@/modules/treasury/service";

/**
 * prompt-tesoreria-sin-transito.md Fase 1.5 — limpia lo que ya quedó "en
 * tránsito" por depósitos directos legacy: la custodia baja (RECONCILIATION
 * OUT, sin transferId — mismo patrón que adjustCustodyBalanceTx) y un
 * RetainedCashAdjustment positivo devuelve el monto al acumulado de la
 * sucursal elegida (getAccumulatedRetainedTx lo suma, ver cash-monitor.test.ts).
 */

const CUSTODY_ACCOUNT_ID = "acc-custody-1";
const SAFE_ACCOUNT_ID = "acc-safe-1";
const BRANCH_ID = "branch-rivas";
const ACTOR_USER_ID = "user-1";

type FakeAccount = { id: string; type: string; branchId: string | null; openingBalance: number; openingBalanceAt: Date | null; currencyCode: string };

function buildFakeTx(opts: { custodyOpeningBalance: number }) {
  const accounts = new Map<string, FakeAccount>([
    [CUSTODY_ACCOUNT_ID, { id: CUSTODY_ACCOUNT_ID, type: "CUSTODY", branchId: "branch-masaya", openingBalance: opts.custodyOpeningBalance, openingBalanceAt: new Date("2026-01-01"), currencyCode: "NIO" }],
    [SAFE_ACCOUNT_ID, { id: SAFE_ACCOUNT_ID, type: "SAFE", branchId: "branch-masaya", openingBalance: 0, openingBalanceAt: new Date("2026-01-01"), currencyCode: "NIO" }],
  ]);
  const treasuryEntries: Array<Record<string, unknown>> = [];
  const adjustments: Array<Record<string, unknown>> = [];
  let entryCounter = 0;
  let adjustmentCounter = 0;

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
    retainedCashAdjustment: {
      create: async ({ data }: { data: Record<string, unknown> }) => {
        adjustmentCounter += 1;
        const row = { id: `adj-${adjustmentCounter}`, ...data };
        adjustments.push(row);
        return row;
      },
    },
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
  } as any;

  return { tx, treasuryEntries, adjustments };
}

test("LA QUE IMPORTA — la custodia baja y el acumulado sube (vía RetainedCashAdjustment)", async () => {
  const { tx, treasuryEntries, adjustments } = buildFakeTx({ custodyOpeningBalance: 1000 });

  const result = await returnCustodyToRetainedTx(tx, { custodyAccountId: CUSTODY_ACCOUNT_ID, branchId: BRANCH_ID, amount: 600, reason: "Remanente legacy de depósito directo viejo", actorUserId: ACTOR_USER_ID });

  assert.equal(treasuryEntries.length, 1, "una sola entrada OUT en la custodia — no es una transferencia");
  const entry = treasuryEntries[0];
  assert.equal(entry.accountId, CUSTODY_ACCOUNT_ID);
  assert.equal(entry.direction, "OUT");
  assert.equal(entry.amount, 600);
  assert.equal(entry.entryType, "RECONCILIATION");
  assert.equal(entry.transferId, null, "no hay a dónde transferirlo — esa plata nunca salió de la sucursal de verdad");

  assert.equal(adjustments.length, 1);
  assert.equal(adjustments[0].branchId, BRANCH_ID, "la sucursal ELEGIDA, no la de la custodia (que puede ser legacy multi-sucursal)");
  assert.equal(adjustments[0].amount, 600, "positivo — vuelve al acumulado");
  assert.equal(adjustments[0].custodyAccountId, CUSTODY_ACCOUNT_ID);
  assert.equal(result.balanceBefore, 1000);
});

test("LA QUE IMPORTA — monto mayor al saldo: rechazado, sin custodia tocada ni ajuste creado", async () => {
  const { tx, treasuryEntries, adjustments } = buildFakeTx({ custodyOpeningBalance: 500 });

  await assert.rejects(
    returnCustodyToRetainedTx(tx, { custodyAccountId: CUSTODY_ACCOUNT_ID, branchId: BRANCH_ID, amount: 500.02, reason: "Motivo con más de diez caracteres", actorUserId: ACTOR_USER_ID }),
    /VALIDATION_ERROR/,
  );
  assert.equal(treasuryEntries.length, 0);
  assert.equal(adjustments.length, 0);
});

test("monto exactamente igual al saldo: se acepta", async () => {
  const { tx, treasuryEntries } = buildFakeTx({ custodyOpeningBalance: 500 });
  await returnCustodyToRetainedTx(tx, { custodyAccountId: CUSTODY_ACCOUNT_ID, branchId: BRANCH_ID, amount: 500, reason: "Motivo con más de diez caracteres", actorUserId: ACTOR_USER_ID });
  assert.equal(treasuryEntries.length, 1);
});

test("motivo con menos de 10 caracteres: rechazado", async () => {
  const { tx, treasuryEntries } = buildFakeTx({ custodyOpeningBalance: 1000 });
  await assert.rejects(
    returnCustodyToRetainedTx(tx, { custodyAccountId: CUSTODY_ACCOUNT_ID, branchId: BRANCH_ID, amount: 100, reason: "corto", actorUserId: ACTOR_USER_ID }),
    /VALIDATION_ERROR.*10 caracteres/,
  );
  assert.equal(treasuryEntries.length, 0);
});

test("monto negativo o cero: rechazado", async () => {
  const { tx } = buildFakeTx({ custodyOpeningBalance: 1000 });
  await assert.rejects(
    returnCustodyToRetainedTx(tx, { custodyAccountId: CUSTODY_ACCOUNT_ID, branchId: BRANCH_ID, amount: 0, reason: "Motivo con más de diez caracteres", actorUserId: ACTOR_USER_ID }),
    /VALIDATION_ERROR/,
  );
});

test("cuenta que no es de custodia (SAFE): rechazada", async () => {
  const { tx, treasuryEntries } = buildFakeTx({ custodyOpeningBalance: 1000 });
  await assert.rejects(
    returnCustodyToRetainedTx(tx, { custodyAccountId: SAFE_ACCOUNT_ID, branchId: BRANCH_ID, amount: 100, reason: "Motivo con más de diez caracteres", actorUserId: ACTOR_USER_ID }),
    /VALIDATION_ERROR.*custodia/,
  );
  assert.equal(treasuryEntries.length, 0);
});
