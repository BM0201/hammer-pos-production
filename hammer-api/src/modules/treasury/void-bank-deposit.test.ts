import assert from "node:assert/strict";
import test from "node:test";
import { Prisma } from "@prisma/client";
import { voidBankDepositTx } from "@/modules/treasury/service";

/**
 * prompt-tesoreria-depositos.md Fase 3 — corregir lo que el Bug 1 ya infló:
 * anular un BankDeposit devuelve el monto del banco a la custodia de
 * origen (RECONCILIATION), sin mover el corte de getAccumulatedRetainedTx.
 * Mismo patrón de fake tx en memoria que confirm-bank-deposit.test.ts.
 */

const BANK_ACCOUNT_ID = "acc-bank-1";
const CUSTODY_ACCOUNT_ID = "acc-custody-1";
const DEPOSIT_ID = "deposit-1";
const ACTOR_USER_ID = "user-1";

const SAFE_ACCOUNT_ID = "acc-safe-1";

type FakeAccount = { id: string; type: "BANK" | "CUSTODY" | "SAFE"; openingBalance: number; openingBalanceAt: Date | null; currencyCode: string };
type FakeDeposit = {
  id: string;
  bankAccountId: string;
  branchId: string;
  amount: Prisma.Decimal;
  source: "CUSTODY" | "DIRECT_FROM_RETAINED";
  voidedAt: Date | null;
  voidedByUserId: string | null;
  voidReason: string | null;
};

function buildFakeTx(opts: {
  depositAmount: number;
  bankOpeningBalance: number;
  alreadyVoided?: boolean;
  withConfirmedOutEntry?: boolean;
  source?: "CUSTODY" | "DIRECT_FROM_RETAINED";
  // prompt-tesoreria-sin-transito.md Fase 1.4 — de qué tipo de cuenta salió
  // el DEPOSIT_CONFIRMED OUT: CUSTODY (default) o SAFE (depósito directo
  // que sí tenía caja fuerte — no necesita el drenaje de vuelta a cero).
  sourceAccountType?: "CUSTODY" | "SAFE";
}) {
  const sourceAccountType = opts.sourceAccountType ?? "CUSTODY";
  const sourceAccountId = sourceAccountType === "SAFE" ? SAFE_ACCOUNT_ID : CUSTODY_ACCOUNT_ID;
  const accounts = new Map<string, FakeAccount>([
    [BANK_ACCOUNT_ID, { id: BANK_ACCOUNT_ID, type: "BANK", openingBalance: opts.bankOpeningBalance, openingBalanceAt: new Date("2026-01-01"), currencyCode: "NIO" }],
    [CUSTODY_ACCOUNT_ID, { id: CUSTODY_ACCOUNT_ID, type: "CUSTODY", openingBalance: 0, openingBalanceAt: new Date("2026-01-01"), currencyCode: "NIO" }],
    [SAFE_ACCOUNT_ID, { id: SAFE_ACCOUNT_ID, type: "SAFE", openingBalance: 0, openingBalanceAt: new Date("2026-01-01"), currencyCode: "NIO" }],
  ]);
  const deposits = new Map<string, FakeDeposit>([
    [DEPOSIT_ID, {
      id: DEPOSIT_ID,
      bankAccountId: BANK_ACCOUNT_ID,
      branchId: "branch-1",
      amount: new Prisma.Decimal(opts.depositAmount),
      source: opts.source ?? "CUSTODY",
      voidedAt: opts.alreadyVoided ? new Date("2026-01-02") : null,
      voidedByUserId: opts.alreadyVoided ? "user-0" : null,
      voidReason: opts.alreadyVoided ? "motivo anterior" : null,
    }],
  ]);
  const treasuryEntries: Array<Record<string, unknown>> = [];
  // La pata DEPOSIT_CONFIRMED OUT que ya existía cuando se confirmó el
  // depósito — voidBankDepositTx la busca para saber de qué cuenta salió.
  if (opts.withConfirmedOutEntry !== false) {
    treasuryEntries.push({ id: "seed-1", accountId: sourceAccountId, direction: "OUT", amount: opts.depositAmount, entryType: "DEPOSIT_CONFIRMED", bankDepositId: DEPOSIT_ID });
  }
  let entryCounter = 0;

  const tx = {
    $queryRaw: async () => [],
    bankDeposit: {
      findUniqueOrThrow: async ({ where }: { where: { id: string } }) => {
        const d = deposits.get(where.id);
        if (!d) throw new Error(`fake tx: depósito ${where.id} no existe`);
        return d;
      },
      update: async ({ where, data }: { where: { id: string }; data: Partial<FakeDeposit> }) => {
        const d = deposits.get(where.id)!;
        Object.assign(d, data);
        return d;
      },
    },
    treasuryAccount: {
      findUniqueOrThrow: async ({ where }: { where: { id: string } }) => {
        const a = accounts.get(where.id);
        if (!a) throw new Error(`fake tx: cuenta ${where.id} no existe`);
        return a;
      },
    },
    treasuryEntry: {
      findFirst: async ({ where }: { where: { bankDepositId: string; entryType: string; direction: string } }) =>
        treasuryEntries.find((e) => e.bankDepositId === where.bankDepositId && e.entryType === where.entryType && e.direction === where.direction) ?? null,
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

  return { tx, treasuryEntries, deposits };
}

test("LA QUE IMPORTA — anular: el banco baja y la custodia sube exactamente el monto", async () => {
  const { tx, treasuryEntries } = buildFakeTx({ depositAmount: 5000, bankOpeningBalance: 20000 });

  const result = await voidBankDepositTx(tx, { bankDepositId: DEPOSIT_ID, reason: "Depósito duplicado del Bug 1", actorUserId: ACTOR_USER_ID });

  assert.equal(result.amount, 5000);
  assert.equal(result.custodyAccountId, CUSTODY_ACCOUNT_ID);

  const reconciliationOut = treasuryEntries.find((e) => e.entryType === "RECONCILIATION" && e.direction === "OUT");
  const reconciliationIn = treasuryEntries.find((e) => e.entryType === "RECONCILIATION" && e.direction === "IN");
  assert.equal(reconciliationOut?.accountId, BANK_ACCOUNT_ID, "el banco baja");
  assert.equal(Number(reconciliationOut?.amount), 5000);
  assert.equal(reconciliationIn?.accountId, CUSTODY_ACCOUNT_ID, "la custodia sube");
  assert.equal(Number(reconciliationIn?.amount), 5000);
  assert.equal(reconciliationOut?.transferId, reconciliationIn?.transferId, "las dos patas comparten transferId");
  assert.equal(reconciliationOut?.counterpartyType, "ADJUSTMENT");
});

test("el depósito queda marcado: voidedAt, voidedByUserId y voidReason poblados", async () => {
  const { tx, deposits } = buildFakeTx({ depositAmount: 1000, bankOpeningBalance: 5000 });

  await voidBankDepositTx(tx, { bankDepositId: DEPOSIT_ID, reason: "Anulación de prueba con motivo largo", actorUserId: ACTOR_USER_ID });

  const deposit = deposits.get(DEPOSIT_ID)!;
  assert.ok(deposit.voidedAt instanceof Date);
  assert.equal(deposit.voidedByUserId, ACTOR_USER_ID);
  assert.equal(deposit.voidReason, "Anulación de prueba con motivo largo");
});

test("LA QUE IMPORTA — anular un depósito YA anulado: rechazado con BANK_DEPOSIT_ALREADY_VOIDED, sin ninguna entrada nueva", async () => {
  const { tx, treasuryEntries } = buildFakeTx({ depositAmount: 1000, bankOpeningBalance: 5000, alreadyVoided: true });

  await assert.rejects(
    voidBankDepositTx(tx, { bankDepositId: DEPOSIT_ID, reason: "Segundo intento de anulación", actorUserId: ACTOR_USER_ID }),
    /BANK_DEPOSIT_ALREADY_VOIDED/,
  );
  assert.equal(treasuryEntries.length, 1, "solo la pata sembrada del depósito original — nada nuevo");
});

test("motivo con menos de 10 caracteres: rechazado, sin escribir nada", async () => {
  const { tx, treasuryEntries } = buildFakeTx({ depositAmount: 1000, bankOpeningBalance: 5000 });

  await assert.rejects(
    voidBankDepositTx(tx, { bankDepositId: DEPOSIT_ID, reason: "corto", actorUserId: ACTOR_USER_ID }),
    /VALIDATION_ERROR.*10 caracteres/,
  );
  assert.equal(treasuryEntries.length, 1, "sin la pata original tocada");
});

test("el saldo del banco puede quedar negativo — anular NUNCA se bloquea por saldo insuficiente", async () => {
  const { tx, treasuryEntries } = buildFakeTx({ depositAmount: 5000, bankOpeningBalance: 2000 });

  const result = await voidBankDepositTx(tx, { bankDepositId: DEPOSIT_ID, reason: "El banco ya no tiene ese saldo disponible", actorUserId: ACTOR_USER_ID });

  assert.equal(result.bankBalanceWentNegative, true);
  assert.equal(treasuryEntries.filter((e) => e.entryType === "RECONCILIATION").length, 2, "la reversión se escribe igual");
});

// ─── prompt-tesoreria-sin-transito.md Fase 1.4 — depósito directo ─────────

test("LA QUE IMPORTA — anular un depósito DIRECT_FROM_RETAINED que pasó por CUSTODY (sin SAFE): drena la custodia de vuelta a CERO, no la deja con remanente", async () => {
  const { tx, treasuryEntries } = buildFakeTx({ depositAmount: 600, bankOpeningBalance: 10000, source: "DIRECT_FROM_RETAINED", sourceAccountType: "CUSTODY" });

  const result = await voidBankDepositTx(tx, { bankDepositId: DEPOSIT_ID, reason: "Anulación de depósito directo de prueba", actorUserId: ACTOR_USER_ID });

  assert.ok(result.custodyDrainEntryId, "debe existir el segundo paso que drena la custodia");
  const custodyIn = treasuryEntries.find((e) => e.accountId === CUSTODY_ACCOUNT_ID && e.direction === "IN");
  const custodyOut = treasuryEntries.find((e) => e.accountId === CUSTODY_ACCOUNT_ID && e.direction === "OUT" && e.id === result.custodyDrainEntryId);
  assert.equal(Number(custodyIn?.amount), 600, "la reversión banco→custodia entra igual que siempre");
  assert.equal(Number(custodyOut?.amount), 600, "pero se drena de nuevo — neto cero, nunca queda 'en tránsito'");
  assert.equal(custodyOut?.entryType, "RECONCILIATION");
  assert.equal(custodyOut?.transferId, null, "el drenaje no es una transferencia — no hay a dónde va la plata (como adjustCustodyBalanceTx)");
});

test("anular un depósito DIRECT_FROM_RETAINED que salió de la SAFE: un solo paso, sin drenaje — la SAFE se queda con el saldo real", async () => {
  const { tx, treasuryEntries } = buildFakeTx({ depositAmount: 600, bankOpeningBalance: 10000, source: "DIRECT_FROM_RETAINED", sourceAccountType: "SAFE" });

  const result = await voidBankDepositTx(tx, { bankDepositId: DEPOSIT_ID, reason: "Anulación de depósito directo de prueba", actorUserId: ACTOR_USER_ID });

  assert.equal(result.custodyDrainEntryId, null, "sin custodia de por medio, no hay nada que drenar");
  const safeIn = treasuryEntries.find((e) => e.accountId === SAFE_ACCOUNT_ID && e.direction === "IN");
  assert.equal(Number(safeIn?.amount), 600);
  const safeDrain = treasuryEntries.find((e) => e.accountId === SAFE_ACCOUNT_ID && e.direction === "OUT" && e.entryType === "RECONCILIATION");
  assert.equal(safeDrain, undefined, "la SAFE guarda retenido real — se queda con el saldo, no se drena (la única OUT es la sembrada del depósito original)");
});

test("un depósito CUSTODY clásico (source por default) nunca drena — sigue siendo el comportamiento de siempre", async () => {
  const { tx } = buildFakeTx({ depositAmount: 600, bankOpeningBalance: 10000, source: "CUSTODY" });

  const result = await voidBankDepositTx(tx, { bankDepositId: DEPOSIT_ID, reason: "Anulación de depósito clásico de prueba", actorUserId: ACTOR_USER_ID });

  assert.equal(result.custodyDrainEntryId, null);
});
