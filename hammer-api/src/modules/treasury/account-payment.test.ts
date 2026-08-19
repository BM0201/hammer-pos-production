import assert from "node:assert/strict";
import test from "node:test";
import { Prisma } from "@prisma/client";
import { recordAccountPaymentTx } from "@/modules/treasury/service";
import { recordAccountPaymentSchema } from "@/modules/treasury/validators";

/**
 * Pagos salientes desde una cuenta registrada (proveedor/planilla/gasto) —
 * la pieza que faltaba para que "los pagos se hagan DESDE esas cuentas" baje
 * el saldo esperado. Mismo patrón de fake tx en memoria que ledger.test.ts.
 */
type FakeAccount = { id: string; type: "BANK" | "SAFE" | "CUSTODY" | "SETTLEMENT"; isActive: boolean; openingBalance: number; currencyCode: "NIO" | "USD" };
type FakeCard = { id: string; accountId: string; isActive: boolean };
type FakeEntry = { id: string; accountId: string; direction: "IN" | "OUT"; amount: Prisma.Decimal; entryType: string; cardId: string | null };

function createFakeTx(opts: { accounts: FakeAccount[]; cards?: FakeCard[]; existingEntries?: Array<{ accountId: string; direction: "IN" | "OUT"; amount: number }> }) {
  const accounts = new Map(opts.accounts.map((a) => [a.id, a]));
  const cards = new Map((opts.cards ?? []).map((c) => [c.id, c]));
  const entries: FakeEntry[] = [];
  const seeded = opts.existingEntries ?? [];
  const calls: string[] = [];
  let seq = 0;

  const tx = {
    treasuryAccount: {
      findUniqueOrThrow: async ({ where }: { where: { id: string } }) => {
        const acc = accounts.get(where.id);
        if (!acc) throw new Error(`cuenta ${where.id} no encontrada`);
        return acc;
      },
    },
    treasuryCard: {
      findUnique: async ({ where }: { where: { id: string } }) => cards.get(where.id) ?? null,
    },
    treasuryEntry: {
      aggregate: async ({ where }: { where: { accountId: string; direction: "IN" | "OUT" } }) => {
        calls.push("aggregate");
        const created = entries.filter((e) => e.accountId === where.accountId && e.direction === where.direction).reduce((s, e) => s + Number(e.amount), 0);
        const pre = seeded.filter((e) => e.accountId === where.accountId && e.direction === where.direction).reduce((s, e) => s + e.amount, 0);
        return { _sum: { amount: new Prisma.Decimal(created + pre) } };
      },
      create: async ({ data }: { data: Record<string, unknown> }) => {
        seq += 1;
        const row = { id: `entry-${seq}`, ...data } as unknown as FakeEntry;
        entries.push(row);
        return row;
      },
    },
    // Spy del lock de fila: registra "lock" en el mismo orden que "aggregate"
    // para que los tests puedan probar que el lock ocurre ANTES de leer el saldo.
    $queryRaw: async (..._args: unknown[]) => {
      calls.push("lock");
      return [];
    },
  };
  return { tx: tx as unknown as Prisma.TransactionClient, entries, calls };
}

const BANK: FakeAccount = { id: "bank-1", type: "BANK", isActive: true, openingBalance: 10_000, currencyCode: "NIO" };

test("un pago a proveedor crea UNA fila OUT que baja el saldo de la cuenta", async () => {
  const { tx, entries } = createFakeTx({ accounts: [BANK] });
  const entry = await recordAccountPaymentTx(tx, {
    accountId: "bank-1",
    amount: 2500,
    entryType: "SUPPLIER_PAYMENT",
    counterpartyType: "SUPPLIER",
    counterpartyName: "Ferretería Central",
    createdByUserId: "user-1",
  });
  assert.equal(entries.length, 1);
  assert.equal(entry.direction, "OUT");
  assert.equal(entry.amount.toString(), "2500");
  assert.equal(entry.entryType, "SUPPLIER_PAYMENT");
});

test("un pago con tarjeta ligada a la cuenta deja el rastro cardId", async () => {
  const { tx, entries } = createFakeTx({ accounts: [BANK], cards: [{ id: "card-1", accountId: "bank-1", isActive: true }] });
  await recordAccountPaymentTx(tx, {
    accountId: "bank-1",
    amount: 1000,
    entryType: "EXPENSE",
    counterpartyType: "SUPPLIER",
    cardId: "card-1",
    createdByUserId: "user-1",
  });
  assert.equal(entries[0].cardId, "card-1");
});

test("rechaza una tarjeta que NO pertenece a la cuenta", async () => {
  const { tx } = createFakeTx({ accounts: [BANK], cards: [{ id: "card-otra", accountId: "bank-2", isActive: true }] });
  await assert.rejects(
    () => recordAccountPaymentTx(tx, { accountId: "bank-1", amount: 100, entryType: "EXPENSE", counterpartyType: "SUPPLIER", cardId: "card-otra", createdByUserId: "u" }),
    /VALIDATION_ERROR/,
  );
});

test("rechaza una tarjeta inactiva", async () => {
  const { tx } = createFakeTx({ accounts: [BANK], cards: [{ id: "card-inact", accountId: "bank-1", isActive: false }] });
  await assert.rejects(
    () => recordAccountPaymentTx(tx, { accountId: "bank-1", amount: 100, entryType: "EXPENSE", counterpartyType: "SUPPLIER", cardId: "card-inact", createdByUserId: "u" }),
    /VALIDATION_ERROR/,
  );
});

test("no se puede pagar desde una cuenta que no es de banco (custodia/safe/liquidación)", async () => {
  const { tx } = createFakeTx({ accounts: [{ id: "safe-1", type: "SAFE", isActive: true, openingBalance: 99999, currencyCode: "NIO" }] });
  await assert.rejects(
    () => recordAccountPaymentTx(tx, { accountId: "safe-1", amount: 100, entryType: "EXPENSE", counterpartyType: "SUPPLIER", createdByUserId: "u" }),
    /VALIDATION_ERROR/,
  );
});

test("no se puede pagar desde una cuenta inactiva", async () => {
  const { tx } = createFakeTx({ accounts: [{ ...BANK, isActive: false }] });
  await assert.rejects(
    () => recordAccountPaymentTx(tx, { accountId: "bank-1", amount: 100, entryType: "EXPENSE", counterpartyType: "SUPPLIER", createdByUserId: "u" }),
    /VALIDATION_ERROR/,
  );
});

test("por defecto, un pago que dejaría el saldo en negativo se rechaza", async () => {
  const { tx } = createFakeTx({ accounts: [{ ...BANK, openingBalance: 1000 }] });
  await assert.rejects(
    () => recordAccountPaymentTx(tx, { accountId: "bank-1", amount: 1500, entryType: "SUPPLIER_PAYMENT", counterpartyType: "SUPPLIER", createdByUserId: "u" }),
    /VALIDATION_ERROR/,
  );
});

test("con allowNegativeBalance (sobregiro/crédito) sí se permite el saldo negativo", async () => {
  const { tx, entries } = createFakeTx({ accounts: [{ ...BANK, openingBalance: 1000 }] });
  await recordAccountPaymentTx(tx, { accountId: "bank-1", amount: 1500, entryType: "SUPPLIER_PAYMENT", counterpartyType: "SUPPLIER", allowNegativeBalance: true, createdByUserId: "u" });
  assert.equal(entries.length, 1);
  assert.equal(entries[0].amount.toString(), "1500");
});

test("el saldo disponible considera IN y OUT previos, no solo la apertura", async () => {
  // apertura 1000 + IN 5000 - OUT 2000 = 4000 disponible; un pago de 3500 pasa.
  const { tx, entries } = createFakeTx({
    accounts: [{ ...BANK, openingBalance: 1000 }],
    existingEntries: [
      { accountId: "bank-1", direction: "IN", amount: 5000 },
      { accountId: "bank-1", direction: "OUT", amount: 2000 },
    ],
  });
  await recordAccountPaymentTx(tx, { accountId: "bank-1", amount: 3500, entryType: "EXPENSE", counterpartyType: "SUPPLIER", createdByUserId: "u" });
  assert.equal(entries.length, 1);
  // pero uno de 4500 excede los 4000 y se rechaza
  await assert.rejects(
    () => recordAccountPaymentTx(tx, { accountId: "bank-1", amount: 4500, entryType: "EXPENSE", counterpartyType: "SUPPLIER", createdByUserId: "u" }),
    /VALIDATION_ERROR/,
  );
});

test("rechaza monto <= 0", async () => {
  const { tx } = createFakeTx({ accounts: [BANK] });
  await assert.rejects(
    () => recordAccountPaymentTx(tx, { accountId: "bank-1", amount: 0, entryType: "EXPENSE", counterpartyType: "SUPPLIER", createdByUserId: "u" }),
    /VALIDATION_ERROR/,
  );
});

test("el pago toma el lock de la cuenta antes de leer el saldo", async () => {
  const { tx, calls } = createFakeTx({ accounts: [BANK] });
  await recordAccountPaymentTx(tx, { accountId: "bank-1", amount: 100, entryType: "EXPENSE", counterpartyType: "SUPPLIER", createdByUserId: "u" });
  const lockIndex = calls.indexOf("lock");
  const firstAggregateIndex = calls.indexOf("aggregate");
  assert.notEqual(lockIndex, -1, "el lock debe tomarse");
  assert.notEqual(firstAggregateIndex, -1, "el guard debe leer el saldo");
  assert.ok(lockIndex < firstAggregateIndex, "el lock debe tomarse antes del primer aggregate");
});

test("el lock se toma incluso con allowNegativeBalance", async () => {
  const { tx, calls } = createFakeTx({ accounts: [{ ...BANK, openingBalance: 1000 }] });
  await recordAccountPaymentTx(tx, { accountId: "bank-1", amount: 1500, entryType: "SUPPLIER_PAYMENT", counterpartyType: "SUPPLIER", allowNegativeBalance: true, createdByUserId: "u" });
  assert.ok(calls.includes("lock"), "el lock debe tomarse aunque el guard de saldo se salte con el override");
});

const SCHEMA_BASE = {
  accountId: "cabcdefghijklmnop",
  amount: 100,
  entryType: "SUPPLIER_PAYMENT" as const,
  counterpartyType: "SUPPLIER" as const,
};

test("allowNegativeBalance: true sin overrideReason — el schema rechaza", () => {
  const result = recordAccountPaymentSchema.safeParse({ ...SCHEMA_BASE, allowNegativeBalance: true });
  assert.equal(result.success, false);
});

test("allowNegativeBalance: true con razón de 10+ caracteres — el schema acepta", () => {
  const result = recordAccountPaymentSchema.safeParse({
    ...SCHEMA_BASE,
    allowNegativeBalance: true,
    overrideReason: "sobregiro autorizado por gerencia",
  });
  assert.equal(result.success, true);
});

test("overrideReason presente sin allowNegativeBalance — acepta (es solo una nota, no habilita nada)", () => {
  const result = recordAccountPaymentSchema.safeParse({
    ...SCHEMA_BASE,
    overrideReason: "esto no debería habilitar nada",
  });
  assert.equal(result.success, true);
});
